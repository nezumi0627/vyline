# 取消・既読者・複数アカウント・MID検索の安定化

最終更新: 2026-08-24

## 対象

- 送信取消メッセージの保持・表示
- グループ内の既読者（既読レンジの取得、保存、再読込）
- 複数アカウントの状態分離
- Beta の MID ユーザー検索

## 変更点

Operation type の分類では `25 (SEND_MESSAGE)` を受信・既読として扱わず、`26 (RECEIVE_MESSAGE)` と `55 / 28 / 91` 系をそれぞれ正しく分類する。誤分類は既読通知の取りこぼしとイベント二重処理の原因になる。

### 送信取消

`chatStore` は取消前の内容を `revokedSnapshot` と履歴へ保存する。Desktop は取消を楽観表示するが、API が失敗した場合は元のメッセージへ戻す。これにより、通信失敗を取消成功として永続化しない。

取消イベントは `lineService.processSingleOperation` から `markMessageRevoked(accountId, chatMid, messageId)` へ渡り、アカウント別 chatdb に保存される。再取得時も保存済みの取消状態を通常メッセージで上書きしない。

### グループ既読者

`fetchReadRanges` で取得したレンジを `attachGroupReadReceipts` が `readBy` / `readCount` に変換する。複数回のポーリングで得た読者は集合として統合し、既に確認済みの読者を失わない。

Thrift の `getMessageReadRange` は `{ success: TMessageReadRange[] }` のwrapperを返す場合があるため、`success` を必ずunwrapする。`TMessageReadRange.ranges` の各MID値は単一の `{ startMessageId, endMessageId }` オブジェクトの場合もあり、配列だけを想定してはいけない。

本番の取得経路は raw request ではなく、debug 経路と同じ型付き `talk.getMessageReadRange({ chatIds })` を使用する。raw request に `syncReason` を手動指定すると、実装差分によって成功レスポンスを正しく復号できず、グループ既読者が空になることがある。

既読フラグは、取得できた明示的な `seen` / `readCount` / `readBy` だけから導出する。グループの既読情報がレスポンスに無いことを「既読」と解釈してはいけない。chatdb 保存時は既存の `seen` と `readBy` を保持し、後続レスポンスの欠落で既読状態を未読へ戻さない。

ローカルの `markChatRead` は受信メッセージだけを既読化する。自分の送信メッセージの `read` は相手側の既読状態なので、チャットを開いただけで変更しない。既読通知APIへ渡す基準IDも、自分の送信ではなく受信側の最新メッセージを使う。

メッセージ取得中のバックグラウンド既読更新も、更新後のメッセージをアカウント別 chatdb へ再保存する。既読者プロフィールは `fetchContactProfile` で事前解決し、Desktop の読者一覧で名前を表示できる。

API の既読取得 in-flight キーには `accountId`、チャットMID、要求したメッセージID集合を含める。異なるアカウントや異なるID集合の応答を共有しない。

### 複数アカウント

Desktop の既読ウォーターマーク、既読取得、delta、履歴補完の一時キャッシュは `accountId:chatMid` をキーにする。アカウント切替時には表示中のチャット・メッセージ・既読・お知らせ・ブロック一覧をクリアし、切替先の hydrate を正本にする。

バックエンドの永続データは `backend/data/accounts/<safeAccountId>/` 配下を正本とする。鍵・セッション・実データをログやドキュメントへ出力しない。

### MID検索 Beta

設定 > ベータ機能で個別同意後に有効化する。`u` + 32桁の16進数のMIDだけを受け付け、既存のアカウント別 `GET /line/:accountId/contact/:targetMid` とプロフィールキャッシュを利用する。検索は読み取り専用で、送信・友だち追加・ブロック操作は行わない。

## 検証

```powershell
bun run typecheck
```

実アカウントへの送信テストは行わない。送信取消を実通信で確認する場合も、AGENTS.md に定めるテスト対象だけを使用する。
