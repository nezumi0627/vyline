# Desktop / プロトコル分析メモ

LINE Desktop 更新や RPC 差分を調べた結果を置く場所。  
agents は `bun run vyline:delta` のレポートが指す feature ごとに、ここに追記する。

機能 → ソース対応の正本: `Vyline/packages/protocol/src/modules.map.ts`

| Feature                  | メモファイル                                     | 既存の詳細                                           |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| login-qr                 | [login-qr.md](./login-qr.md)                     | [login-flow.md](../login-flow.md)                    |
| login-email              | [login-email.md](./login-email.md)               | [login-flow.md](../login-flow.md)                    |
| headers-transport        | [headers-transport.md](./headers-transport.md)   | [login-flow.md](../login-flow.md)                    |
| dual-login / device slot | [dual-login-desktop.md](./dual-login-desktop.md) | `VYLINE_DEVICE`（既定 ANDROIDSECONDARY）             |
| e2ee-keys                | [e2ee-keys.md](./e2ee-keys.md)                   | [login-flow.md](../login-flow.md)                    |
| e2ee-send                | [e2ee-send.md](./e2ee-send.md)                   |                                                      |
| e2ee-decrypt             | [e2ee-decrypt.md](./e2ee-decrypt.md)             |                                                      |
| talk-send                | [talk-send.md](./talk-send.md)                   |                                                      |
| multi-image-send         | [multi-image-send-handoff.md](./multi-image-send-handoff.md) | 複数画像送信の未解決事項と handoff |
| combination-sticker     | [combination-sticker-handoff.md](./combination-sticker-handoff.md) | 複数スタンプの組み合わせ送信・表示の未解決事項と handoff |
| sync-events              | [sync-events.md](./sync-events.md)               |                                                      |
| stickers                 | [stickers.md](./stickers.md)                     |                                                      |
| line-emoji               | [line-emoji.md](./line-emoji.md)                 |                                                      |
| history-restore          | [history-restore.md](./history-restore.md)       | [e2ee-decrypt-journey.md](./e2ee-decrypt-journey.md) |
| calls                    | [calls.md](./calls.md)                           |                                                      |
| profile-self             | [avatar-profile-api.md](./avatar-profile-api.md) | `protocol/profileOps.ts`                             |
| profile-contacts         | [avatar-profile-api.md](./avatar-profile-api.md) | `domain/contacts.ts`                                 |
| chat-admin               | [avatar-profile-api.md](./avatar-profile-api.md) | `domain/chat.ts`                                     |

**ドキュメント索引**

- 新規参入: [onboarding.md](../onboarding.md)
- 貢献フロー: [CONTRIBUTING.md](../CONTRIBUTING.md)
- RPC 辞書: [protocol/dictionary.md](../protocol/dictionary.md)

Desktop 差分ツール: [docs/tools/desktop-delta.md](../tools/desktop-delta.md)
