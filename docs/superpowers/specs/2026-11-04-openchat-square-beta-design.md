# OpenChat / Square Beta Design

## Intent

Add an explicitly opt-in, beta OpenChat experience to Vyline. Once enabled for an account, joined OpenChat rooms should be discoverable and usable from the chat UI, with Square-specific identity, storage, synchronization, safety controls, and documentation.

## Evidence and status

- The current product has no dedicated UI → BFF → service → Square chain. The protocol package already contains a `SquareService` using `/SQ1` and many generated request/response types.
- The supplied HAR is 98 MB. A redacted, read-only inventory found 5,303 total requests and 147 requests on paths matching Square/OpenChat indicators. Only endpoint paths, operation/type key names, and aggregate counts are used; credentials, request/response values, IDs, and message text are excluded.
- Observed endpoint families include Square search/category, live-talk, joined/left-member management, OpenNote, and Square statistics. HAR observation does not prove completeness or authorize guessing schemas.
- The LINE Help Center says OpenChat is available in Japan, Taiwan, and Thailand. Taiwan-specific account behavior remains unverified in this implementation; Thailand behavior is also not covered by the supplied capture.
- LINE Developers says LIFF apps are not officially supported in OpenChat. Do not assume a LIFF1 request observed in the HAR is a supported OpenChat integration. Only add an external LIFF/open-web handoff if the captured action and response establish its purpose.
- LINE Messaging API rate limits apply to Messaging API endpoints/channels and must not be misrepresented as limits for the private Square `/SQ1` protocol. Square pacing therefore uses Vyline-side safety policy and server errors as evidence, without claiming LINE-published Square thresholds.

## Goals

1. Square remains fully disabled by default. Before explicit enablement, no Square RPC, Square REST, Square OBS, Square polling, or Square search request is sent. Local UI reads of the feature flag are allowed.
2. Enabling is explicit and account-scoped. Disabling stops future background requests and hides Square UI. The current Square wrapper cannot cancel an already-dispatched RPC; its response must be discarded with an enablement generation token. Cached data remains until explicit deletion.
3. Use Square identifiers as opaque, namespaced IDs. Never interpret them as LINE MIDs or pass them through Talk `/S4` operations.
4. Keep Square data in an account-scoped Square SQLite database, separate from ordinary chat history and its migrations.
5. The required beta path is joined-square/room discovery, room history, and text send/read only where exact operations and response/cursor contracts are confirmed by generated types plus HAR or Desktop evidence. Any failing that gate is deferred without an active UI control.
6. Model Square main rooms, subrooms, threads, roles, announcements, notes, and member profiles separately instead of flattening them into ordinary group semantics.
7. Add an opt-in beta control, visible OpenChat identity, a distinct sidebar filter, and Japanese/English plus all shipped UI locales.
8. Apply Square-specific request budgets, per-room pacing, bounded concurrency, operation-key retry idempotency, and backpressure. Identical text with a new operation key remains a separate intentional message. Different rooms must remain independently usable; a send in one room must not impose a global sequential wait on another room.
9. Preserve observed protocol payloads exactly and add fixtures using sanitized structural data only.

## Non-goals and safety boundaries

- No OpenChat request before opt-in, including “warm-up” or capability probes.
- No unverified message, member, role, note, live-talk, or LIFF request schema inferred from names alone.
- No claim of official `/SQ1` rate limits. Do not load-test LINE; rate-control tests use mocks/local fixtures.
- No automatic account joining, leaving, inviting, role changes, deletion, reporting, or moderation actions. Destructive/admin operations require explicit UI confirmation and only appear when confirmed by captured evidence.
- No OpenChat-to-Talk chat-ID fallback, MID conversion, or ordinary-group mutation.
- Do not include HAR values or personal content in source, fixtures, logs, docs, screenshots, issue/PR comments, or generated artifacts.
- No assumption that LIFF apps work inside OpenChat. Official docs state they are not supported there.
- Do not claim Taiwan or Thailand live compatibility without a corresponding account/device verification.
- Users can explicitly delete all cached Square data for the current account. This removes the separate Square database without affecting ordinary chat history. Existing backup/export paths do not include that database unless explicitly extended and tested.

## Architecture decisions

- Dedicated module boundary: `square` BFF routes → `squareService` → `SquareService` `/SQ1`; use `/g2` OBS for Square message media only where capture confirms it.
- Feature gate: a small account-scoped local configuration record is read before any Square client method. Route guards reject while disabled. The toggle persists locally first; its first network action begins only after that state commits.
- Persistence: `data/accounts/<safe-account-id>/square.sqlite`; tables are Square-prefixed and contain enablement/sync cursor, squares, rooms, members, messages, thread/note state, and timestamps. Use opaque `(account_id, square_mid, square_chat_mid)` keys and dedupe events by Square event/message IDs. Existing chat database is not migrated or rewritten.
- Sync: persist `fetchMyEvents` cursor only after all returned events are durably applied. Fetch room history through the Square-specific history operation and reconcile by Square message ID/revision. Polling is enabled only after opt-in and uses bounded backoff. Disable stops scheduling polls; in-flight responses are discarded and cannot update DB/UI.
- UI: expose a beta enable control; add an OpenChat filter and badge. Keep existing regular chat code paths intact. Square selection dispatches only to Square APIs. Use explicit main-room/subroom/thread relationships and render role badges only from verified Square role fields.
- Rate safety: a Square-only per-account token bucket/concurrency bound plus per-room send cooldown. A stable client operation key prevents a transport retry from dispatching the same send twice; content equality is never deduplicated. No cross-room serialization. Values are Vyline policy, not LINE specifications.
- i18n: add canonical Japanese keys and translations/fallbacks across the existing locale catalog; preserve dynamic user-generated text verbatim.

## Validation

- Offline tests prove disabled-by-default and zero Square transport calls before opt-in, per-account isolation, independent rooms, bounded send pacing, operation-key idempotency, cursor crash safety, disable-generation response discard, explicit cache deletion, namespaced IDs, role-to-badge mapping, and note/thread relationships.
- SQLite tests use temporary test databases only.
- API tests use captured/sanitized structural fixtures or mocked Square service responses. Do not replay HAR requests against live LINE.
- Desktop tests cover enable/disable, empty/loading/error states, locale overflow, regular-chat regression, and OpenChat filter behavior.
- Live external LINE validation is optional and requires a user-owned test account; if absent, mark the result unverified rather than claiming end-to-end success.

## Official references

- [LINE OpenChat user guide](https://guide.line.me/ja/services/openchat.html)
- [LINE Help: OpenChat availability](https://help.line.me/line/smartphone?a8=.V&contentId=20014753&lang=en)
- [LINE Help: subchats and OpenChat sync](https://help.line.me/line/?contentId=20024116&lang=ja)
- [LINE Developers: LIFF overview](https://developers.line.biz/ja/docs/liff/overview/)
- [LINE Developers: Messaging API rate limit behavior](https://developers.line.biz/en/tips/2026/09/10/messaging-api-rate-limits/)

## Decisions left to evidence

- Exact message/event semantics, unread cursor units, role mapping, and subroom/thread parents are a go/no-go gate per capability: implement only with fixture-backed evidence or defer without a live control.
- Availability and behavior of note, member-management, live-talk, and profile operations by region/account type remain capability-by-capability and may be marked partial or unavailable.
- User-facing version remains beta; no stable-release claim is made by this change.
