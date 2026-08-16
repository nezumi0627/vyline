# UI Studio Design Reference

## Sources

- UI UX Pro Max: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- UI UX Pro Max alternative index: https://github.com/Icattj/ui-ux-pro-max
- 21st.dev Magic MCP: https://github.com/21st-dev/Magic-MCP
- LiftKit article: https://gigazine.net/news/20260212-liftkit-ui/
- LiftKit site: https://www.chainlift.io/liftkit
- ui-design-brain: https://github.com/carmahhawwari/ui-design-brain
- emilkowalski skills: https://github.com/emilkowalski/skills

## What To Borrow

UI UX Pro Max:
- Treat UI generation as design-system generation, not styling.
- Pick product type, style, palette, typography, UX rules, chart/data patterns, and stack-specific constraints before coding.
- Include states, accessibility, responsive behavior, and interaction rules.

21st.dev Magic MCP:
- Use component examples and polished interaction patterns when a Magic MCP server is available.
- Do not depend on it blindly; adapt components to product workflow, density, and accessibility.
- Requires a 21st.dev API key before MCP installation.

LiftKit:
- Use proportion as a consistency tool.
- Spacing, radii, icon size, button height, and typography should scale from a small set of ratios.
- Avoid arbitrary one-off sizes.

ui-design-brain:
- Think in components and their known best practices.
- Every component needs behavior, accessibility, empty/error states, and common layout guidance.
- Avoid generic components without roles, labels, focus, or keyboard behavior.

emilkowalski/skills:
- Motion is part of taste. Use it to clarify cause/effect.
- Prefer `ease-out` for entry and response.
- Avoid over-animated UI and decorative motion that competes with content.
- Review interaction frequency: frequent actions need quiet feedback; rare transitions can be slightly more expressive.

## Style Presets

Modern SaaS:
- Light or dark neutral base, generous spacing, refined cards, clear CTAs.

Apple Minimal:
- Fewer borders, larger whitespace, precise typography, subtle motion.

Enterprise Tool:
- High density, tables, filters, persistent nav, keyboard support, clear states.

Operational Console:
- Dark base, side nav, workbench, inspector, logs, monospace values, semantic badges.

Creative Landing:
- Strong typography, editorial layout, richer imagery, more motion.

Data Dashboard:
- Cards only for summaries, tables/charts for detail, strong filters, consistent units.

## Design Token Checklist

- Color: backgrounds, surfaces, text, muted text, borders, accent, semantic states.
- Type: sans, mono, size scale, line height, tabular numerals.
- Spacing: 4/8 grid, section gaps, page margins.
- Radius: small, medium, large.
- Border: subtle, strong, dashed.
- Elevation: none, subtle, overlay.
- Motion: duration, easing, reduced motion.
- Breakpoints: compact, standard, wide.

## Quality Bar

The UI is not done until:

- The primary workflow is obvious without reading docs.
- The most important state is visible within three seconds.
- Errors explain recovery.
- Destructive actions are reversible or confirmed.
- Long-running jobs can be monitored and stopped.
- Empty states tell the user what to do next.
- The screen still works with real data volume.
- Keyboard and focus behavior are usable.
