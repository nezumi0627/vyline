# e2ee-decrypt — 調査メモ

最終更新: 2026-08-24

確認ポイント:

- `decryptE2EEMessage` / グループ `tryRegisterE2EEGroupKey`
- ログイン前履歴の BAD_DECRYPT → Desktop 自己鍵不足の可能性

Vyline: `ensureE2EE.ts`, `importDesktopE2EE.ts`, `e2ee/letterSealing.ts`, backend `lineService.ts`

## 実装方針 (2026-07 更新)

`lineService.ts` の `decryptE2EEMessageSafe()` は、まず
`@vyline/protocol` の `decryptLetterSealingMessage()` (Vyline 自前実装、
グループ鍵を by-id マルチキャッシュから直接引く) で復号を試み、
失敗したら linejs 標準の `client.base.e2ee.decryptE2EEMessage()` に
フォールバックする (`decryptViaLetterSealingOrLinejs` ヘルパー)。
既存の BAD_DECRYPT 時キャッシュクリア＋再試行ロジックはそのまま維持しているため、
自前実装が失敗しても回帰しない。
