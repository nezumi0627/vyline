# Architecture

最終更新: 2026-07-29

---

## 全体構成

```
┌─────────────────────────────────────────────────────────┐
│              Frontend (React + Vite)                     │
│         apps/desktop — UI は別タスクで改善               │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────┐
│              Backend (Hono on Bun)                       │
│  api/  →  service/lineService  →  line/clientManager     │
└──────────────────────────┬──────────────────────────────┘
                           │ @vyline/nezuline
┌──────────────────────────▼──────────────────────────────┐
│  nezuline                                                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ domain/     │  │ dictionary/  │  │ login/ e2ee/    │ │
│  │ (facade)    │  │ (RPC map)    │  │ obs/ desktop/   │ │
│  └──────┬──────┘  └──────────────┘  └────────┬────────┘ │
│         └─────────────────┬─────────────────┘          │
│                           ▼                             │
│                      stack/ (Talk /S4, Login, OBS)      │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  LINE Legy / OBS (Desktop 準拠 Thrift + HTTP)             │
└───────────────────────────────────────────────────────────┘
```

**外部 `@evex/linejs` 依存なし。** Thrift 型は `@vyline/line-types`（vendored）。

---

## レイヤー責務

| 層 | パス | 責務 |
|---|---|---|
| BFF | `backend/src/api/` | HTTP 入出力・バリデーションのみ |
| Service | `backend/src/service/` | アカウント単位のビジネス |
| Client mgr | `backend/src/line/` | セッション・トークン |
| Domain | `nezuline/src/domain/` | プロフィール / チャット / 連絡先 / トーク facade |
| Dictionary | `nezuline/src/dictionary/` | LINE.js 名 ↔ Desktop 証拠 |
| Stack | `nezuline/stack/` | Thrift RPC（Talk `/S4` 等）。型は `_dist/`、実装は段階的ネイティブ化中 |
| Protocol | `nezuline/src/protocol/` | stack 非依存の薄い RPC ラッパ（domain から利用） |
| Desktop patches | `nezuline/src/login/` | ヘッダー・login RPC の Desktop 追従 |

---

## データフロー（例: プロフィール更新）

```
PATCH /line/:id/profile { displayName }
  → lineService.updateMyProfile
  → wrapSession(client).profile.update
  → stack talk.updateProfileAttributes  (/S4)
  → LINE server
```

---

## ディレクトリ構成（抜粋）

```
Vyline/
├── apps/desktop/          # React UI
├── backend/
│   ├── api/               # Hono routers
│   ├── service/           # lineService 等
│   └── line/              # clientManager
└── packages/
    ├── nezuline/
    │   ├── src/
    │   │   ├── domain/    # VylineSession, ProfileDomain, …
    │   │   ├── dictionary/
    │   │   ├── login/ e2ee/ obs/
    │   │   └── client/    # NezuClient
    │   └── stack/         # 内部 protocol
    ├── line-types/        # Thrift 型
    └── types/             # 共有 API 型
```

---

## Desktop 準拠の原則

1. **RPC 名は Desktop で確認** — `bun run nezu:find-native`
2. **Path は patchTransport / modules.map 準拠** — `/S4`, `/api/v3p/rs` 等
3. **E2EE 送信は letterSealing 優先** — stack e2ee は fallback
4. **通話 UI は未接続** — `acquireRoute` のみ backend 残置

---

## lineService の接点（プロトコル書き換え時）

`Vyline/backend/src/service/lineService.ts` が実際に叩く API。ここが業務ロジックの正本。

### nezuline 直接 import

`ensureValidE2EEIdentity`, `groupE2EE` 一式, `encryptLetterSealingMessage` / `decryptLetterSealingMessage`, `downloadObsMessageBytes`

### `Client`（= NezuClient）

| API | 用途 |
|---|---|
| `fetchJoinedChats()` | グループ/ルーム一覧 |
| `fetchUsers()` | 友だち一覧 |
| `getUser(mid)` | DM プロフィール |
| `getChat(mid)` | グループ情報 |
| `call.acquireRoute` / `acquireGroupRoute` | 通話ルート（UI 未接続） |

### `client.base.talk.*`

`getProfile`, `getMessageBoxes`, `getPreviousMessagesV2WithRequest`, `sendMessage`, `sendChatChecked`, `getMessageReadRange`, `getLastE2EEGroupSharedKey`, `unsendMessage`

### `client.base.e2ee.*` / `obs.*` / `storage.*`

`e2ee.decryptE2EEMessage`（letterSealing 失敗時）, `obs.uploadMediaByE2EE` / `downloadMediaByE2EE`, `storage.get/set/delete`（`e2eeKeys:*` 等）

### domain facade（新規機能の推奨経路）

`wrapSession(client).profile` / `.chat` / `.contacts` / `.talk` — 詳細は [protocol/dictionary.md](./protocol/dictionary.md)

### 互換レイヤの関係

```
NezuClient → patchDesktopTransport / patchDesktopLogin（DESKTOPWIN 時）
          → letterSealing + groupE2EE（自前 E2EE）
          → stack talk/obs/e2ee（vendored RPC 本体）
```

Desktop 調査フロー: [tools/find-native-symbol.md](./tools/find-native-symbol.md) / `source/desktop/`（gitignore）

---

## 関連ドキュメント

- [onboarding.md](./onboarding.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [protocol/dictionary.md](./protocol/dictionary.md)
- [development.md](./development.md)
