# Vyline CLI and History Performance Plan

> **For agentic workers:** Preserve unrelated working-tree changes and keep all message-send verification offline.

**Goal:** Provide a GUI-free CLI for common account operations, keep message paging bounded during pending writes, and make command and storage documentation agree with the code.

**Architecture:** The CLI is a separate Bun entry point that reuses existing backend services. Local history reads use SQLite without a login; online operations restore only the selected session and skip background indexing. Message pagination reads the indexed SQL page and overlays only queued message writes.

**Tech Stack:** Bun, TypeScript, React, SQLite, Markdown.

**Spec:** User request in this conversation: add CLI startup, simplify commands for profile/read-receipt/history operations, optimize rendering and older-message loading, and consolidate documentation.

## Global Constraints

- Do not send messages or evade service enforcement; do not retry ambiguous sends automatically.
- Keep output machine-readable JSON and never print credentials.
- Keep local history commands usable without network access.
- Preserve existing data, read watermarks, and cursor ordering.

## Review Focus

- Missing or multiple account IDs produce actionable errors without opening a session.
- Local history pagination preserves equal-time and numeric/non-numeric ID ordering.
- Online CLI commands stop the selected account's watchers on completion.
- Pending SQLite writes override stale database rows without sorting full history.
- Docs list commands that exist and identify old JSON as migration-only.

## Tasks

### CLI entry and command reference

- [x] Add a standalone CLI entry with account, profile, contact, chats, local/remote history, read-receipt, and mark-read commands.
- [x] Add a no-background session login option for short CLI operations.
- [x] Verify CLI help; local-history execution in a synthetic data directory remains unverified.
- [x] Add the in-scope docs index and CLI/safe-send references; repair the protocol README links.

### History and rendering hot paths

- [x] Merge only pending message IDs into an indexed SQLite page while writes are debounced.
- [x] Defer today's transcript scan until the AI summary feature is enabled and memoize it by inputs.
- [x] Run the SQLite paging regression and backend/desktop typechecks. Build gate not run.

### Safe message delivery

- [x] Classify ambiguous outcomes, rejections, and platform restrictions; ambiguous retries require history refresh and explicit duplicate confirmation.
- [x] Document error-specific recovery; rate-limit and abuse-block outcomes stop without retry.
