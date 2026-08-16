---
name: web-design-elite
description: Produces top-tier modern web and desktop app UI design. Use when the user asks for UI, UX, web design, frontend redesign, dashboard design, landing pages, SaaS UI, React UI, Tailwind, shadcn, glassmorphism, bento grids, dark mode, "make it modern", "make it cool", "ダサい", "かっこいい", or similar visual design work.
---

# Web Design Elite

## Quality Bar

Do not produce generic "dark glass cards" or a first-draft developer UI. The target is premium product quality: Linear, Supabase, Sentry, Vercel, shadcn/ui blocks, Mobbin, Awwwards-grade SaaS, and high-end X-style liquid glass where appropriate.

## Required Workflow

1. Reference first:
   - Search current examples when the user asks for modern, cool, trendy, or X-inspired UI.
   - Prefer concrete references: Linear-style dashboard surfaces, Supabase dark data density, Sentry problem-first hierarchy, shadcn dashboard shells, dark bento UI kits, and X liquid glass navigation.
   - Summarize the design direction before implementation.

2. Choose a clear design thesis:
   - Dark developer tool: near-black canvas, surface-tier elevation, 1px borders, restrained accent.
   - Premium SaaS: asymmetric bento grid, large hero tile, metrics tiles, activity feed, command panel.
   - Liquid glass: translucent navigation/header only where legibility remains strong.
   - Editorial/clean: light surfaces, whitespace, crisp typography, minimal chrome.

3. Build tokens before components:
   - Surface tiers, text tiers, border, accent, success, warning, danger.
   - Avoid pure black and pure white for large areas.
   - Depth should come from surface lightness, border, blur, and layout, not heavy shadows.

4. Make hierarchy obvious:
   - One primary focal area per screen.
   - Use bento spans for importance, not decoration.
   - Metrics and active states must be readable within 3 seconds.
   - Keep controls close to the data they affect.

5. Add polish:
   - Hover/focus states.
   - Empty/loading/error states.
   - Subtle motion only; never distract from operational UI.
   - Keyboard-visible focus states.

6. Verify:
   - Run typecheck/build for frontend changes.
   - Check contrast mentally at minimum: primary text must be clearly readable on every surface.
   - Remove visual clutter before finishing.

## Design Recipes

### Dark Bento Dashboard

- Canvas: `#08090a` to `#121212`.
- Cards: `#161617`, `#1e1e1e`, or translucent equivalents.
- Borders: `rgba(255,255,255,0.08)` to `0.14`.
- Text: primary `#e6e6e6`, secondary `#a3a3a3`.
- Accent: one desaturated blue/violet/green, used sparingly.
- Grid: 4 or 12 columns, 16-24px gap, exactly one large hero/control tile.

### Linear-Style App Shell

- Left sidebar with quiet active state: slim accent rail or subtle filled pill.
- Header is functional, not decorative.
- Cards are lifted by surface tier and border, not glow.
- Use monospace for numbers, file IDs, rates, and paths.

### X Liquid Glass

- Use translucent blur for persistent nav/top bars.
- Keep content panes more opaque for legibility.
- Use blue accent sparingly for active/primary state.
- Avoid high transparency over dense text.

## Anti-Patterns

- Too many gradients.
- Random emojis as icons.
- Cards with identical sizes and no hierarchy.
- Low-contrast gray text on transparent panels.
- Oversized rounded corners everywhere.
- Decorative blur that makes data harder to read.
- Shipping UI without settings, empty states, or error states when the product needs them.
