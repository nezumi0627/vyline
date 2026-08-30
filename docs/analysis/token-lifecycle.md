# LINE token lifecycle in Vyline

最終更新: 2026-08-29

Vyline が扱う認証情報を「何に使うか」「どこへ保存するか」「どう更新するか」で分離したメモ。通常の VylineBackup には認証情報を含めない。

## 種類

| 種類 | 用途 / スコープ | 保存 | 更新・失効時 |
|---|---|---|---|
| Primary auth/access token | Talk / Square など LINE の主要 RPC のログイン資格情報 | `data/accounts/<accountId>/credentials.json`。Windows は DPAPI (CurrentUser) で保護 | refresh token による更新、または再ログイン。更新後は token watcher が再保存 |
| Refresh token | Primary token の更新 | アカウント専用 `protocol.json` の `refreshToken` | Talk 側の認証失効時に使用。別 PC への移動は暗号化 handoff のみ |
| Channel `channelAccessToken` | Channel ID ごとの REST gateway。`X-Line-ChannelToken` に設定 | `protocol.json` の `channelToken:<channelId>` | 401 時に invalidate → 1回だけ再発行 → 再試行。手動再発行 API も提供 |
| Channel response `token` | 一部 Channel RPC が返す互換フィールド | `channelAccessToken` が無い場合だけ互換 fallback | Gateway 用には優先しない。これを優先すると 401 になり得る |
| Request token | `issueRequestTokenWithAuthScheme` で発行する短寿命トークン | 永続保存しない | Web / auto-login フロー専用。`getReturnUrlWithRequestTokenForAutoLogin` と組み合わせる |
| E2EE / device secrets | E2EE 鍵・証明書・端末に紐づく protocol credential | `protocol.json` | Channel token とは別物。移行時のみ暗号化 handoff に含める |

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
      protocol.json      # refresh/channel/E2EE/device protocol KV
  tokens.json            # legacy: read/migration only
  backups/               # chats/messages/media only; credentials are excluded
```

旧 `tokens.json` は読み込み時にアカウント別 `credentials.json` へコピーする。復旧用として旧ファイルは自動削除しない。既存エントリが旧 `storage-<accountId>.json` を参照している場合も、そのパスを優先して互換性を維持する。

## Encrypted credential handoff

通常バックアップとは別に、明示操作でのみ認証情報を移せる。

- AES-256-GCM で payload を暗号化する。
- 鍵は入力された passphrase から PBKDF2-SHA256 / 210,000 iterations で導出する。
- salt 16 bytes、IV 12 bytes を毎回ランダム生成する。
- passphrase はディスクへ保存しない。
- primary auth token、session metadata、`protocol.json` 全体を暗号化 payload に含める。
- import 先の `accountId` を指定できるため、別環境のアカウント領域へ安全に復元できる。
- bundle JSON 自体には raw auth / refresh / channel token を平文で含めない。

内部 API:

- `POST /line/:accountId/credentials/handoff/export`
- `POST /line/:accountId/credentials/handoff/import`
- `POST /line/:accountId/credentials/channel/:channelId/reissue`

`credentials.json` や `protocol.json` をそのまま ZIP に入れる方式は採用しない。
