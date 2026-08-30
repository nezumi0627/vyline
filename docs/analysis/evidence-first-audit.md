# Evidence First Audit — API / RPC / Type / Feature Capability

最終更新: 2026-08-31

## Status

D担当の監査成果物。対象は API、RPC、generated/custom type、Desktop evidence、全機能 capability、実行可能 test/runtime evidence の接続確認。

評価の基本単位は次の Evidence Chain とする。

```text
user behavior
  → frontend consumer
  → BFF route
  → service
  → domain / stack
  → RPC / request-response type
  → Desktop evidence
  → tests / runtime behavior
```

chain の途中だけ確認できた機能を `verified` としない。外部 LINE server を必要とする機能は、live E2E を実行していない場合は原則 `partial` とした。

## Desktop evidence baseline

- Desktop version: `26.4.2.3957`
- installed `LINE.exe` SHA-256: `893d899f3b39d9cef59752067166b7e72c6f7021e1841b24b617ab079cf8f2b1`
- analysis/unpacked binary SHA-256: `f85053950282da89b91fec090dd2b40aa165a593e249016f000287a939359577`

installed binary と analysis/unpacked binary は別物なので hash を混同しない。

## Investigated

- `backend/src/api/line.ts`: LINE BFF route 実体、重複 route、chat/message/profile/contact/group/call/Album/Note 周辺。
- `backend/src/api/openapi.line.ts`: 実 BFF と OpenAPI route coverage。
- `backend/src/api/auth.ts`, `backend/src/line/clientManager.ts`: email/QR/token/restore/switch/session flow。
- `backend/src/service/lineService.ts`: BFF から protocol へ至る主要 service flow。
- `backend/src/call/callManager.ts`, `apps/desktop/src/hooks/useCall.ts`: call control と WebSocket PCM chain。
- `packages/protocol/src/dictionary/rpcMap.ts`: RPC dictionary と Desktop evidence。
- protocol stack HEAD baseline: Talk `/S4`, Relation `/RE4`, Square `/SQ1`。
- `packages/protocol/src/login/patchLogin.ts`, `patchTransport.ts`: login `/api/v3p/rs`, RSA `/api/v3/TalkService.do`。
- Album REST / Timeline Note REST implementation。
- storage、backup/import、subdevice、plugin、diagnostics、frontend store の executable tests。

## Findings

### 1. Relation RPC path contradiction

`getContactsV3` は `/S4` ではない。RelationService wrapper と Desktop symbol の evidence により `/RE4` が正しい。同じく `getTargetProfiles` も `/RE4`。

修正後の evidence:

```text
RelationService
  protocolType = 4
  requestPath = /RE4

getContactsV3
  RelationService_getContactsV3_pargs / presult
  LINEStruct.getContactsV3_args
  LINETypes.getContactsV3_result["success"]

getTargetProfiles
  RelationService_getTargetProfiles_pargs / presult
  LINEStruct.getTargetProfiles_args
  LINETypes.getTargetProfiles_result["success"]
```

### 2. `getChat` naming contradiction

dictionary の canonical RPC 名は Desktop/stack evidence に合わせ `getChats` とする。上位 facade が singular helper を持つ場合でも RPC canonical name と混同しない。

### 3. stale BFF documentation

古い docs に profile/contact の BFF path が残っていた。現 route は以下。

```text
GET   /line/:accountId/getProfile
PATCH /line/:accountId/updateProfileAttributes
GET   /line/:accountId/getContact/:targetMid
PATCH /line/:accountId/updateContactSetting/:mid
```

### 4. Calls documentation contradiction

一部 docs は「通話 UI はダミー / 未接続」としていたが、現実装には以下の chain が存在する。

```text
apps/desktop/src/hooks/useCall.ts
  → api.line.callStart
  → POST /line/:accountId/call/start
  → backend/src/call/callManager.ts managed session
  → /line/:accountId/call/ws?sessionId=...
  → binary PCM microphone / remote playback
  → api.line.callEnd
```

したがって「未接続」は誤り。ただし live LINE call の成功 evidence は今回ないため capability は `partial`。

### 5. OpenChat/Square overclaim risk

frontend の通常チャット選択用 `openChat()` は Square/OpenChat protocol evidence ではない。

protocol baseline には SquareService `/SQ1` と多数 RPC が存在するが、現 worktree で専用 frontend → BFF → backend → Square chain を確認できないため `unverified` とした。

### 6. OpenAPI coverage

最終確認で機械比較を再実行し、通常 BFF route は OpenAPI に欠落なし。

```text
BFF routes:     136
OpenAPI routes: 137
BFF_ONLY:       none
OPENAPI_ONLY:   GET /line/{accountId}/call/ws
```

`call/ws` は通常 Hono route ではなく `backend/src/index.ts` の WebSocket upgrade に実体があるため、OpenAPI 側の追加 1 件は ghost route ではない。

### 7. Duplicate cache route

`backend/src/api/line.ts` に重複していた後段の `DELETE /:accountId/vyline/cache` は削除。先行 route を正本として維持する。

## Changes

- `packages/protocol/src/dictionary/rpcMap.ts`
  - `/RE4` を transport path として追加。
  - `getContactsV3`, `getTargetProfiles` を Relation evidence に修正。
  - `getChat` の canonical naming を `getChats` に修正。
  - Desktop `26.4.2.3957` で確認した Talk `/S4` RPC evidence を追加。
- `backend/src/api/openapi.line.ts`
  - 実 BFF に存在する route coverage を追加。
- `backend/src/api/line.ts`
  - duplicate cache delete route を除去。
- `docs/protocol/dictionary.md`
  - `/S4`, `/RE4`, `/SQ1` の boundary と Desktop evidence/hash を更新。
  - stale profile/contact route を修正。
- `docs/CONTRIBUTING.md`, `docs/architecture.md`, `docs/onboarding.md`
  - stale call dummy 記述を現 call chain に合わせて修正。
- `docs/feature-capabilities.md`
  - 全機能の capability matrix を追加。
- `docs/api-rpc-mapping.md`
  - BFF / service / RPC / type / transport mapping を追加。

## Executable evidence

root の通常 Bun 設定は、現在削除されている次の preload を参照している。

```text
./Vyline/packages/protocol/stack/test-preload.ts
```

そのため通常 `bun test ...` は test discovery 前に以下で停止する。

```text
error: preload not found "./Vyline/packages/protocol/stack/test-preload.ts"
```

ユーザー既存削除を復元しないため、監査中のみ preload を持たない一時 Bun config を使用し、stack import に依存しない test 群を実行した。

結果:

```text
17 test files
39 pass
0 fail
103 expect()
```

さらに protocol の stack preload を必要としない対象を個別実行した。

```text
packages/protocol/src/login/importDesktopE2EE.test.ts
packages/protocol/src/sbc/sbc.test.ts

13 pass
0 fail
48 expect()
```

ここには Desktop E2EE key import/normalize、Curve25519 pubkey derive、SBC backup key merge、Argon2id LINE profile、fake server を使った PIN/claim/verify/backup-key restore、shared-secret restore が含まれる。

主な PASS evidence:

- tokenStore account isolation + legacy migration
- encrypted credential handoff roundtrip
- Windows DPAPI secret roundtrip
- subdevice pairing/session blocking
- installation ID binding
- LAN pairing URL policy
- plugin lifecycle activate/deactivate
- diagnostics persistence / levels / disable / retention
- credentials / PII / JWT redaction
- read-state merge / watermark
- iOS history → chatdb mapping
- iOS backup parser / keybag / extract safety
- unsend standard / premium policy
- frontend account switching / last-opened chat / read-disabled persistence
- VylineBackup path sanitization

## Verification summary

- `bun run build`: PASS。desktop production build 完了。
- `bunx biome check Vyline/backend/src/api/openapi.line.ts`: PASS。
- `bun run lint`: D担当の OpenAPI 整形差分を修正後、残りは既存 UI 2 ファイル (`vy-theme-panel.tsx`, `UiCatalogPage.tsx`) の formatter 差分のみ。監査対象外のため未変更。
- `bun run typecheck`: FAIL。`@vyline/protocol/stack`, `/stack/base`, `/stack/call` 等が現在の preserved worktree で削除されているため protocol package から停止。
- `bun test`: FAIL。root Bun config が削除済み `./Vyline/packages/protocol/stack/test-preload.ts` を preload しているため test discovery 前に停止。
- BFF/OpenAPI mechanical comparison: `136 vs 137`, `BFF_ONLY = none`, `OPENAPI_ONLY = GET /line/{accountId}/call/ws`。WebSocket route は `backend/src/index.ts` の upgrade 実装で確認済み。

## Current worktree verification limitation

`Vyline/packages/protocol/stack/**` の大量削除はユーザー既存変更であり、今回の監査では復元/reset/checkout していない。

preload だけを迂回しても stack import 自体を必要とする test は失敗する。

確認済み例:

```text
backend/src/service/androidBackupService.test.ts
  Cannot find module '@vyline/protocol/stack' from packages/protocol/src/index.ts

backend/src/service/lineService.readReceipts.test.ts
  Cannot find module '@vyline/protocol/stack/thrift' from backend/src/service/lineService.ts
```

`readTargets` 系も同じ依存 chain の影響を受ける。この failure は D担当の変更で stack を壊した evidence ではなく、監査開始前から存在する preserved worktree state による validation limitation。

## Contradiction report

| contradiction | evidence | resolution |
| --- | --- | --- |
| `getContactsV3` を `/S4` とみなす記述 | Relation wrapper + `RelationService_*` Desktop symbols | `/RE4` に修正 |
| `getTargetProfiles` の Relation path 不明瞭 | Relation wrapper + generated args/result | `/RE4` と明記 |
| canonical `getChat` | Talk stack/Desktop は `getChats` | dictionary canonical name を `getChats` に修正 |
| profile/contact docs の旧 route | `backend/src/api/line.ts` 実 route | docs を現 path へ修正 |
| Calls が dummy/未接続 | `useCall` → BFF → call manager → WebSocket PCM | docs を experimental/partial に修正 |
| 通常 `openChat()` を Square evidence と扱う可能性 | 専用 Square BFF/product chain が見つからない | Square は `unverified` |
| installed と unpacked Desktop hash の混同 | 2 binary の SHA-256 が異なる | docs で別々に記載 |

## Unsupported backlog

`unsupported` は「検索で見つからなかった」だけでは付けない。今回 evidence-backed に完全非対応と断定した feature row はない。

ただし product layer では Dedicated OpenChat/Square frontend/BFF chain を確認できていない。protocol baseline が存在するため、全体 capability は `unsupported` ではなく `unverified` に保持する。

## Unknown backlog

- live LINE login: email / QR / token / restore の実成功と failure semantics。
- Talk/Relation RPC ごとの server timeout、retry、rate-limit、idempotency。根拠なしに共通 policy を仮定しない。
- media OBS の全 content type に対する live E2EE upload/download roundtrip。
- message edit/react/reply/mention の live payload roundtrip。
- Album / Note external REST の現行 server compatibility。
- live call negotiation/音声双方向の実 LINE 成功。
- Square/OpenChat の product-layer wiring と live `/SQ1` compatibility。
- Backup create → restore の完全 roundtrip。
- Android restore は stack deletion 解消後に再実行が必要。
- Theme visual regression と third-party Plugin compatibility/security matrix。
- updater の実配布 artifact を使った end-to-end update。

## Related docs

- `docs/feature-capabilities.md`
- `docs/api-rpc-mapping.md`
- `docs/protocol/dictionary.md`
