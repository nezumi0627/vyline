# Vyline メッセージ編集・ミュート送信 構造解説

最終更新: 2026-08-24

本ドキュメントでは、Vyline に新しく追加されたメッセージ編集機能 (`editMessage`, `getMessageEditNotice`) およびミュート送信機能 (`mute` / `NOTIFICATION_DISABLED`) の内部構造とデータフローを解説します。

---

## 1. ミュート（サイレント）送信機能

LINE プロトコルにおける「ミュート送信」は、プッシュ通知を発生させずに相手にメッセージを届ける機能です。

### 仕組み
- メッセージ送信時に、`contentMetadata` (キー・値のメタデータテーブル) に対して以下のペアを付与します。
  - キー: `NOTIFICATION_DISABLED`
  - 値: `"true"`
- 送信API (`lineRouter.post("/:accountId/sendMessage")`) のリクエストボディに `mute: true` を指定することで、この値が内部の `sendMessage` に渡されます。

### データフロー
```
[Frontend / Client] ──(mute: true)──> [BFF (api/line.ts)] ──> [service/lineService.ts]
                                                                     │
                                                           NOTIFICATION_DISABLED="true"
                                                                     │
                                                                     v
                                                          [client.base.talk.sendMessage]
```

- Letter Sealing (E2EE) の場合でも、暗号化エンベロープとは別に平文の `contentMetadata` が LINE サーバーに送信されるため、このキーは平文で付与されて正常に動作します。
- 送信エラーによる Plain (非E2EE) フォールバック時にも、`baseContentMetadata` が引き継がれてミュート属性が保持される設計になっています。

---

## 2. メッセージ編集機能 (`editMessage` RPC)

LINE Desktop クライアントでサポートされている「メッセージ送信後の内容編集」を Vyline から実行する機能です。

### 仕組み
- LINE の `TalkService` に用意されている `editMessage` RPC を呼び出します。
- `editMessage` のリクエストパラメータ:
  - `seq`: リクエストシーケンス番号 (自動生成)
  - `from`: 送信者の MID
  - `to`: 送信先の MID (グループまたはユーザー)
  - `messageId`: 編集対象のメッセージ ID
  - `text`: 編集後の新しいテキスト
- サーバーからのレスポンスには、編集後のメッセージオブジェクト (`LINETypes.Message`) が含まれます。

### データフローとDB同期
1. フロントエンドまたはスクリプトが `/line/:accountId/edit` に対して `{ chatMid, messageId, text }` を送信。
2. BFF `lineService.editMessage` が `client.base.talk.editMessage` RPC を呼ぶ。
3. 取得した `LINETypes.Message` (生 Thrift 構造) を `mapDecodedRawToMessage` にて Vyline 標準の `Message` 型にマッピング。
4. マッピング済みのメッセージをローカルの SQLite DB (`upsertMessages`) に即時保存。これにより、チャット画面をリロードした際にも編集後の内容が保持されます。
5. 成功ログの出力と API レスポンスの返却。

---

## 3. 編集通知取得機能 (`getMessageEditNotice` RPC)

チャット内で誰かがメッセージを編集した際の編集通知情報（件数と最終更新日時）を監視・取得する機能です。

### 仕組み
- `TalkService` の `getMessageEditNotice` RPC を呼び出します。
  - 引数: `chatMid` (対象のチャットMID)
  - 戻り値: `{ count: number, updatedTime: number }`
    - `count`: 編集されたメッセージの件数
    - `updatedTime`: 最終編集時の Unix タイムスタンプ (ミリ秒)

### BFF での整形
- 生の Unix タイムスタンプ (`number`) は、BFF 層で扱いやすいように ISO 8601 文字列形式 (`updatedTime: string`) に変換されて API から返却されます。
  ```typescript
  const updatedTime = typeof res.updatedTime === "number" 
    ? new Date(res.updatedTime).toISOString() 
    : String(res.updatedTime);
  ```

---

## 4. 編集後メッセージ取得スクリプト (`scripts/getEditedMessageJson.ts`)

開発・デバッグ用途として、コマンドラインからメッセージ編集の実行と、編集通知の取得を行い JSON で結果を出力するスクリプトが用意されています。

### 使用方法
```bash
# メッセージの編集と通知情報の取得を同時に行う
bun run vyline:get-edited-json -a main -c <chatMid> -m <messageId> -t "編集後のテキスト"

# 編集通知情報 (Notice) の取得のみ行う
bun run vyline:get-edited-json -a main -c <chatMid>
```
