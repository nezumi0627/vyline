# 履歴復元（ログイン前メッセージ）

最終更新: 2026-08-24

## Desktop 鍵でログイン前履歴を復号する

Vyline のトークン／セッションは「今のログイン」以降の API アクセスに使うが、**サーバー上の過去メッセージ（E2EE chunks）を読むには、メッセージ作成時点の自己鍵が必要**になる。

LINE Desktop は過去の自己鍵を keychain に保持している。稼働中の `LINE.exe` から抽出した鍵 dump（`desktop-e2ee-keys.json`）を `ensureValidE2EEIdentity` で取り込むと、**Vyline にログインする前に送受信されていた履歴も復号できる**（鍵が揃っている範囲）。

詳細な経路・失敗モード・ファイル対応は **[e2ee-decrypt-journey.md](./e2ee-decrypt-journey.md)** を参照。

エクスポート API（`GET /line/:accountId/export/:chatMid`）も同じ `fetchMessages` 経路のため、Desktop 鍵 import 済みなら復号済み本文が含まれる。
