# Architecture

最終更新: 2026-11-03

---

## 全体構成

<figure class="architecture-map" role="group" aria-labelledby="architecture-map-title">
<figcaption id="architecture-map-title">Vyline の通信経路</figcaption>
<div class="architecture-layer">
<div class="architecture-node"><small>01 · FRONTEND</small><strong>apps/desktop</strong><span>React + Vite — 画面と操作</span></div>
<div class="architecture-connector"><span>HTTP · WebSocket</span><b aria-hidden="true">↓</b></div>
<div class="architecture-node"><small>02 · BACKEND</small><strong>Hono on Bun</strong><span>api/ → lineService → clientManager</span></div>
<div class="architecture-connector"><span>@vyline/protocol</span><b aria-hidden="true">↓</b></div>
<section class="architecture-protocol" aria-label="protocol の内部レイヤー">
<div class="architecture-node protocol-title"><small>03 · PROTOCOL</small><strong>packages/protocol</strong></div>
<div class="architecture-branches">
<div><strong>domain/</strong><span>プロフィール・チャットの facade</span></div>
<div><strong>dictionary/</strong><span>RPC 名と Desktop 証拠</span></div>
<div><strong>login/ · e2ee/ · obs/</strong><span>ログイン・暗号化・メディア</span></div>
</div>
<div class="architecture-down"><span>Thrift RPC</span><b aria-hidden="true">↓</b></div>
<div class="architecture-flow">
<div class="architecture-node"><small>STACK</small><strong>Talk · Login · OBS</strong><span>/S4 · /api/v3p/rs</span></div>
<div class="architecture-connector"><span>vendored Thrift types</span><b aria-hidden="true">↔</b></div>
<div class="architecture-node"><small>LINE SERVER</small><strong>LINE Legy / OBS</strong><span>Desktop 準拠の HTTP / Thrift</span></div>
</div>
</section>
</div>
</figure>

**外部 `@evex/linejs` 依存なし。** Thrift 型は `@vyline/line-types`（vendored）。

---

## レイヤー責務

| 層              | パス                       | 責務                                                                   |
| --------------- | -------------------------- | ---------------------------------------------------------------------- |
| BFF             | `backend/src/api/`         | HTTP 入出力・バリデーションのみ                                        |
| Service         | `backend/src/service/`     | アカウント単位のビジネス                                               |
| Client mgr      | `backend/src/line/`        | セッション・トークン                                                   |
| Domain          | `protocol/src/domain/`     | プロフィール / チャット / 連絡先 / トーク facade                       |
| Dictionary      | `protocol/src/dictionary/` | LINE.js 名 ↔ Desktop 証拠                                              |
| Stack           | `protocol/stack/`          | Thrift RPC（Talk `/S4` 等）。型は `_dist/`、実装は段階的ネイティブ化中 |
| Protocol        | `protocol/src/protocol/`   | stack 非依存の薄い RPC ラッパ（domain から利用）                       |
| Desktop patches | `protocol/src/login/`      | ヘッダー・login RPC の Desktop 追従                                    |

メディアは `backend/storage/saved-media/` に永続保存する。プロフィール画像や CDN
アセットなど再取得できるものは `backend/storage/cache/` に分離し、通常のキャッシュ削除で
保存メディアを削除しない。

---

## データフロー（プロフィール更新）

<figure class="architecture-map architecture-data-flow" role="group" aria-labelledby="profile-flow-title">
<figcaption id="profile-flow-title">プロフィールの変更がLINEへ届くまで</figcaption>
<div class="architecture-layer">
<div class="architecture-node architecture-frontend"><small>01 · HTTP REQUEST</small><strong>PATCH /line/:id/updateProfileAttributes</strong><span><code>displayName</code> を送る</span></div>
<div class="architecture-down"><span>backend route</span><b aria-hidden="true">↓</b></div>
<div class="architecture-node architecture-backend"><small>02 · SERVICE</small><strong>lineService.updateMyProfile</strong><span>アカウントとセッションを解決</span></div>
<div class="architecture-down"><span>domain facade</span><b aria-hidden="true">↓</b></div>
<div class="architecture-node architecture-protocol-core"><small>03 · DOMAIN</small><strong>wrapSession(client).profile.update</strong><span>プロフィール更新を protocol に委譲</span></div>
<div class="architecture-down"><span>Thrift RPC · /S4</span><b aria-hidden="true">↓</b></div>
<div class="architecture-node architecture-stack"><small>04 · STACK</small><strong>talk.updateProfileAttributes</strong><span>Desktop 準拠の RPC を送信</span></div>
<div class="architecture-down"><span>response</span><b aria-hidden="true">↓</b></div>
<div class="architecture-node architecture-server"><small>05 · REMOTE</small><strong>LINE server</strong><span>プロフィール属性を更新</span></div>
</div>
</figure>

## ディレクトリ構成

<figure class="architecture-map architecture-directory" role="group" aria-labelledby="directory-map-title">
<figcaption id="directory-map-title">役割ごとのコードの置き場</figcaption>
<div class="directory-groups">
<section class="directory-group directory-frontend" aria-labelledby="directory-frontend-title">
<h3 id="directory-frontend-title">画面</h3>
<div class="directory-entry"><code>apps/desktop/</code><span>React UI</span></div>
</section>
<section class="directory-group directory-backend" aria-labelledby="directory-backend-title">
<h3 id="directory-backend-title">アプリケーション層</h3>
<div class="directory-entry"><code>backend/api/</code><span>Hono routers</span></div>
<div class="directory-entry"><code>backend/service/</code><span>lineService などの業務処理</span></div>
<div class="directory-entry"><code>backend/line/</code><span>clientManager とセッション</span></div>
</section>
<section class="directory-group directory-protocol" aria-labelledby="directory-protocol-title">
<h3 id="directory-protocol-title">LINE通信</h3>
<div class="directory-entry"><code>packages/protocol/src/domain/</code><span>VylineSession、ProfileDomain など</span></div>
<div class="directory-entry"><code>packages/protocol/src/dictionary/</code><span>RPC 名と Desktop 証拠</span></div>
<div class="directory-entry"><code>packages/protocol/src/login/</code><span>ログイン処理</span></div>
<div class="directory-entry"><code>packages/protocol/src/e2ee/</code><span>暗号化と鍵管理</span></div>
<div class="directory-entry"><code>packages/protocol/src/obs/</code><span>メディアの送受信</span></div>
<div class="directory-entry"><code>packages/protocol/src/client/</code><span>VylineClient</span></div>
<div class="directory-entry"><code>packages/protocol/stack/</code><span>内部 protocol と Thrift RPC</span></div>
</section>
<section class="directory-group directory-shared" aria-labelledby="directory-shared-title">
<h3 id="directory-shared-title">共有型</h3>
<div class="directory-entry"><code>packages/line-types/</code><span>Thrift 型</span></div>
<div class="directory-entry"><code>packages/types/</code><span>共有 API 型</span></div>
</section>
</div>
</figure>

---

## Desktop 準拠の原則

1. **RPC 名は Desktop で確認** — `bun run vyline:find-native`
2. **Path は patchTransport / modules.map 準拠** — `/S4`, `/api/v3p/rs` 等
3. **E2EE 送信は letterSealing 優先** — stack e2ee は fallback
4. **通話は実験的に接続済み** — `useCall` → `call/start` → managed session → WebSocket PCM。実 LINE 環境での E2E 成功は継続検証対象

---

## lineService の接点（プロトコル書き換え時）

`Vyline/backend/src/service/lineService.ts` が実際に叩く API。ここが業務ロジックの正本。

### protocol 直接 import

`ensureValidE2EEIdentity`, `groupE2EE` 一式, `encryptLetterSealingMessage` / `decryptLetterSealingMessage`, `downloadObsMessageBytes`

### `Client`（= VylineClient）

| API                                       | 用途                    |
| ----------------------------------------- | ----------------------- |
| `fetchJoinedChats()`                      | グループ/ルーム一覧     |
| `fetchUsers()`                            | 友だち一覧              |
| `getUser(mid)`                            | DM プロフィール         |
| `getChat(mid)`                            | グループ情報            |
| `call.acquireRoute` / `acquireGroupRoute` | 通話ルート（managed call / UI 接続あり、実環境検証継続） |

### `client.base.talk.*`

`getProfile`, `getMessageBoxes`, `getPreviousMessagesV2WithRequest`, `sendMessage`, `sendChatChecked`, `getMessageReadRange`, `getLastE2EEGroupSharedKey`, `unsendMessage`

### `client.base.e2ee.*` / `obs.*` / `storage.*`

`e2ee.decryptE2EEMessage`（letterSealing 失敗時）, `obs.uploadMediaByE2EE` / `downloadMediaByE2EE`, `storage.get/set/delete`（`e2eeKeys:*` 等）

### domain facade（新規機能の推奨経路）

`wrapSession(client).profile` / `.chat` / `.contacts` / `.talk` — 詳細は [protocol/dictionary.md](./protocol/dictionary.md)

### 互換レイヤの関係

```
VylineClient → patchDesktopTransport / patchDesktopLogin（DESKTOPWIN 時）
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
