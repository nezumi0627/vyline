# Settings and Beta Productionization Implementation Plan

> **For agentic workers:** execute in independent testable slices. Preserve existing local changes and account data.

**Goal:** Reorganize settings, fix text-only scaling, and safely promote selected Beta features while improving privacy, notifications, backup, and support flows.

**Architecture:** Keep the existing React settings route and Hono/API service patterns. Move feature access from Beta booleans to first-class settings/actions, use browser Notification APIs only while the app page is alive, and persist block snapshots per account in SQLite with diff-only updates. Keep uncertain LINE block-detection results explicitly labeled as estimates.

**Tech Stack:** React, Zustand, TypeScript, Hono, SQLite, Bun tests, CSS variables.

**Spec:** `docs/design/settings-and-beta-productionization-2026-10-31.md`

## Tasks

### 1. Settings navigation and text sizing

- Add tests for a stable document root font size and text-scale CSS variable.
- Remove font scaling from `:root` `font-size`; preserve the selected scale only on message, composer, and chat-preview text.
- Group settings navigation by user task, increase section spacing, and rename INFO.
- Reduce density in `VyThemePanel`; keep theme colors dynamic and add/retain background image selection and preview.
- Remove OpenCode Go and duplicate author links.

Acceptance: changing font scale changes text targets while root rem-based dimensions stay constant; all navigation groups remain keyboard-accessible.

### 2. Promote existing Beta functions

- Move manual block-status confirmation onto the contact profile without a feature toggle.
- Remove the all-friends automatic block verification setting and polling effect.
- Move MID lookup to the add-friend flow; provide profile-only view before a separate add action.
- Remove Agent I Beta gating; retain explicit consent and data-sharing disclosure.
- Move iTunes/Apple Devices restore into the production backup/restore section.

Acceptance: existing persisted settings hydrate safely; no automatic bulk LINE lookup is triggered.

### 3. Notifications, privacy, and media behavior

- Add a separate web-notification preference and permission flow, including browser-denied state and a content-preview privacy option.
- Extend streamer mode to independently mask names, avatars, URLs, MIDs, and status text; use the specified recommended mask defaults when enabled.
- Add media-auto-save setting, default ON; disabling it prevents background persistence but preserves explicit save actions.

Acceptance: notification permission and app preference remain distinct; privacy options apply consistently to lists, headers, profiles, and message URLs.

### 4. Block list and Beta inference

- Add an account-scoped SQLite block snapshot and diff-based refresh/upsert/delete path with legacy fallback.
- Keep known “blocked me” results separate from unverified contacts, with timestamp and low-frequency refresh.

Acceptance: no cross-account rows; a failed LINE refresh does not erase the last known state; inferred results are never labeled as official.

### 5. Backup size and support

- Add a read-only backup-estimate API based on selected chats and optional media sizes.
- Display estimated bytes with an explicit estimate label before backup creation.
- Rename raw debug-log access to user-facing support diagnostics; preview and redact the export before user-triggered save/share.
- Clarify Desktop restore wording and place both Desktop and iTunes imports under backup/restore.

Acceptance: estimate does not mutate data; diagnostic data is not transmitted automatically.

### 6. Verification

- Run targeted frontend/backend tests, typechecks, lint, and build.
- Run the existing backend/Desktop test scripts serially where temporary SQLite state is shared.
- Verify settings navigation, text scaling, theme background, profile block check, MID profile/add flow, browser notification permission states, and restore placement in the running UI.
- Review `git diff` to ensure pre-existing work and user data remain intact.
