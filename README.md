# grader-ui

A local review surface for the GitHub-native course platform. It reads the
teacher repos' gradebooks, builds a static **grading-review dashboard**, and
generates the **prompts an AI runs** to apply your decisions (write grades,
publish feedback, push to Canvas). You review; the AI acts.

It is built on the **GRAIN** design system: one interface where a human and an
AI operate the same controls, and provenance is shown in the type itself
(AI-proposed / in-transit vs. human-committed). See [docs/grain-for-ai.md](docs/grain-for-ai.md).

## Why copy-paste prompts (not an in-app API call)

Calling a model from inside the app needs the metered Anthropic API. This tool
instead **generates a prompt** you paste into your Claude Code session: the
prompt is the GRAIN *Intent*, the session is the *one door*, and the resulting
`git`/`gh` writes are the *RenderOps* that come back. Free on a subscription,
and the human reviews every Intent before it is dispatched.

## Structure

```
src/        the tools (build-dashboard, fetch-shots, fetch-code, audit, fix, blanks)
lib/        config.mjs  - single source of paths + sections
docs/       grain-for-ai, commands, usage
classes/    GITIGNORED - your teacher-repo clones (flat, PII)
out/        GITIGNORED - generated dashboard + assets + reports
grader.config.json          GITIGNORED - your real sections
grader.config.example.json  committed template
```

## Quickstart

```bash
cp grader.config.example.json grader.config.json   # then edit your sections
# clone each teacher repo (flat) into classes/:
#   classes/teacher-<subject>-<section>-<you>/
node src/build-dashboard.mjs        # -> out/grading-review.html
open out/grading-review.html
```

Screenshots + code panes are optional data passes: `node src/fetch-shots.mjs`
and `node src/fetch-code.mjs` (both need `gh auth`). See
[docs/usage.md](docs/usage.md) and [docs/commands.md](docs/commands.md).
