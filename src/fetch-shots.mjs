#!/usr/bin/env node
// Downloads submission preview screenshots (from each repo's `previews` branch)
// into ./dashboard-assets/, cached. Writes shots-manifest.json for the dashboard.
// Local only (private student work). Re-run to pick up new submissions.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import { SECTIONS as CFG, paths } from "../lib/config.mjs";
const OUT = paths.assets;
const MAN = paths.shotsManifest;
const TOKEN = execSync("gh auth token", { encoding: "utf8" }).trim();

// which held/design activities publish screenshots
const JOBS = CFG.filter(s => s.acts && s.acts.length).map(s => ({ org: s.org, dir: s.dir, section: s.section, acts: s.acts }));

const parse = (line) => { const o=[];let c="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'&&line[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else if(ch==='"')q=true;else if(ch===','){o.push(c);c="";}else c+=ch;}o.push(c);return o;};

async function gh(url, raw=false) {
  const r = await fetch("https://api.github.com" + url, {
    headers: { Authorization: "Bearer " + TOKEN, Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) return null;
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

// collect (repo) list from gradebooks
const targets = [];
for (const job of JOBS) {
  const csv = fs.readFileSync(path.join(job.dir, "gradebook/grades.csv"), "utf8").replace(/\n$/,"").split("\n");
  const h = parse(csv[0]); const gi = (n) => h.indexOf(n);
  const seen = new Set();
  for (let i=1;i<csv.length;i++){ const f=parse(csv[i]); const a=f[gi("assignment")]; const repo=f[gi("repo")];
    if (job.acts.includes(a) && repo && !seen.has(repo)) { seen.add(repo); targets.push({ org: job.org, section: job.section, act: a, repo }); }
  }
}
console.log("submissions to check:", targets.length);

const manifest = {};
let done = 0;
async function work(t) {
  const dir = path.join(OUT, t.section, t.repo);
  // list previews tree
  const tree = await gh(`/repos/${t.org}/${t.repo}/git/trees/previews?recursive=1`);
  const shots = [];
  if (tree && tree.tree) {
    let imgs = tree.tree.filter(x => /\.(png|jpe?g|webp)$/i.test(x.path));
    // keep only the latest timestamp folder
    const folders = [...new Set(imgs.map(x => x.path.split("/").slice(0,2).join("/")))].sort();
    const latest = folders[folders.length-1];
    if (latest) imgs = imgs.filter(x => x.path.startsWith(latest));
    // prefer desktop+mobile when width variants exist, else keep all
    const hasVariants = imgs.some(x => /desktop|mobile|tablet/i.test(x.path));
    if (hasVariants) imgs = imgs.filter(x => /desktop|mobile/i.test(x.path));
    imgs.sort((a,b)=> (/mobile/i.test(a.path)?1:0) - (/mobile/i.test(b.path)?1:0)); // desktop first
    for (const im of imgs) {
      const base = im.path.split("/").pop();
      const label = base.replace(/\.(png|jpe?g|webp)$/i,"").replace(/-?\d{3,4}$/,"").replace(/[-_]/g," ").trim() || "view";
      const local = path.join(dir, base);
      const rel = `dashboard-assets/${t.section}/${t.repo}/${base}`;
      if (!fs.existsSync(local)) {
        const buf = await gh(`/repos/${t.org}/${t.repo}/contents/${im.path}?ref=previews`, true);
        if (buf) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(local, buf); }
      }
      if (fs.existsSync(local)) shots.push({ label, file: rel });
    }
  }
  if (shots.length) manifest[`${t.section}|${t.repo}`] = shots;
  if (++done % 20 === 0) console.log(`  ${done}/${targets.length}…`);
}

// concurrency pool
async function pool(items, n, fn) {
  const q = items.slice(); const runners = Array.from({length:n}, async () => { while(q.length){ await fn(q.shift()); } });
  await Promise.all(runners);
}
await pool(targets, 8, work);
fs.writeFileSync(MAN, JSON.stringify(manifest, null, 0));
const imgCount = Object.values(manifest).reduce((n,a)=>n+a.length,0);
console.log(`done: ${Object.keys(manifest).length} submissions with shots, ${imgCount} images -> ${MAN}`);
