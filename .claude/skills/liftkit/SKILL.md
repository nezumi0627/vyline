---
name: liftkit
description: >-
  Applies LiftKit design formulas—golden-ratio scaling, proportional spacing,
  optical symmetry, and Material-style color ramps—when building or reviewing
  UI. Use when the user mentions LiftKit, Chainlift, golden ratio UI, ratio-based
  spacing, proportional components, Dynamic Color, or wants mathematically
  consistent padding, radii, typography, and color tokens in Next.js (or
  Tailwind via community fork).
---

# LiftKit

Source: [Chainlift/liftkit](https://github.com/Chainlift/liftkit) · Docs site: [chainlift.io/liftkit](https://www.chainlift.io/liftkit)

LiftKit is a UI framework whose core value is **platform-agnostic formulas** for scale, spacing, and color that enforce optical symmetry, balanced proportions, and smooth color ramps. Prefer these rules even when the project does not install the package—borrow the math, not only the components.

> **Caveat:** Upstream marks current releases as not recommended for production; a rewrite around Base UI is in progress. Still use the design formulas below. Install components only when the user explicitly wants LiftKit in the project.

## When to Use

- User asks for LiftKit, golden-ratio UI, or proportional spacing/radii
- Building Next.js UI that should feel optically balanced
- Defining tokens (size, gap, radius, type) that must stay consistent
- Reviewing UI for arbitrary one-off sizes

## Core Math (Golden Ratio Scale)

Root scale factor:

```css
--lk-scalefactor: 1.618; /* φ */
```

Derived steps (approximate):

| Token | Formula | ≈ Value |
|-------|---------|---------|
| `--lk-wholestep` | φ | 1.618 |
| `--lk-halfstep` | √φ | 1.272 |
| `--lk-quarterstep` | φ^0.25 | 1.128 |
| `--lk-eighthstep` | φ^0.125 | 1.062 |

Size ladder from `1em` mid (`--lk-size-md`):

```
3xs ← 2xs ← xs ← sm ← md(1em) → lg → xl → 2xl → 3xl → 4xl
each step × or ÷ --lk-scalefactor
```

**Rules for agents:**

1. Pick one base (usually body `1rem` / component `1em`).
2. Derive padding, gap, icon size, radius, and control height from that base via φ steps—not arbitrary px.
3. Prefer fewer distinct sizes; if two values are close, snap to the nearest scale step.
4. Nest spacing: parent gap ≥ child gap by at least one halfstep when hierarchy matters.
5. Match icon optical size to text: icon ≈ text size or text × halfstep, not random.

## Design Principles to Enforce

- **Optical symmetry:** Align edges and centers; balance left/right padding around icons+labels.
- **Proportional geometry:** Button height, horizontal padding, and radius share the same scale.
- **Smooth color ramps:** Primary / on-primary / container / on-container pairs; surface container tiers (lowest → highest); semantic error/warning/success/info with matching containers.
- **No one-off magic numbers** for spacing or radius unless documenting a temporary exception.

## Token Mapping (Non-LiftKit Projects)

When the project uses Tailwind/CSS variables instead of LiftKit packages, mirror the system:

```css
:root {
  --scale: 1.618;
  --space-md: 1rem;
  --space-sm: calc(var(--space-md) / var(--scale));
  --space-xs: calc(var(--space-sm) / var(--scale));
  --space-lg: calc(var(--space-md) * var(--scale));
  --radius-md: calc(var(--space-md) / var(--scale));
}
```

Map to existing design tokens rather than inventing a parallel system.

## Install in a Next.js Project (Only If Requested)

Official support today: **Next.js without requiring Tailwind runtime** (a `tailwind.config.ts` may still be generated for the registry).

**Existing project:**

```bash
npm install @chainlift/liftkit --save-dev
npx liftkit init
# accept package.json "add" script and shadcn if prompted
npm run add base          # CSS + types
npm run add button        # one component (kebab-case)
# or: npm run add all
```

Import CSS:

```css
@import url("@/lib/css/index.css");
```

**Template:**

```bash
git clone https://github.com/Chainlift/liftkit-template.git
```

**Community Tailwind fork** (unsupported by Chainlift): [liftkit-tailwind](https://github.com/jellydeck/liftkit-tailwind)

If React 19 peer warnings appear, user may need `--force`; ask before forcing.

## Component Catalog (Registry)

Common Next.js registry components: `badge`, `button`, `card`, `column`, `container`, `dropdown`, `grid`, `heading`, `icon`, `icon-button`, `image`, `navbar`, `row`, `section`, `select`, `snackbar`, `switch`, `tabs` / `tab-*`, `text-input`, plus layers (`state-layer`, `material-layer`).

Installing one component may pull dependencies (e.g. Badge → Icon). Unused CSS is intended to tree-shake at build time.

## Known Issues to Avoid Replicating

- Button variants explode because padding depends on icon presence and is not prop-driven—prefer a small explicit size API when designing similar components.
- Production readiness is limited until the Base UI rewrite lands.

## Workflow

1. Confirm whether the user wants **formulas only** or **actual LiftKit install**.
2. Define `--lk-scalefactor` (default 1.618) and the size ladder.
3. Assign type scale and control sizes from the ladder.
4. Assign surface/semantic colors as paired ramps.
5. Implement layout (Row/Column/Grid/Section patterns) before decorative styling.
6. Review: every spacing/radius value should map to a named step.

## Related Skills

- `ui-ux-pro-max` — industry styles, palettes, typography search
- `ui-studio-design` — end-to-end UI planning and review
- `web-design-elite` — premium visual execution

For install FAQ and links, see [REFERENCE.md](REFERENCE.md).
