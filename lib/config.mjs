// Single source of truth for paths + sections.
// Resolves everything relative to the repo root, so the tools run from any checkout.
// Real instance config lives in grader.config.json (gitignored); the committed
// grader.config.example.json is the fallback/template.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // grader-ui/lib
export const REPO = path.resolve(HERE, "..");              // grader-ui

const real = path.join(REPO, "grader.config.json");
const example = path.join(REPO, "grader.config.example.json");
const cfgPath = fs.existsSync(real) ? real : example;
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

export const CLASSES = path.resolve(REPO, cfg.classesDir || "classes");
export const OUT = path.resolve(REPO, cfg.outDir || "out");
fs.mkdirSync(OUT, { recursive: true });

// Teacher-repo clones live FLAT under CLASSES (no per-section subfolders).
export const SECTIONS = cfg.sections.map((s) => ({
  ...s,
  dir: path.join(CLASSES, s.repo),
}));

export const paths = {
  auditReport:   path.join(OUT, "audit-report.md"),
  blanksReport:  path.join(OUT, "blanks-report.md"),
  fixPlan:       path.join(OUT, "fix-plan.md"),
  dashboardHtml: path.join(OUT, "grading-review.html"),
  codeBundle:    path.join(OUT, "grading-review-code.js"),
  shotsManifest: path.join(OUT, "shots-manifest.json"),
  assets:        path.join(OUT, "dashboard-assets"),
  codeCache:     path.join(OUT, "dashboard-assets", ".code-cache"),
};
