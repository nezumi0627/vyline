# Vyline Threat Model

最終更新: 2026-08-31

## 概要

Vyline の主要な信頼境界、保護対象、攻撃面、既定の防御を整理します。対象は Desktop frontend、Bun/Hono backend、Public API、LINE protocol、LAN/subdevice、plugin/LIFF、backup/archive、通話 WebSocket、CI/release です。

## 保護対象

- LINE auth token、refresh/channel token、PIN、E2EE秘密鍵
- メッセージ本文、MID、プロフィール、グループ情報、メディア
- アカウント別設定、診断ログ、backup/handoff archive
- Public API admin secret と発行済み Bearer token
- release artifact と CI credential

## 信頼境界

```text
Browser / PWA
  -> Hono BFF (/line, /api)
  -> Public API (/v1, Bearer token + account allowlist)
  -> Call WebSocket

Backend
  -> local storage / DPAPI(CurrentUser)
  -> LINE servers / OBS / LIFF endpoints
  -> plugins
  -> backup / archive import-export

GitHub Actions
  -> package build
  -> release artifacts / GHCR
```

### Browser / PWA ↔ Backend

- LAN 公開は既定で無効。
- LAN モードの `/line` と対象 `/api` は subdevice session と account scope を確認する。
- `/debug/*` は LAN から利用不可。ただし loopback 上のローカルプロセスは信頼境界内として扱われる。
- CORS はブラウザの読み取りを制御するが、local HTTP API 自体の認証代替ではない。

### Public API

- Bearer token は `read` / `write` scope に加え `accountIds` allowlist を持つ。
- legacy token に account allowlist が無い場合は空 allowlist として fail closed する。
- token は保存時 SHA-256 hash のみを永続化し、平文は作成時だけ返す。
- token metadata のbackground更新は直列化し、一時ファイルから原子的に置換する。
- token 単位で rate limit を適用する。

### Local storage

- Windows の認証情報は DPAPI CurrentUser で保護する。
- diagnostics/logging は logger 境界でも redaction を行い、secret/PII の raw 出力を避ける。
- backup/handoff/Android/iOS archive は entry 数・展開サイズ・path traversal 等を制限する。

### LINE / external URL

- LINE server は外部 trust boundary。
- CDN / DOWNLOAD_URL は SSRF 対策として許可先・URLを検証する。
- E2EE鍵、auth token、session情報を external URL やログへ渡さない。

### Plugin / LIFF

- plugin と LIFF は backend より低い信頼レベルとして扱う。
- URL、HTTP body、token、message body を raw log に残さない。
- plugin capability は最小権限を前提とし、将来の権限拡張でも deny-by-default を維持する。

### Call WebSocket

- LAN 接続は subdevice auth と account match を要求する。
- `sessionId` と `accountId` の一致を確認する。
- PCM frame は 64 KiB、mic queue は 100 frames、同一通話への WebSocket attach は 8 clients に制限する。
- call session の内部errorはclientへ直接返さず、固定文言のみをstateへ載せる。

### CI / release

- release artifact は `SHA256SUMS.txt` を生成して Windows/Linux 配布物と同時公開する。
- GitHub Actions の third-party action は tag pin が残るため、commit SHA pin は未対応の supply-chain hardening 項目。

## 主要な攻撃シナリオ

| シナリオ | 主な防御 | 残存事項 |
| --- | --- | --- |
| Public API token で別accountを操作 | `accountIds` allowlist、routeごとの照合 | token管理UIでallowlistを明示する |
| token/PIN/E2EE情報のログ漏えい | raw log除去、Pino境界redaction | 新規logger呼び出しの継続監査 |
| error/stack/path disclosure | 5xx generic response、handoff/mediaの失敗も固定文言、内部のみsanitized log | 新規route追加時もclient-facing errorのallowlistを継続監査 |
| malicious media URLによるSSRF | DOWNLOAD_URL/CDN URL検証 | DNS rebinding等はネットワーク層でも防御検討 |
| 巨大PCM / 接続乱立DoS | frame/queue/client上限 | process全体のconnection budgetは未実装 |
| archive bomb / traversal | archive entry/size/path制限 | global request body上限は依然大きい |
| dependency / CI supply-chain | lockfile、OSV/Trivy、release checksum | actions SHA pin、artifact signing/SLSAは未対応 |

## セキュリティ変更時の確認

1. account isolation と fail-closed migration を確認する。
2. error response に `String(err)`、stack、local path、token fragment が含まれないことを確認する。
3. `bun audit`、既存 OSV/Trivy workflow、対象テストを確認する。
4. archive、WebSocket、HTTP body など untrusted size に上限があるか確認する。
5. release artifact の checksum と CI action provenance を確認する。

## 関連ドキュメント

- [監査 Findings](./findings-2026-08-31.md)
- [アーキテクチャ](../architecture.md)
- [セルフホスト](../selfhosting.md)
- [配布](../distribution.md)
