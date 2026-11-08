# 履歴復元（ログイン前メッセージ）

最終更新: 2026-08-24

## Desktop 鍵でログイン前履歴を復号する

現在の復元実装では、Desktop DB内にログイン本人を特定する安定した欄を確認できていません。`_contact._mid`にVylineの本人MIDがないことだけで別アカウントと判定しないようにし、復元画面で「LINE DesktopとVylineが同じアカウント」と利用者に明示確認してから取り込みます。アカウントを間違えると異なるアカウントの履歴が混在するため、確認は毎回必要です。

Vyline のトークン／セッションは「今のログイン」以降の API アクセスに使うが、**サーバー上の過去メッセージ（E2EE chunks）を読むには、メッセージ作成時点の自己鍵が必要**になる。

LINE Desktop は過去の自己鍵を keychain に保持している。稼働中の `LINE.exe` から抽出した鍵 dump（`desktop-e2ee-keys.json`）を `ensureValidE2EEIdentity` で取り込むと、**Vyline にログインする前に送受信されていた履歴も復号できる**（鍵が揃っている範囲）。

詳細な経路・失敗モード・ファイル対応は **[e2ee-decrypt-journey.md](./e2ee-decrypt-journey.md)** を参照。

エクスポート API（`GET /line/:accountId/export/:chatMid`）も同じ `fetchMessages` 経路のため、Desktop 鍵 import 済みなら復号済み本文が含まれる。
