// Browser twin of the retired lib/config.mjs: discovers sections from the
// configured teacher-repo URLs instead of scanning classes/. Everything still
// derives from ground truth: the repo NAME (same teacher-<subject>-<section>-<name>
// convention the folder scan used) and the repo's grader/assignments.json.
import { ghJSON } from "./gh.mjs";

const NAME = /^teacher-([a-z0-9]+)-([a-z0-9]+)-/i; // teacher-<subjectcode>-<section>-<name>

export function parseRepoURL(u) {
  const m = String(u).trim().match(/(?:github\.com[:/]+)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? { org: m[1], repo: m[2] } : null;
}

// -> [{ key, section, repo, org, subject, acts, pol }] sorted by key; skips
// anything that isn't a reachable teacher repo (returned separately as errors)
export async function discoverSections(repoUrls, labels = {}) {
  const sections = [], errors = [];
  for (const u of repoUrls) {
    const line = String(u).trim();
    if (!line) continue;
    const p = parseRepoURL(line);
    if (!p) { errors.push({ url: line, err: "not a repo URL" }); continue; }
    const m = p.repo.match(NAME);
    if (!m) { errors.push({ url: line, err: "name doesn't match teacher-<subject>-<section>-<name>" }); continue; }
    const pol = await ghJSON(`/repos/${p.org}/${p.repo}/contents/grader/assignments.json`)
      .then(j => j && j.content ? JSON.parse(atob(j.content.replace(/\n/g, ""))) : null)
      .catch(e => { errors.push({ url: line, err: e.message }); return null; });
    if (!pol) { if (!errors.find(e => e.url === line)) errors.push({ url: line, err: "grader/assignments.json not found (not a teacher repo, or token lacks access)" }); continue; }
    const code = m[1].toUpperCase(), section = m[2];
    const key = code + "-" + section;
    sections.push({
      key, section, repo: p.repo, org: p.org,
      subject: labels[key] || labels[code] || code,
      acts: pol.filter(x => x.feedback === "project").map(x => x.id), // design activities publish screenshots
      pol,
    });
  }
  sections.sort((a, b) => a.key.localeCompare(b.key));
  return { sections, errors };
}
