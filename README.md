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

## How to use it (you review, the AI applies)

The loop is the same every time, and the AI only ever acts on a decision you already made:

1. **Build.** Pull the teacher repos so the gradebooks are current, then run `node src/build-dashboard.mjs` and open *out/grading-review.html*.
2. **Review.** Open the AI Review tab. Each held grade shows the automated score, the AI-proposed score in grain type, the screenshots or code, and two feedback boxes (student-facing prose and instructor-only notes). Approve, override the score, flag for a closer look, or edit the text. Editing flips it from grain to clean, because now a human wrote it.
3. **Generate the intent.** Hit a Generate prompt button. The dashboard writes one prompt holding every decision you made, and blanks anything you flagged or skipped so it stays out of both the student publish and the Canvas push.
4. **Run it.** Paste that prompt into a Claude Code session opened in the teacher repo. The AI does the writing: the gradebook, the feedback files, the Canvas push. You watch it happen and keep the final say.

Nothing reaches a student or Canvas from a grade you did not review. The dashboard decides nothing on its own; it makes your decisions legible and hands them to the AI as one reviewed instruction. The exact prompts it emits are catalogued in [docs/commands.md](docs/commands.md); the full walkthrough is in [docs/usage.md](docs/usage.md).

## Structure

```
src/        the tools (build-dashboard, fetch-shots, fetch-code, audit, fix, blanks)
lib/        config.mjs - single source of paths + sections
docs/       grain-for-ai, commands, usage
classes/    gitignored - your teacher-repo clones (flat, PII)
out/        gitignored - generated dashboard + assets + reports
grader.config.json          gitignored, OPTIONAL - overrides only (labels, dirs, exclude)
grader.config.example.json  committed example of those overrides
```

## Quickstart

```bash
npm install                          # pulls @tjakoen/grain (the theme) from GitHub Packages
# clone each teacher repo (flat) into classes/:
#   classes/teacher-<subject>-<section>-<you>/
node src/build-dashboard.mjs        # -> out/grading-review.html
open out/grading-review.html
```

The look comes from the `@tjakoen/grain` design-system package, inlined at build time so the dashboard stays one offline file. The committed *.npmrc* points `@tjakoen` at GitHub Packages; that registry needs a token even for public packages, so add one line to your own *~/.npmrc* (never committed) with a PAT or `gh auth token` that has `read:packages`:

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

Sections are **auto-discovered** from *classes/*: the folder name gives the subject and section, the git remote gives the org, and each repo's *grader/assignments.json* says which activities have screenshots. There is nothing to configure. Drop a teacher clone in *classes/*, rebuild, and it shows up. *grader.config.example.json* documents the optional overrides (nicer tab labels, a different classes/out dir, an exclude list); copy it to *grader.config.json* only if you want them.

Screenshots and the code viewer are optional data passes (`node src/fetch-shots.mjs`, `node src/fetch-code.mjs`; both need `gh auth`). Full walkthrough in [docs/usage.md](docs/usage.md); the AI action vocabulary is in [docs/commands.md](docs/commands.md); how the design system applies is in [docs/grain-for-ai.md](docs/grain-for-ai.md).

## Status

Live, used to review real course grades. This repo is code and docs only. The clones it reads and everything it generates are gitignored, because they hold student data and stay on the instructor's machine.

---
🤖 **Built with Claude. I don't prompt and pray, I prompt and prove.** Every commit here is co-authored with an AI, on purpose. [How I actually work with AI, receipts and all →](https://tjakoen.github.io/notes/ten-times-zero)
