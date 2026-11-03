# OpenChat / Square Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an account-scoped opt-in OpenChat beta that stays completely silent until enabled, then discovers and displays Square rooms/messages through isolated APIs and SQLite.

**Architecture:** Build a strict Square boundary from BFF to the existing `/SQ1` protocol service, guarded by account enablement before any transport call. Persist Square state in a separate account database and bridge only explicitly typed Square projections into a dedicated sidebar/chat view. Add Square-only send pacing, retries, and idempotency.

**Tech Stack:** Bun, TypeScript, Hono, existing SquareService/Thrift types, SQLite (`bun:sqlite`), React/Zustand, existing i18next catalog and Vitest/Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-04-openchat-square-beta-design.md`

## Global Constraints

- Default disabled; absolutely no Square network calls before account opt-in.
- Never route Square IDs or operations through Talk `/S4`.
- Keep the Square database separate from regular-chat SQLite and namespace all IDs.
- Do not infer request/response wire fields beyond generated types and sanitized evidence.
- No live load tests or HAR replay; redact all captures and personal content.
- OpenChat official availability is Japan, Taiwan, and Thailand; Taiwan/Thailand Vyline compatibility remains unverified.
- LIFF apps are not officially supported in OpenChat; do not implement an assumed LIFF flow.
- Preserve existing regular chats and all existing locale catalogs.

## Review Focus

1. Disabled startup, reload, account-switch, and background polling must issue zero Square RPC/HTTP requests.
2. A Square ID that resembles a LINE MID must remain namespaced and never reach Talk endpoints.
3. A crash during event application must not advance the durable Square cursor past unapplied events.
4. Concurrent sends in different rooms must not serialize globally; retries use a stable operation ID, never content-equality deduplication.
5. Disabling OpenChat stops future polls; an in-flight response is discarded and cannot write to SQLite or UI.

---

### Task 1: Sanitized protocol evidence and API inventory

**Files:**
- Modify: `docs/api-rpc-mapping.md`
- Modify: `docs/analysis/evidence-first-audit.md`
- Create: `docs/analysis/openchat-square-evidence.md`
- Test: no live network tests; validate paths against generated types and sanitized structural HAR inventory

- [ ] Record only sanitized endpoint families, field names, enum definitions, confidence, and unsupported claims.
- [ ] Compare every used Square operation with generated `SquareService_*` request/result types and `/SQ1` wrapper.
- [ ] Identify any API methods missing from the open `vyline-api` PR #17; keep dependency notes explicit.
- [ ] Mark each planned capability (history, send/read, roles, threads, notes, search, media, LIFF) implemented or deferred based on exact evidence before creating a UI control.
- [ ] Record which operations are safe read-only versus confirmed state-changing; do not expose unverified admin actions.

### Task 2: Feature gate, account config, and isolated SQLite

**Files:**
- Create: `Vyline/backend/src/storage/squareStore.ts`
- Create: `Vyline/backend/src/storage/squareStore.test.ts`
- Create: `Vyline/backend/src/service/squareFeatureGate.ts`
- Create: `Vyline/backend/src/service/squareFeatureGate.test.ts`
- Modify: backend account settings/API types only if a canonical preference endpoint already exists

- [ ] Test disabled-by-default and per-account isolation before implementation.
- [ ] Add local enablement and schema version to `<accountDir>/square.sqlite`; opening a disabled account may initialize local tables but must not access `VylineClient`.
- [ ] Add tables for joined squares, rooms/parent rooms, members/roles, messages, sync cursor, and feature settings using only evidence-confirmed fields.
- [ ] Add transactional event apply + cursor commit; test restart/replay and duplicate events.
- [ ] Add disable behavior that aborts active poll loops and prevents new RPC dispatch.
- [ ] Add explicit per-account local Square-data deletion and verify ordinary chat storage is untouched.

### Task 3: Square service and BFF routes

**Files:**
- Create: `Vyline/backend/src/service/squareService.ts`
- Create: `Vyline/backend/src/service/squareService.test.ts`
- Create: `Vyline/backend/src/api/square.ts`
- Modify: `Vyline/backend/src/index.ts`
- Modify: `Vyline/backend/src/api/openapi.line.ts` or dedicated Square OpenAPI file
- Modify: protocol submodule only for evidence-confirmed missing wrappers

- [ ] Add tests proving feature-gate denial occurs before mock transport invocation.
- [ ] Add read operations for joined squares, joined rooms, room details/members, and message history only when present in generated types/evidence.
- [ ] Add incremental `fetchMyEvents` polling after explicit opt-in; commit cursor only after durable event apply. Stop future polls on disable and discard in-flight responses using a generation token.
- [ ] Add send/read/reaction routes only for verified request shapes and existing protocol methods.
- [ ] Keep note, thread, role/admin, live-talk, search, and LIFF operations capability-gated; implement each only with evidence-backed schemas and an explicit UI/action.
- [ ] Add per-account/per-room request policy, bounded concurrency, stable operation-key idempotency, Retry-After/error backoff, and tests showing cross-room independence.

### Task 4: Shared types and dedicated UI path

**Files:**
- Modify: `Vyline/packages/types/src/index.ts`
- Modify: `Vyline/apps/desktop/src/lib/store-types.ts`
- Modify: `Vyline/apps/desktop/src/lib/store.ts`
- Modify: `Vyline/apps/desktop/src/components/sidebar.tsx`
- Modify/create: dedicated Square chat panel, room browser, and detail drawer components under `apps/desktop/src/components/`
- Modify: all shipped `apps/desktop/src/i18n/locales/*.json`

- [ ] Add separate Square models with opaque Square identifiers; do not add them to ordinary `Chat`/`Message` or Talk action code unless an explicit adapter boundary is type-safe.
- [ ] Add per-account opt-in control in Beta Settings. Persist locally first; only then invoke the first Square list request.
- [ ] Add OpenChat filter/badge and keep OpenChat rows out of regular Friends/Groups/Official filters.
- [ ] Add joined-square/main-room/subroom/thread navigation and message rendering using explicit parent relationships.
- [ ] Add owner/co-owner crown badges only after enum mapping is proven from source types/evidence.
- [ ] Add user-facing notes and moderation/admin controls only after each route is verified; state-changing actions require confirmation.
- [ ] Translate keys and verify narrow/wide layouts with every locale falling back safely.

### Task 5: Notes, search, media, and capability-gated extras

**Files:**
- Modify: Square service/store/routes and dedicated Square UI from Tasks 2–4
- Create: focused tests for each evidence-confirmed capability

- [ ] Implement notes as Square-owned data and endpoints, never as ordinary LINE Timeline notes unless evidence proves that service mapping.
- [ ] Add Square search/category flow using captured endpoint schemas; debounce UI and enforce API budget.
- [ ] Add Square OBS media route/cache only for verified `g2` URL patterns; enforce host allowlisting and size limits.
- [ ] Record live-talk and LIFF as unavailable/unverified until supported flow evidence exists; do not show dead controls.
- [ ] Defer any operation that fails Task 1's evidence gate; never invent a wire schema to fill a UI requirement.

### Task 6: Documentation, tests, review, and PRs

**Files:**
- Create: `docs/openchat-square.md`
- Create: `docs/openchat-square.en.md`
- Modify: `docs/README.md`, `docs/README.en.md`, `docs/feature-capabilities.md`, `docs/api-rpc-mapping.md`, `docs/analysis/evidence-first-audit.md`
- Modify: `AGENTS.md` only if the project-wide OpenChat/i18n/testing rules need to be made durable

- [ ] Document beta state, opt-in/network boundary, IDs, database schema, sync, supported capabilities, rate policy, rollback, and troubleshooting in Japanese and English.
- [ ] Document Japan/Taiwan/Thailand availability accurately; explicitly mark Taiwan and Thailand Vyline testing as pending and request accounts/PRs from maintainers.
- [ ] Run focused tests, typecheck, lint, full tests, frontend production build, OpenAPI parity, and source/docs scans for accidental HAR values.
- [ ] Run a browser smoke test with the feature disabled and enabled against mocked data; do not log in or mutate real LINE accounts.
- [ ] Request code review, open the required API and product PR(s), and retain an explicit dependency on any unmerged protocol PR.
- [ ] Do not merge or release without the repository’s required review/approval.
