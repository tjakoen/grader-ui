# GRAIN for AI

How this dashboard uses the GRAIN design system. The short version: it does not
re-implement the look, it **consumes the real package**. `@tjakoen/grain` is a
dependency, and its CSS and fonts are inlined into the dashboard at build time.
GRAIN's home and full docs live in the BREAD stack (`/grain`); this file is the
working spec a coding agent reads before touching the theme.

## The one law: provenance is shown in the type

- **Grain type** = the AI is acting, or a value is in transit, proposed, a draft.
  Use it for any model-generated grade or feedback that has **not** been
  human-confirmed.
- **Clean type** = a human wrote it, or it has committed. Use it the moment the
  teacher approves or edits a value.

No badges, no "AI" labels: switching provenance is a font-family swap. In this
dashboard the AI-proposed score renders in grain type; approving or editing flips
it to clean type.

## Where the theme comes from (do not fork it)

`src/build-dashboard.mjs` resolves grain's CSS from the installed package with
`import.meta.resolve('@tjakoen/grain/styles/...')`, reads it, and inlines it into
the dashboard `<style>`:

- `styles/variables.css` - the Sourdough tokens (paper, ink, the `--font-smooth`
  / `--font-grain` / `--font-accent` grade families, spacing, radius) and the
  light/dark scheme. Its optional flavor `@import`s are stripped and its
  `@font-face` `url("/fonts/*.woff2")` are rewritten to embedded `data:` URIs, so
  the dashboard is one offline file (it holds student PII and opens as a local
  file, no CDN or node_modules at view time).
- `styles/grain.css` - the grade-as-signal MECHANISM: `[data-grade="grain"]`,
  `.field` (grain at rest, clean on focus), `[data-commit="pending"]`.
- `styles/themes/baguette.css` - the active flavor (crisp near-white / near-black
  with a soft-blue accent), applied via `data-theme="baguette"` on the root.
  Sourdough is grain's hueless default; grader-ui opts into Baguette. Light and dark
  still follow grain's `data-color-scheme` axis.

The grade cells (green pass to red fail) are grader-ui's own, not grain's, since
grain is monochrome by doctrine. Their tint is scheme-aware (`curScheme()` reads
the live `data-color-scheme`, so a manual theme toggle recolors them, and dark uses
a softer hsl so the colors do not go muddy).

grader-ui adds only a thin bridge (its layout aliases like `--bg`, `--acc` mapped
onto grain's real tokens) plus the few things grain is monochrome about on
purpose but a grading matrix genuinely needs (status hues, syntax colors). Dark
mode follows grain's `data-color-scheme` axis.

## Rules for the agent

1. **Never re-fork the theme.** Tokens, fonts, and the grade mechanism come from
   `@tjakoen/grain`. If the look needs to change, change it in grain and bump the
   dependency, do not hardcode values back into the dashboard.
2. **Use grain's mechanism for provenance,** not a bespoke class: mark un-reviewed
   model output with `data-grade="grain"` (or `.field` for an editable value); it
   settles to clean type when a human commits.
3. **Keep the offline guarantee.** Anything grain references externally (fonts)
   must be embedded at build time. No CDN or node_modules reference may survive
   into the generated HTML.
4. **Only grain.** grader-ui needs `@tjakoen/grain`, not batch/mill/proof.
