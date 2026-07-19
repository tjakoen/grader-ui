# Usage

## Setup

1. Clone each teacher control-center repo, flat, into `classes/`:
   `classes/teacher-6apsi-2240-tjakoen/`, etc. No per-section subfolders.
2. `node src/build-dashboard.mjs` writes `out/grading-review.html`. Open it.

That is the whole setup. Sections are **auto-discovered** from `classes/`: the
folder name gives the subject and section, the git remote gives the org, and each
repo's `grader/assignments.json` says which activities have screenshots
(`feedback: "project"`). No config file to write.

Optional overrides live in `grader.config.json` (copy from
`grader.config.example.json`): `labels` for prettier tab names, `classesDir` /
`outDir` to relocate, `exclude` to skip a folder. `classes/`, `out/`, and
`grader.config.json` are gitignored: they hold student PII and must never be committed.

## Everyday flow

1. **Refresh the gradebooks:** `git pull` inside each `classes/` teacher repo
   (or run the teacher repo's own grade sweep first).
2. **Rebuild data (optional):** `node src/fetch-shots.mjs` for design
   screenshots, `node src/fetch-code.mjs` for the code viewer. Both cache, so
   re-runs only fetch new work.
3. **Rebuild the dashboard:** `node src/build-dashboard.mjs`.
4. **Review** in the browser: Gradebook tab for the full matrix, AI Review tab
   for held AI grades. Approve / override / flag; edit the student-facing and
   instructor-only text. Decisions persist in the browser (localStorage) and can
   be backed up with **Export decisions** (import merges a backup back in).
5. **Act:** use a "Generate prompt" button to produce the Intent, paste it into
   Claude Code. The AI writes the grades / feedback / Canvas push. See
   [commands.md](commands.md).

## Maintenance tools

- `node src/audit-students.mjs` -> `out/audit-report.md` (student.json consistency)
- `node src/apply-fixes.mjs [--apply]` -> `out/fix-plan.md` (normalize studentNumbers; dry-run by default)
- `node src/check-blanks.mjs` -> `out/blanks-report.md` (graded rows with blank identity)
