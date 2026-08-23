# e2ee-send — 調査メモ

最終更新: 2026-08-24

確認ポイント:

- `encryptE2EEMessage` / `negotiateE2EEPublicKey`
- `E2EE_UPDATE_SENDER_KEY` → sender 鍵ローテート後再送

Vyline: `ensureE2EE.ts`, `e2ee/letterSealing.ts`, backend `lineService.ts`

## 実装方針 (2026-07 更新)

`lineService.sendMessage()` は linejs 標準の
「`e2ee: true` を渡して内部で `encryptE2EEMessage` → 自分自身を再帰呼び出し」
という実装には依存しない。代わりに `@vyline/protocol` の
`encryptLetterSealingMessage()` で chunks を自前に組み立て、
`client.base.talk.sendMessage({ chunks, contentMetadata, relatedMessageId })`
を 1 回で呼ぶ明示的な実装に置き換えた。

- 暗号アルゴリズム自体 (AES-256-GCM, salt=16B, nonce=12B, AAD構成) は
  linejs / 公式クライアントと bit-for-bit 互換 — 相互運用性のため変更しない
- グループ宛の共有鍵解決は linejs の単一キャッシュではなく Vyline の
  by-id マルチキャッシュ (`login/groupE2EE.ts`) を直接使う
- `relatedMessageId` (返信) を含む thrift フィールドをそのまま渡せるようになった
  (以前は API 層で受け付けておらず、フロントは返信をテキスト先頭への引用埋め込みで代替していた)
- ネイティブ調査 (`source/desktop/recovered/src/native/sendMessage/README.md`)
  で確認した `encryptE2EEMessageInternal` の構造 (specVersion 0/1 チェック、
  contentType 分岐、`e2eeMark` 定数) と一致することを確認済み
