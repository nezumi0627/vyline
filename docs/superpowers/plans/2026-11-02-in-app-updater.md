# In-App Updater and Installer Hardening Plan

> **For agentic workers:** Execute this plan task by task with test-first changes.

**Goal:** Make releases discoverable and installable from Vyline's information screen, identify builds as `V<version>(<short-commit>)`, and harden Windows/Linux installation without risking user data.

**Architecture:** Keep GitHub Releases as the source of release metadata and artifacts. The UI checks the current stable release, identifies the matching artifact for the browser OS, shows release notes, and lets the user download it; platform installers remain responsible for applying files. Embed the build commit SHA in Vite output. Keep user data outside install directories and make Linux install replacement atomic with rollback.

**Tech Stack:** Bun, TypeScript, React, Vite, GitHub Releases API, Inno Setup, Bash.

**Spec:** User request in this conversation.

## Global constraints

- Preserve the existing semantic package version and GitHub `v<version>` tag convention; show the requested `V<version>(<7-char SHA>)` build identity.
- Never silently execute a downloaded installer. Verify GitHub release metadata and use HTTPS links tied to this repository.
- Keep authentication, account data, chats, and backups outside install replacement paths.
- Do not modify the pre-existing dirty checkout at `E:\projects\Vyline` until a safe update strategy is established.
- Delete only this task's worktree after completion; retain its remote PR branch.

## File map

- `Vyline/apps/desktop/src/lib/updater.ts` and `.test.ts`: release/version/platform selection and metadata validation.
- `Vyline/apps/desktop/src/components/settings-sections.tsx`: in-app update center in INFO.
- `Vyline/apps/desktop/vite.config.ts`, `src/vite-env.d.ts`: embed current commit identity.
- `installer/Vyline.iss`: remove broad process termination from uninstall; preserve user data.
- `installer/install-linux.sh` and shell tests: staged, rollback-capable package replacement.
- `docs/distribution.md`: supported package/update workflow and macOS limitation.

## Tasks

1. Add failing tests for display-version formatting, OS artifact selection, and release URL/digest validation.
2. Implement commit SHA embedding, safe release metadata parsing, and OS-specific update details.
3. Build the INFO update center with explicit check state, release notes, package download, and release-page fallback.
4. Add failing Linux installer tests using temporary directories; implement staged replacement and rollback while keeping data directories untouched.
5. Remove global `taskkill` uninstall commands and document Windows update behavior and current platform artifacts.
6. Run focused tests, desktop typecheck, lint, full project verification, and release/package checks where the host supports them; review all diffs.
7. Open a PR from this task branch. Update the local checkout only after preserving its existing tracked, untracked, and submodule changes; report if safe in-place update cannot be proven.

## Verification

- Unit tests for current-version formatting, tag normalization, platform-specific asset selection, malformed metadata, digest formats, and update comparison.
- Linux installer integration tests run exclusively in temporary directories with synthetic files.
- Desktop typecheck/build and repository tests/lint.
- Windows Inno Setup compile/runtime smoke is CI-only unless ISCC is installed on the host; do not claim it ran locally otherwise.
- Verify local user-data paths are unchanged and the original dirty checkout remains recoverable.
