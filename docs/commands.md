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
  and blank any flagged or unreviewed `aiScore` so it stays out of both the
  student publish and the Canvas push.

## The review gate (invariant)

Instructor-only scores and the AI likelihood / "vibecode" flag never reach
students. The student-facing text is prose only. An AI grade reaches a student
only through a deliberate human review here, then a generated Intent that the
human dispatches. The AI acts; the human decides.
