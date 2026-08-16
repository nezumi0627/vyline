---
name: ui-studio-design
description: Designs and reviews high-end UI/UX, layout, design systems, desktop app workbenches, dashboards, landing pages, forms, tables, motion, accessibility, and usability. Use when the user asks to build, redesign, improve, review, or plan UI/UX, layout, visual design, settings screens, dashboards, desktop apps, web apps, React/Tauri UI, or design tasks.
---

# UI Studio Design

## Use This Skill

Use this skill before creating, redesigning, reviewing, or planning UI. Do not rely on vague words like "beautiful" or "modern". Build from references, component rules, usability, visual hierarchy, accessibility, and motion constraints.

If the user asks for implementation, first produce a short design thesis and task plan unless the change is tiny.

## Reference Stack

Use these ideas as design intelligence, not as code to blindly copy:

- UI UX Pro Max: large design-style, palette, typography, UX guideline, and product-pattern database.
- 21st.dev Magic MCP: component inspiration, polished interactions, glass/gradient examples when available.
- LiftKit: ratio-aware spacing, proportion, and consistent component geometry.
- ui-design-brain: component-specific best practices, common layouts, anti-patterns, and accessibility.
- emilkowalski/skills: taste in motion, easing, interaction feedback, restraint, and polish.

For source notes, read [REFERENCE.md](REFERENCE.md). For task output, use [TASK_TEMPLATE.md](TASK_TEMPLATE.md).

## Required Workflow

1. Identify the product type: desktop app, dashboard, SaaS, landing, admin, content, mobile, utility, or data tool.
2. Identify the primary job-to-be-done and the one main action per screen.
3. Choose an information architecture before choosing colors.
4. Define design tokens: color, type, spacing, radius, border, elevation, motion, state colors.
5. Choose component patterns deliberately: navigation, forms, tables, panels, inspectors, dialogs, toasts, empty states.
6. Design all states: idle, loading, validating, ready, running, success, warning, error, cancelled, empty, offline.
7. Verify usability: keyboard path, focus, contrast, labels, destructive action confirmation, reduced motion.
8. Only then implement.

## Default Taste

Prefer practical, premium, restrained interfaces:

- Clear hierarchy over decoration.
- Fewer surfaces, stronger alignment.
- 4px/8px grid with occasional ratio-based larger spacing.
- Real content density for tools and desktop apps.
- Text labels plus icons, never icon-only for core actions.
- State colors are semantic and consistent.
- Motion is short, purposeful, interruptible, and accessible.

Avoid:

- Generic Bootstrap card grids.
- Huge hero sections in tools.
- Random gradients, heavy glow, excessive glassmorphism.
- Centering everything because it is easy.
- Hiding critical state in logs only.
- Color-only status communication.
- Forms without validation, examples, disabled states, and error recovery.

## Desktop App Rules

For desktop work apps, prefer a workbench:

- Left: navigation and global status.
- Center: current task, table, form, or queue.
- Right: selected item inspector.
- Bottom: collapsible logs or activity drawer.

Home/Overview should show status and shortcuts only. Put actual workflows in their own screens.

For long-running jobs:

- Show current phase, progress, speed, ETA, active file/item, and logs.
- Provide cancel for every running or pending job.
- Treat "cancelling" as a visible intermediate UI state if the backend is cooperative.
- Show completion, failure, skip, and cancellation in toasts and history.

## Component Rules

Navigation:
- Keep stable position and width.
- Active item must have text, color, and shape indicators.

Forms:
- Inputs need labels, examples, validation, helper text, disabled/submitting states.
- Validate before submit and preserve drafts where useful.

Tables:
- Use tables for operational data.
- Include sorting/filtering/search when lists can grow.
- Use monospace for IDs, URLs, paths, speed, ETA, file sizes, and timestamps.

Panels and inspectors:
- The main screen should not duplicate inspector details.
- Inspector shows selected item metadata, actions, related logs, and raw details.

Toasts:
- Use for completed, failed, cancelled, saved, and queued events.
- Keep them short and link to the relevant screen when possible.

Dialogs:
- Use for destructive or broad actions only.
- Cancel-all, delete cache, reset settings, and overwrite require confirmation.

## Visual System Defaults

Use dark tool UI by default when the product is operational:

- Backgrounds: near black, then two subtle surface levels.
- Borders: 1px solid for containers, 1px dashed for sections or drop zones.
- Shadow: minimal; use surface contrast and borders first.
- Accent: one cool color for focus and primary actions.
- Radius: small, consistent, not bubbly.
- Typography: system sans for text, monospace for operational values.

Use glassmorphism or gradients only when they support comprehension. For utility apps, keep them faint or omit them.

## Motion Rules

Use:

- 100-180ms hover/focus/press feedback.
- 150-240ms panel open/close.
- 200-300ms progress width changes.
- `ease-out` or `cubic-bezier(0.2, 0, 0, 1)`.

Avoid:

- Looping decorative animations.
- Long transitions over 400ms for core operations.
- Moving backgrounds.
- Full-page shimmer.
- Motion that makes tables harder to scan.

Honor `prefers-reduced-motion`.

## Accessibility Gate

Before finalizing UI, check:

- Keyboard-only operation.
- Visible focus states.
- Text contrast: normal text 4.5:1, supporting text at least 3:1.
- `aria-live` for async results and errors.
- `role="progressbar"` with values for progress.
- Buttons begin with verbs and describe the target.
- Secrets are masked by default.

## Output Format

For design tasks, return:

1. Design thesis.
2. Information architecture.
3. Screen-by-screen responsibilities.
4. Design tokens.
5. Component rules.
6. State and edge-case matrix.
7. Implementation tasks with acceptance criteria.
8. Verification checklist.
