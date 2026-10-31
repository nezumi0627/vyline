# Vyline Storage and Offline Quality Plan

> **For agentic workers:** Execute task by task with TDD. Preserve all unrelated working-tree changes, including the pre-existing dirty protocol submodule changes.

**Goal:** Move Vyline-managed persistent application state out of JSON files into SQLite (backend) or IndexedDB (browser), while preserving JSON only for interchange/export, and make core behavior verifiable without LINE network access.

**Architecture:** Use Bun's built-in SQLite through `backend/src/storage/sqlite.ts`, with indexed chat/message rows so common reads do not hydrate the full history into memory. Message fields, metadata, reactions, readers, edit/revoke history, snapshots, read watermarks, sync cursors, and box order are stored in relational tables. Use IndexedDB for browser-local persisted state. Keep old JSON files read-only as recovery copies after transactional import; JSON remains only for migration and interchange/export.

**Tech Stack:** Bun, `bun:sqlite`, TypeScript, React, IndexedDB, `bun:test`.

**Spec:** User request in this conversation: improve Vyline-wide performance and offline verification; remove JSON-managed persistent state in favor of faster storage.

## Global Constraints

- Edit only inside `E:\projects\Vyline\Vyline\`.
- Preserve chat order, message tie-breaking, read watermarks, revoked snapshots, reactions, history, backup import/export, and account isolation.
- No LINE network calls or sends in offline tests.
- Keep JSON only as a migration source, backup/export format, or protocol interchange format.
- Do not delete old JSON files; keep them as recovery copies until separately authorized.
- Do not alter the already-dirty protocol submodule in this worktree.

## Review Focus

- Legacy import is interrupted or malformed: transaction rolls back, the source file remains intact, and normal reads do not silently overwrite it.
- Equal timestamps and non-numeric local IDs: pagination order matches existing comparison rules.
- Read receipts and local read watermarks: persisted monotonic state never regresses.
- Large history: `getMessages` and bootstrap only read requested rows; full history is read only for explicit export/rebuild operations.
- Browser storage unavailable or partially migrated: app retains usable defaults and does not discard the old local value.

## Tasks

### 1. Make storage migration and query behavior offline-testable

- [x] Ensure new backend SQLite storage tests set `VYLINE_DATA_DIR` to a temporary directory before importing modules that open SQLite; make SQLite connection lazy.
- [x] Add `bun:test` migration coverage for synthetic legacy chat JSON, malformed-source retry, and migration from the previous SQLite JSON-payload schema. Reopen/idempotence coverage remains.
- [x] Add query tests for stable descending order, timestamp/ID cursor boundaries, read state, and an indexed bounded result page.

### 2. Move `chatStore` to indexed SQLite records

- [x] Normalize message scalar fields, nested metadata, reactions, readers, edit/revoke history, snapshots, read watermarks, sync cursors, and box order into relational records.
- [x] Import per-account and legacy flat chat JSON once inside a transaction, preserving source files and throwing on malformed data instead of treating it as empty.
- [x] Move ordinary `getMessages`, `getStoredChats`, message mutation, and read-state paths to indexed SQL; reserve all-message materialization for backup/export/rebuild.
- [ ] Bound memory and write amplification in explicit backup/export/rebuild paths.
- [x] Run targeted offline tests and backend typecheck; these tests use synthetic local fixtures and make no LINE calls.

### 3. Move remaining backend JSON state

- [x] Move `VylineStorage` profile/group and read-range cache records to SQLite key rows; opaque values remain serialized payloads.
- [x] Migrate message detail logs to indexed relational SQLite rows, preserving the settings API response and bounding retention. Legacy JSONL imports once and remains as a recovery copy; new entries include message IDs for replay.
- [x] Migrate plugin enabled state and per-plugin settings to SQLite without changing plugin SDK contracts.
- [x] Replace the protocol KV JSON file with account-scoped SQLite storage and require login callers to inject a storage adapter.

### 4. Move browser-local persisted state

- [x] Add an IndexedDB adapter for Zustand stores and high-volume direct caches.
- [x] Import existing localStorage values on first IndexedDB read and retain source values as fallback.
- [ ] Cover cross-window cache invalidation and browser-runtime migration verification. IndexedDB now also owns TOS and beta consent; legacy localStorage values are read-only import sources.

### 5. Complete behavior and performance audit

- [ ] Add offline regression cases for scroll anchoring, unread position, read-receipt failure, delta merge, and cache corruption.
- [ ] Review bounded queues, caches, listener cleanup, and pagination for remaining CPU/memory risks; change only code-evident bottlenecks.
- [ ] Run targeted tests, full typecheck, and lint; document any blocked gate caused by pre-existing ignored files or dirty submodules.

#### Latest audit changes

- [x] Bound in-memory media and CDN caches by bytes (24 MiB / 32 MiB) and use insertion-order LRU eviction instead of sorting the cache on eviction.
- [x] Cap the large profile cache to the two most recently used accounts.
- [x] Bound the live microphone PCM queue to 48 KiB (~500 ms), discard stale frames under backpressure, and release queue/waiters on call cleanup.
- [x] Avoid sorting all accounts' messages for a single chat update; sort only that chat's merged rows.
- [x] Use a Set for message search hits and a per-chat ID Map for reply previews; use an ID Map for custom chat ordering.
- [x] Render virtual-list spacers from estimated heights before measurement and cancel pending measurement/reply-jump animation frames on unmount/change.
- [x] Stop writing migrated browser state back to localStorage; old values remain read-only migration sources. IndexedDB is the active persistent store.
- [x] Move TOS and beta-feature consent to IndexedDB; beta consent remains disabled if its record cannot be saved.
- [x] Store normal chat history in relational SQLite tables; legacy JSON and SQLite JSON payloads migrate transactionally and remain recoverable.
- [x] Batch message-page hydration into a fixed set of relational queries instead of per-message metadata/history/snapshot queries.
- [x] Update per-chat message sync cursors and box order incrementally, avoiding full account metadata delete/reinsert during routine sync.
- [x] Move chat detail log persistence from JSONL to indexed relational SQLite rows; stream-import legacy logs once, keep the source file, bound stored bytes, and persist message IDs for replay.
- [x] Move protocol client key/value writes to account-scoped SQLite rows for email, QR, and token logins; import the old protocol JSON file once and retain it for recovery.
- [x] Remove the protocol client's JSON-file default; login callers must inject persistence, and the one-shot key extraction utility uses in-memory storage.
- [x] Coalesce virtual-list scroll updates to one animation frame and recalculate visible rows when the viewport is resized; add an offline range regression test.
- [x] Replace read-receipt full-message sorting with a single pass and prevent an older failed request from clearing a newer receipt attempt.
- [x] Include the SQLite database and WAL/SHM files in the settings storage total and breakdown.

#### Remaining evidence-gated work

- Browser runtime behavior has no available browser automation in this environment; Vite production build and adapter tests are the current offline gates.
- Desktop `tsc -b` is blocked by the ignored local file `apps/desktop/src/newui/data/themePacks.ts` importing missing `../types/settings`; do not edit ignored user data.

