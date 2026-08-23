# e2ee-keys — 調査メモ

最終更新: 2026-08-24

確認ポイント:

- keychain 全エントリ保存 (`decodeE2EEKeyV1` パッチ)
- Desktop 抽出 JSON import (`desktop-e2ee-keys.json`)
- サーバ最新 keyId とローカル秘密鍵の一致

Vyline: `ensureE2EE.ts`, `importDesktopE2EE.ts`
