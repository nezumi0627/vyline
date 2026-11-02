# Documentation tour implementation plan

> Execute inline with executing-plans. Use a final whole-branch review.

**Goal:** A black/white guided documentation experience and coherent v1.0.3 installation documentation.

**Architecture:** Static HTML/CSS/JS, dependency-free Bun Markdown build, existing GitHub Pages deployment. Repository Markdown remains the documentation source.

**Tech stack:** Bun, semantic HTML, CSS, browser JavaScript.

**Spec:** ../../design/2026-11-03-documentation-tour.md

## Global constraints

- Do not read the former website or its rendering source.
- No real LINE connections or message sends. No secret/session copies.
- Use release v1.0.3 and the real assets; no macOS native installer claims.
- Respect keyboard use, mobile widths, reduced motion and blocked storage.
- Root docs/README/workflow edits are explicitly requested and override the general Vyline-only editing guideline.

## Review focus

- GitHub Pages `/Vyline/` prefix and document fragment/link resolution.
- OS changes, deep links and back/forward navigation preserve a consistent tour.
- Clipboard/storage restrictions show useful fallback behavior.
- Generated documentation does not turn historical/partial features into current guarantees.
- Build destination cannot delete source files or recurse into itself.

## Tasks

- [ ] Build: add a failing integration test for new output, local links, prefix and output safety. Replace former build entry unread; implement static copy and Markdown rendering.
- [ ] Experience: create website index, styles and JS. Implement OS-specific command guidance, a three-stage setup flow, product story, task-based document search, accessible mobile navigation and copy feedback. Do not add a simulated chat or settings preview.
- [ ] Content: add OS installation guides and consolidated feature content; update documentation ownership/index and start page. Improve both README sources and regenerate outputs.
- [ ] Verify: run build tests, README check, browser interaction checks, link audit and visual review at desktop/mobile widths. Update deployment triggers. Review the whole branch and fix findings.
- [ ] Delivery: commit and push the task branch, open a PR for review, attach it, and preserve work until merge approval. Clean up only the task-created worktree after merge.

## Execution record

- Baseline: origin/main d95c5e8, app version already 1.0.3. `vyl:doctor` reports missing submodule/dependencies/environment in fresh worktree; documentation build deliberately requires none of those.
- Prior `docs-tour` worktree has unrelated uncommitted changes; it is preserved untouched.
- Existing website source not opened. Current docs and actual release assets checked.

## User-directed refinement

The interface is now split into a one-screen home, a guided OS installation route, a three-chapter product story, task-based Docs discovery, and deep article pages. Removed the simulated chat/theme playground and default full document list. The article page remains the approved detailed format. See the design record for updated decisions.
