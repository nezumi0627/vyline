# Release and What's New Integration Plan

> Implementation is being carried out in the task worktree. This plan records the acceptance path for review.

**Goal:** Align version checking, release publication, update UI, and What's New behavior while preserving the current installer and persisted app data.

**Architecture:** Keep the updater service and UI, expose the root package version as the product source, and reuse one What's New presentation for startup and settings. Make channel/version validation and release asset selection pure functions with focused tests; keep update installation explicitly user initiated.

**Tech Stack:** Bun, TypeScript, React, Zustand, Vite, GitHub Actions.

**Spec:** User-provided "Vyline — バージョン管理・アップデーター・What's New 統合改善指示書".

## Global Constraints

- Preserve current verified download, SHA-256, and user confirmation behavior.
- Stable update notices use GitHub's latest stable release; prereleases remain valid What's New versions.
- Never mutate published tags/releases or user data.
- Do not add dependencies or claim unsupported macOS packaging.
- Keep existing workspace dirty changes outside this worktree untouched.

## Review Focus

- Strict SemVer prerelease ordering, malformed inputs, and build metadata.
- Beta installs must not be offered an older Stable downgrade.
- Manual What's New must leave seen version unchanged and return to Settings after reload.
- Release assets must be canonical and match supported OS/architecture; unsupported targets stay unavailable.
- Release jobs must not publish prereleases as Docker latest or GitHub Latest.

### Task 1: Updater SemVer, channels, and asset trust

**Files:** `Vyline/apps/desktop/src/lib/updater.ts`, `updater.test.ts`.

- [ ] Add comparison, strict tag, stable/prerelease, asset, and failure-state tests.
- [ ] Implement strict SemVer precedence and validate stable latest metadata and matching assets.
- [ ] Preserve the five-minute cache and explicit installer confirmation.

### Task 2: What's New and settings return flow

**Files:** `store.ts`, `VylineApp.tsx`, `hub-home.tsx`, new reusable What's New component, `settings-sections.tsx`, `store-types.ts`.

- [ ] Cover persistent manual-open state and dismissal semantics.
- [ ] Reuse one presentation for automatic and settings modes; keep local content available offline.
- [ ] Add exact-version GitHub release lookup with safe CHANGELOG fallback.

### Task 3: Updater states and product version validation

**Files:** `updater-page.tsx`, `sidebar.tsx`, `vite.config.ts`, `product version` source, tests.

- [ ] Distinguish checking, current, available, unavailable, error, download, and launch failure.
- [ ] Verify host and architecture selection; do not offer unbuilt macOS artifacts.
- [ ] Use root package version as canonical and add a release consistency command.

### Task 4: Version bump and release CI

**Files:** `scripts/bump-version.ts`, version script tests, `.github/workflows/release.yml`.

- [ ] Support stable bumps, alpha/beta/rc sequencing, promotion, and strict validation.
- [ ] Remove tag creation from bump; validate tags against commit and all product version sources in release CI.
- [ ] Mark prereleases explicitly, prevent Docker latest updates, and publish only after platform artifacts are ready.

### Task 5: Verification

- [ ] Run focused updater and bump tests, then requested typecheck, lint, full tests, and desktop build.
- [ ] Inspect final diff and report any platform packaging or environment limits.
