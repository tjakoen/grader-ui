# GRAIN for AI

How an AI applies the GRAIN design system to this surface. GRAIN's home and full
docs live in the BREAD stack (`/grain`); this file is the working spec a coding
agent reads before touching the dashboard.

## The one law: provenance is shown in the type

- **Grain type** = the AI is acting, or a value is in transit / proposed / a
  draft. Use it for any model-generated grade or feedback that has **not** been
  human-confirmed.
- **Clean type** = a human wrote it, or it has committed. Use it the moment the
  teacher approves or edits a value.

No badges, no "AI" labels: switching provenance is a font-family swap (a class
change). In this dashboard that maps exactly onto the model: an AI-proposed
grade renders in grain type; approving or editing flips it to clean type.

## Sourdough tokens (default theme)

```css
--paper: #E2E0D8;  --paper-2: #E8E6DF;  --panel: #E8E6DF;
--ink: #1C1B17;    --ink-muted: #6E6C64;  --ink-faint: #ABA89F;
--hairline: #1C1B17;  --line-soft: rgba(28,27,23,.14);  --color-accent: var(--ink);
--s1:.25rem; --s2:.5rem; --s3:.75rem; --s4:1rem; --s6:1.5rem; --s8:2rem; --s12:3rem; --s16:4rem;
--radius: 4px;  --rule: 1.5px solid var(--hairline);  --border: 1px solid var(--hairline);

--font-smooth: "Redaction", "Times New Roman", Georgia, serif;   /* clean type */
--font-grain:  "Redaction 50", "Times New Roman", Georgia, serif; /* grain type */
--font-accent: "Redaction 70", "Times New Roman", Georgia, serif;
```

Redaction 50 / 70 are progressively grainier grades of the same face, so
"more machine / more draft" reads as more grain. The fonts must be loaded for
the metaphor to render; without them it falls back to serif and the distinction
degrades to color only.

## Rules for the agent

1. Never invent tokens. Use the variables above; re-skin only by overriding them.
2. Render any un-reviewed model output in `--font-grain`. On approve/edit, swap
   to `--font-smooth`.
3. Keep the human-review gate visible: in-transit values look in-transit.

> TODO: expand with the component-class catalog and the Intent -> RenderOps
> vocabulary once GRAIN's component docs are mirrored here.
