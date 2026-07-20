# Command vocabulary (the AI's action contract)

GRAIN's principle is one vocabulary for human and AI. In this tool the human
operates the dashboard; the AI operates the repos. The dashboard never writes to
a repo itself: it emits a **prompt (an Intent)** that you paste into a Claude
Code session, and the AI performs the writes as `git`/`gh` operations
(**RenderOps**). Every Intent is human-reviewed before dispatch.

## Data commands (you run these locally)

| Command | Effect |
| --- | --- |
| `node src/build-dashboard.mjs` | Rebuild `out/grading-review.html` from the gradebooks. |
| `node src/fetch-shots.mjs` | Cache design-activity screenshots into `out/dashboard-assets/`. |
| `node src/fetch-code.mjs` | Cache submission source into `out/grading-review-code.js`. |

## Intents (the dashboard generates these; the AI executes them)

- **Apply-grades prompt** (Gradebook tab). Emits the reviewed grades for a
  section and instructs the assistant to write them into the teacher repo's
  gradebook and, where flagged, publish. Works from the teacher repo path.
- **Apply reviewed AI grades** (AI Review tab). Emits each reviewed decision
  (final score + edited student-facing / instructor-only text), instructs the
  assistant to write back the correct half of `gradebook/notes/<id>/<repo>.md`
  and blank any flagged or unreviewed `aiScore`. A blank `aiScore` holds a
  student out of the Canvas push (`canvas-push` skips it) and marks them
  not-cleared for delivery. This intent writes grades only; it does not publish
  or push. Delivery is the separate Finalize intent below.
- **Finalize and deliver** (AI Review tab, per activity). Emits the delivery
  prompt: student publish plus Canvas push, for the cleared (approved + override)
  students only, dry-run first and gated on the instructor's go. It lists the
  cleared repos and the held-out ones explicitly. Note: `publish-grades.mjs` does
  not gate on `aiScore`, so the prompt restricts the publish to the cleared repos
  (the workflow's `repo` input, one run per repo) rather than an activity-wide
  publish. Adding an `aiScore` gate to `publish-grades.mjs` (shared across the six
  teacher repos) would make an activity-wide publish safe and finalize one-shot.

## The review gate (invariant)

Instructor-only scores and the AI likelihood / "vibecode" flag never reach
students. The student-facing text is prose only. An AI grade reaches a student
only through a deliberate human review here, then a generated Intent that the
human dispatches. The AI acts; the human decides.
