# Desktop / プロトコル分析メモ

最終更新: 2026-08-24

LINE Desktop 更新や RPC 差分を調べた結果を置く場所。  
agents は `bun run vyline:delta` のレポートが指す feature ごとに、ここに追記する。

機能 → ソース対応の正本: `Vyline/packages/protocol/src/modules.map.ts`

| Feature                  | メモファイル                                     | 既存の詳細                                           |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| login-qr                 | [login-qr.md](./login-qr.md)                     | [login-flow.md](../login-flow.md)                    |
| login-email              | [login-email.md](./login-email.md)               | [login-flow.md](../login-flow.md)                    |
| headers-transport        | [headers-transport.md](./headers-transport.md)   | [login-flow.md](../login-flow.md)                    |
| dual-login / device slot | [dual-login-desktop.md](./dual-login-desktop.md) | `VYLINE_DEVICE`（既定 IOSIPAD）                      |
| e2ee-keys                | [e2ee-keys.md](./e2ee-keys.md)                   | [login-flow.md](../login-flow.md)                    |
| e2ee-send                | [e2ee-send.md](./e2ee-send.md)                   |                                                      |
| e2ee-decrypt             | [e2ee-decrypt.md](./e2ee-decrypt.md)             |                                                      |
| talk-send                | [talk-send.md](./talk-send.md)                   |                                                      |
| multi-image-send         | [multi-image-send-handoff.md](./multi-image-send-handoff.md) | 複数画像送信の未解決事項と handoff |
| sync-events              | [sync-events.md](./sync-events.md)               |                                                      |
| stickers                 | [stickers.md](./stickers.md)                     |                                                      |
| line-emoji               | [line-emoji.md](./line-emoji.md)                 |                                                      |
| history-restore          | [history-restore.md](./history-restore.md)       | [e2ee-decrypt-journey.md](./e2ee-decrypt-journey.md) |
| edb-decrypt              | [edb-decrypt.md](./edb-decrypt.md)               | Desktop .edb 全履歴 dump（メモリ捕捉方式）           |
| sbc-key-restore          | [sbc-key-restore.md](./sbc-key-restore.md)       | SBC クラウドバックアップ鍵取り出し（/EKBS4・/LKBS4） |
| ios-backup-history       | [ios-backup-history-extraction.md](./ios-backup-history-extraction.md) | iOS バックアップ履歴取り出し作業の全経緯・手順       |
| calls                    | [calls.md](./calls.md)                           |                                                      |

**ドキュメント索引**

- 新規参入: [onboarding.md](../onboarding.md)
- 貢献フロー: [CONTRIBUTING.md](../CONTRIBUTING.md)
- RPC 辞書: [protocol/dictionary.md](../protocol/dictionary.md)

Desktop 差分ツール: [docs/tools/desktop-delta.md](../tools/desktop-delta.md)
