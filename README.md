# 📋 grader-ui

[![Made with Claude](https://img.shields.io/badge/Made_with-Claude-D97757?logo=anthropic&logoColor=white)](https://tjakoen.github.io/notes/ten-times-zero)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-2ea44f)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![Runtime deps: 0](https://img.shields.io/badge/runtime_deps-0-2ea44f)
![Build step: none](https://img.shields.io/badge/build_step-none-2ea44f)
![Design system: GRAIN](https://img.shields.io/badge/design_system-GRAIN-2ea44f)

> A local review surface for the [GitHub-Native Course Platform](https://github.com/tjakoen/github-native-course-platform). It reads your teacher repos' gradebooks, builds one static review dashboard, and generates the prompts an AI runs to apply your decisions. You review and decide; the AI does the typing.

The platform grades take-home and in-lab work with an AI, then *holds every AI grade for review*. This is where that review happens. AI-proposed grades and feedback show up in *grain* type; the moment you approve or edit one, it flips to *clean* type. Provenance is visible in the page itself, which is the one idea [GRAIN](https://tjakoen.github.io/grain) exists to make real.

## Why copy-paste prompts, not an in-app AI call

Calling a model from inside the app would need the metered Anthropic API. This tool instead *generates a prompt* you paste into your Claude Code session: the prompt is the intent, the session is the one door, and the resulting git and gh writes are what comes back. It is free on a subscription, and you review every intent before it runs. The dashboard never writes to a repo itself.

## Structure

```
src/        the tools (build-dashboard, fetch-shots, fetch-code, audit, fix, blanks)
lib/        config.mjs - single source of paths + sections
docs/       grain-for-ai, commands, usage
classes/    gitignored - your teacher-repo clones (flat, PII)
out/        gitignored - generated dashboard + assets + reports
grader.config.json          gitignored - your real sections
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

Screenshots and the code viewer are optional data passes (`node src/fetch-shots.mjs`, `node src/fetch-code.mjs`; both need `gh auth`). Full walkthrough in [docs/usage.md](docs/usage.md); the AI action vocabulary is in [docs/commands.md](docs/commands.md); how the design system applies is in [docs/grain-for-ai.md](docs/grain-for-ai.md).

## Status

Live, used to review real course grades. This repo is code and docs only. The clones it reads and everything it generates are gitignored, because they hold student data and stay on the instructor's machine.

---
🤖 **Built with Claude. I don't prompt and pray, I prompt and prove.** Every commit here is co-authored with an AI, on purpose. [How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
