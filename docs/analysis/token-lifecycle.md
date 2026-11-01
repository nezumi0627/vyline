# LINE token lifecycle in Vyline

最終更新: 2026-08-30

Vyline が扱う LINE 認証情報の種類、保存場所、自動更新、失効時の挙動をまとめる。
ここで扱う LINE token は `/v1/` 公開 API の Bearer token とは別物である。

## 目的

Vyline のログイン状態は「1 本の authToken を永久保存する」方式ではない。
V3 対応ログインでは、access token、refresh token、refresh 時刻、証明書、protocol/device 情報を組み合わせてセッションを維持する。

通常時は次の 3 段で自動回復する。

1. 起動時、access token の refresh 時刻が近い場合は refresh token を使って先に更新する。
2. 実行中は 1 分ごとに期限を確認し、設定した refresh lead（既定 7 日前）に入ったら自動更新する。
3. LINE API が `MUST_REFRESH_V3_TOKEN` を返した場合も protocol 層が refresh して元の RPC を再試行する。

LINE 側で端末認証そのものが剥奪された場合は refresh では復旧できず、再ログインが必要になる。

## Token / credential の種類

| 種類 | 用途 / スコープ | 保存 | 更新・失効時 |
|---|---|---|---|
| Primary auth/access token | Talk / Square など主要 RPC のログイン資格情報 | `data/accounts/<accountId>/credentials.json`。Windows は DPAPI (CurrentUser) で保護 | refresh token で自動更新。更新後は backend が新しい access token を再保存 |
| Refresh token | V3 access token の更新 | `data/accounts/<accountId>/protocol.json` の `refreshToken` | `/EXT/auth/tokenrefresh/v1` で利用。LINE が新しい refresh token を返した場合は必ず置き換える |
| `expire` | 次回 refresh を行う基準時刻（epoch seconds） | `protocol.json` の `expire` | `tokenIssueTimeEpochSec + durationUntilRefreshInSec` で更新 |
| V3 token result | login / refresh が返す access / refresh / issue time / duration の組 | 個々の値を上記保存先へ分解して保存 | refresh のたびに更新 |
| Email certificate | メールログイン時の端末証明 | `protocol.json` の `cert:<email>` | 有効なら再利用。端末認証失効時は再ログインが必要 |
| QR certificate | QR ログイン時の端末証明 | `protocol.json` の `qrCert` | 有効なら再利用。端末認証失効時は再ログインが必要 |
| Channel `channelAccessToken` | Channel ID ごとの REST gateway | `protocol.json` の `channelToken:<channelId>` | 401 時に invalidate → 再発行 → 1 回だけ再試行 |
| Channel response `token` | 一部 Channel RPC が返す互換フィールド | `channelAccessToken` が無い場合のみ fallback | gateway 用には `channelAccessToken` を優先 |
| Request token | `issueRequestTokenWithAuthScheme` が発行する短寿命 token | 永続保存しない | Web / auto-login フロー単位で使い捨て |
| E2EE / device secrets | E2EE 鍵・端末に紐づく protocol credential | `protocol.json` | token とは別ライフサイクル。移行時のみ暗号化 handoff に含める |

## Access / refresh token lifecycle

```text
QR / Email login
  └─ V3 token result
      ├─ accessToken ──────────────> credentials.json (DPAPI on Windows)
      ├─ refreshToken ─────────────> protocol.json
      └─ issue time + duration ────> protocol.json: expire

Vyline startup
  ├─ expire が十分先 ──────────────> 保存済み access token で復元
  └─ expire が近い / 到達済み ────> refresh token で更新してから復元

Running
  ├─ refresh lead 内 ─────────────> proactive refresh（既定 7 日前）
  └─ MUST_REFRESH_V3_TOKEN ───────> on-demand refresh + RPC retry

Refresh response
  ├─ accessToken ─────────────────> client + credentials.json を更新
  ├─ refreshToken が返る ─────────> protocol.json の旧値を置換
  └─ expire ──────────────────────> 新しい refresh 基準時刻へ更新
```

### Refresh token rotation

LINE は refresh 時に新しい refresh token を返すことがある。
この場合、古い refresh token を残すと次回以降の refresh が失敗する可能性があるため、Vyline は新しい値を protocol storage へ保存する。

サーバーが refresh token を返さない場合は、既存の refresh token を保持する。

同時に複数 RPC が refresh を要求した場合、protocol 層は in-flight refresh を共有し、同一クライアントで refresh RPC を重複実行しない。

## Automatic refresh policy

backend の token watcher は次の方針で動く。

- refresh 判定間隔: 60 秒
- refresh lead: 既定は `expire` の 7 日前。設定 > ログイン・セッションから 30日前 / 7日前 / 3日前 / 1日前 / 6時間前 / 1時間前を選択可能
- refresh 失敗時の background retry: 5 分後
- 成功時: access token を `credentials.json` に保存し、rotated refresh token と `expire` は `protocol.json` に保存
- request-level refresh: background retry とは独立して protocol request 層が処理

Vyline を refresh lead の期間中ずっと起動しておく必要はない。起動時にも同じ設定値で `expire` を確認し、更新タイミングを過ぎていれば保存済み refresh token で更新してから通常のセッション復元へ進む。

## Startup recovery

保存済みセッション復元時は `protocol.json` を確認する。

- refresh token があり、`expire` が設定した refresh lead 以内: access token を使う前に refresh
- refresh token が無い: 保存済み access token で通常復元
- `expire` が無い古いセッション: 互換性のため保存済み access token で復元し、LINE が refresh を要求した時点で request-level refresh を試す

token-only で保存されたセッションは refresh credential を持たないため、長期維持能力が低い。QR / Email など V3 credential を取得できるログイン方式を推奨する。

## Permanent revocation

以下のように LINE 側で端末 / セッション認証そのものが無効化された場合、refresh token や certificate だけで復活させることはできない。

- `NOT_AUTHORIZED_DEVICE`
- `AUTHENTICATION_DIVESTED_BY_OTHER_DEVICE`
- LINE 側で明示的にログアウト / 端末解除された場合

この場合は interactive login（QR / Email 等）が必要。
Vyline は「永久ログイン」を保証せず、LINE 側の authorization が有効な範囲で継続復元する。

## Certificate の位置づけ

certificate は access token の代用品ではない。

- `cert:<email>`: メールログイン用の証明
- `qrCert`: QR ログイン用の証明

certificate が残っていても access / refresh credential や端末認証が無効なら、そのセッションをそのまま復元できるとは限らない。
逆に access token の期限が来ただけなら、端末認証が有効で refresh token が使える限り再ログインは不要。

## linejs から確認できる primary token lifecycle

linejs の modern login は「1本の authToken を永久保存する」設計ではない。

1. QR V2 / email V2 で V3 token issue result を受け取る。
2. `accessToken` を現在の `client.authToken` として使う。
3. `refreshToken` を storage に保存する。
4. `expire` を storage に保存する。
5. access token の更新が必要になったら `/EXT/auth/tokenrefresh/v1` に refresh token を渡す。
6. 返された新しい access token へ `client.authToken` を差し替え、`update:authtoken` を発火する。
7. レスポンスに新しい refresh token が含まれていれば、古い値を置き換えて保存する。
8. 新しい `expire` を保存する。
9. push connection は auth token の変更を検知し、新しい token を使う接続へ追従する。

linejs の token 入力は access token 文字列だけでなく、`{ accessToken, refreshToken, expire }`、access/refresh の2行形式、`tokenV3IssueResult` を含む JSON も解釈する。つまり token login 自体も refresh credential を一緒に引き継げる設計になっている。

### 「ずっとログイン」を維持する条件

実用上の正解は次の組をアカウント単位で保持し、更新を循環させること。

```text
accessToken
  + refreshToken
  + expire
  + cert:<email> / qrCert
  + device / protocol storage
```

access token がまだ有効ならそのまま復元し、期限到来または `MUST_REFRESH_V3_TOKEN` を受けたら refresh を行う。refresh 成功後は access token と `expire` だけでなく、ローテーションされた refresh token も同じアカウントの storage に即座に永続化する。

「access token だけを保存した token-only session」は refresh token が無いため、失効後に自動回復できない。長期維持用途では限定的な復元方式として扱う。

## Vyline 現状

Vyline はすでに以下を実装している。

- QR / email V3 login で `refreshToken` と `expire` を `protocol.json` に保存する。
- request 層で `MUST_REFRESH_V3_TOKEN` を検出すると `tryRefreshToken()` を呼び、元リクエストを再試行する。
- refresh 成功時に新しい `accessToken` / `expire` と、返された場合はローテーション後の `refreshToken` を保存する。
- access token が変化すると backend の token watcher が `credentials.json` を更新する。
- 起動時は保存済み `authToken` と同じアカウントの protocol storage を組み合わせ、`expire` が refresh lead 内なら通常 RPC より先に refresh して session restore する。
- 実行中も token watcher が refresh lead を監視し、期限が近づいた token を自動更新する。

このため、linejs で確認した「access token + refresh token + expire を循環更新する」長期セッション方式と、現在の Vyline の主要な refresh lifecycle は揃っている。

### 復元時の推奨順序

```text
saved accessToken があり、まだ利用可能
  -> 通常 restore

expire 到来 / MUST_REFRESH_V3_TOKEN / token expiry
  -> saved refreshToken で refresh
  -> new accessToken を credentials.json に保存
  -> rotated refreshToken があれば protocol.json に保存
  -> expire 更新
  -> session 続行

refreshToken 不在 / refresh rejected
  -> cert / qrCert は保持
  -> email または QR の対話ログインへフォールバック

NOT_AUTHORIZED_DEVICE / AUTHENTICATION_DIVESTED_BY_OTHER_DEVICE
  -> access token は復活不可
  -> refresh も認可喪失なら再ログインが必要
  -> cert を authToken と同一視して無条件削除しない
```

`AUTHENTICATION_DIVESTED_BY_OTHER_DEVICE` は「保存 token の期限切れ」ではなく、その端末/session の認可が他端末操作などで失われた状態。cert が存在していても、失効した access token 自体を復活させることはできない。

## Security notes

- access token と refresh token はどちらも秘密情報。refresh token は長期 session を再発行できるため、少なくとも access token と同等に保護する。
- raw token / certificate をログ、Issue、PR、docs、診断出力へ出さない。
- Windows では `credentials.json` の primary token と同様、handoff 外の長期資格情報も OS ユーザーに紐づく保護を優先する。
- refresh-token rotation の保存は「後でまとめて」ではなく refresh 成功トランザクションの一部として扱う。クラッシュで新旧がずれると次回更新不能になり得る。

## Channel token lifecycle

`ChannelTokenManager` がアカウントの protocol storage を正本として管理する。

1. メモリ → `protocol.json` の順で既存 `channelAccessToken` を探す。
2. 無ければ `issueChannelToken` を優先して発行する。
3. 承認が必要、または usable token が返らない場合だけ `approveChannelAndIssueChannelToken` を使う。
4. 同一 channel の同時発行は 1 本へまとめる。
5. REST gateway が 401 を返した場合は保存値を破棄し、再発行して 1 回だけ再試行する。
6. API から明示再発行も可能だが、新しい token 値自体は HTTP 応答へ返さない。

現在この統一 lifecycle を VOOM、Album、Timeline 系から利用する。

## Known Channel IDs

| Channel | ID |
|---|---:|
| TIMELINE | `1341209950` |
| HOME | `1341209850` |
| HOME26 | `2007835442` |
| NOTE | `1655599932` |
| SQUARE_NOTE | `1657618623` |
| ALBUM | `1375220249` |

Note 系は操作ごとに HOME / NOTE / SQUARE_NOTE のどれを要求するかが異なる可能性があるため、HAR / Desktop 証拠を優先して選ぶ。ID を推測で統一しない。

## Account storage layout

```text
backend/data/
  accounts/
    <accountId>/
      credentials.json   # primary auth token (Windows: DPAPI) + session metadata
      protocol.json      # refresh/expire/cert/channel/E2EE/device protocol KV
  tokens.json            # legacy: read/migration only
  backups/               # chats/messages/media only; credentials are excluded
```

旧 `tokens.json` は読み込み時にアカウント別 `credentials.json` へコピーする。復旧用として旧ファイルは自動削除しない。

## Encrypted credential handoff

通常バックアップとは別に、明示操作でのみ認証情報を移せる。

- AES-256-GCM で payload を暗号化する。
- 鍵は passphrase から PBKDF2-SHA256 / 210,000 iterations で導出する。
- salt 16 bytes、IV 12 bytes を毎回ランダム生成する。
- passphrase はディスクへ保存しない。
- primary auth token、session metadata、`protocol.json` 全体を暗号化 payload に含める。
- bundle JSON 自体には raw auth / refresh / channel token を平文で含めない。

内部 API:

- `POST /line/:accountId/credentials/handoff/export`
- `POST /line/:accountId/credentials/handoff/import`
- `POST /line/:accountId/credentials/channel/:channelId/reissue`

## Security notes

- raw token、refresh token、certificate、E2EE key をログへ出さない。
- Windows の primary access token は DPAPI CurrentUser で保護する。
- `protocol.json` は認証情報を含むため、公開・commit・Issue 添付を禁止する。
- 通常の VylineBackup には credentials を含めない。
- 別環境へ移す場合は encrypted credential handoff を使う。
- `/v1/` API Bearer token と LINE auth token を混同しない。

実装箇所:

- `Vyline/packages/protocol/stack/base/service/auth/mod.ts`
- `Vyline/packages/protocol/stack/base/request/mod.ts`
- `Vyline/packages/protocol/src/client/VylineClient.ts`
- `Vyline/backend/src/line/clientManager.ts`
- `Vyline/backend/src/storage/tokenStore.ts`
