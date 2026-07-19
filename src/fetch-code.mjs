#!/usr/bin/env node
// Downloads submission SOURCE CODE for every AI-graded activity into a companion
// grading-review-code.js (window.CODE = { "section|repo": [{path,lang,content}] }),
// so the review panel can toggle between screenshots and code. Local only
// (private student work). Cached by git blob sha; re-run to pick up new work.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const OUT = paths.codeBundle;
const CACHE = paths.codeCache;
const TOKEN = execSync("gh auth token", { encoding: "utf8" }).trim();

const SECTIONS = CFG.map(s => ({ org: s.org, dir: s.dir, section: s.section }));

// source files worth showing; skip generated / vendored / binary / lockfiles
const SRC = /\.(jsx?|tsx?|mjs|cjs|css|scss|html?|dart|vue|svelte)$/i;
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|\.dart_tool|\.github|previews|gradebook|coverage|\.next|out|vendor|submission|\.vscode)(\/|$)/i;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map)$/i;
const MAX_BYTES = 80 * 1024;   // skip a single huge/generated file
const MAX_FILES = 45;          // per submission
const NUL = String.fromCharCode(0);
const langOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || "txt").toLowerCase();

const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};

async function gh(url) {
  const r = await fetch("https://api.github.com" + url, {
    headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) return null;
  return r.json();
}

// which activities are AI-graded (the review queue) per section
const targets = [];
for (const sc of SECTIONS) {
  let pol; try { pol = JSON.parse(fs.readFileSync(path.join(sc.dir, "grader/assignments.json"), "utf8")); } catch { continue; }
  const aiActs = new Set(pol.filter(a => a["ai-grading"]).map(a => a.id));
  if (!aiActs.size) continue;
  const csv = fs.readFileSync(path.join(sc.dir, "gradebook/grades.csv"), "utf8").replace(/\n$/,"").split("\n");
  const h = parse(csv[0]); const gi = (n) => h.indexOf(n);
  const seen = new Set();
  for (let i=1;i<csv.length;i++){ const f=parse(csv[i]); const a=f[gi("assignment")]; const repo=f[gi("repo")];
    if (aiActs.has(a) && repo && !seen.has(repo)) { seen.add(repo); targets.push({ org: sc.org, section: sc.section, repo }); }
  }
}
console.log("AI-graded submissions to fetch code for:", targets.length);
fs.mkdirSync(CACHE, { recursive: true });

const CODE = {};
let done = 0, files = 0;
async function work(t) {
  const repoInfo = await gh(`/repos/${t.org}/${t.repo}`);
  const branch = repoInfo?.default_branch || "main";
  const tree = await gh(`/repos/${t.org}/${t.repo}/git/trees/${branch}?recursive=1`);
  if (!tree || !tree.tree) return;
  let blobs = tree.tree.filter(x => x.type === "blob" && SRC.test(x.path) && !SKIP_DIR.test(x.path) && !SKIP_FILE.test(x.path) && (x.size ?? 0) <= MAX_BYTES);
  blobs.sort((a,b)=> a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  blobs = blobs.slice(0, MAX_FILES);
  const out = [];
  for (const b of blobs) {
    const cp = path.join(CACHE, b.sha);
    let content;
    if (fs.existsSync(cp)) content = fs.readFileSync(cp, "utf8");
    else {
      const buf = await gh(`/repos/${t.org}/${t.repo}/git/blobs/${b.sha}`);
      if (!buf || buf.encoding !== "base64") continue;
      content = Buffer.from(buf.content, "base64").toString("utf8");
      if (content.includes(NUL)) continue;   // binary guard
      fs.writeFileSync(cp, content);
    }
    out.push({ path: b.path, lang: langOf(b.path), content });
    files++;
  }
  if (out.length) CODE[`${t.section}|${t.repo}`] = out;
  if (++done % 20 === 0) console.log(`  ${done}/${targets.length}…`);
}

async function pool(items, n, fn) {
  const q = items.slice(); const runners = Array.from({length:n}, async () => { while(q.length){ await fn(q.shift()); } });
  await Promise.all(runners);
}
await pool(targets, 8, work);
fs.writeFileSync(OUT, "window.CODE=" + JSON.stringify(CODE) + ";\n");
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`done: ${Object.keys(CODE).length} submissions, ${files} files, ${kb} KB -> ${OUT}`);
