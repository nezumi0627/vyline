# sync-events — リアルタイムイベント取得の解析メモ

最終更新: 2026-08-24

LINE Desktop / Mobile とのリアルタイム同期には2つの経路が存在する。

## 1. Talk ポーリング (`pollEvents`)

Vyline の主要な受信パス。

```
GET /line/:accountId/events/poll?cursor=N
```

- `backend/src/line/talkEventBuffer.ts` で **インメモリバッファ** にイベントを蓄積
- `pollIncoming` (store.ts) がこのバッファを drain する
- ポーリング間隔: 背景 2s / 非アクティブ 8s / 非表示 60s（`useVylineSync.ts`）
- push がない環境でもバックアップ

### イベント種別

| kind | 説明 | ハンドラ |
|------|------|----------|
| `message` | 新着メッセージ | `mergeIncomingMessages` |
| `revoke` | メッセージ取り消し | `applyRevoked` |
| `read` | 既読通知 | `refreshReadReceipts` (force) |
| `reaction` | リアクション追加/削除 | `pollMessagesDelta` (delta fast-path) |

### push 遅延

- セッション復元直後、push listener は **15s** 遅延 (`clientManager.ts` の `VYLINE_TALK_LISTEN_DELAY_MS`)
- 新着メッセージの表示遅延の主因
- 短縮候補: 8s 程度に引き下げ可能

## 2. Legy Push (`ListenAndRead`)

HTTP/2 の `/PUSH/1/subs` エンドポイントでサーバーから即座にイベントを受信。

- `clientManager.ts` の `attachTalkPushBridge` で Talk push を接続
- メッセージ / Operation (DESTROY, READ, REACTION) を即座にバッファへ
- push が機能しない環境ではポーリングで補完

## 3. Operation タイプ（Talk）

`pushTalkEvent` / `handleTalkOperation` で処理される主要な Operation type:

| type | 数値 | 説明 |
|------|------|------|
| `RECEIVE_MESSAGE` | 26 | 新着メッセージ (push) |
| `SEND_MESSAGE_RECEIPT` | 27 | 送信 receipt |
| `RECEIVE_MESSAGE_RECEIPT` | 28 | 受信 receipt |
| `NOTIFIED_READ_MESSAGE` | 55 | 相手既読通知 |
| `NOTIFIED_SEND_REACTION` | 140 | リアクション追加 |
| `NOTIFIED_GCS_REACTION` | 154 | グループ/チャットリアクション |
| `DESTROY_MESSAGE` | (40 系?) | 取り消し |

> 注: `GET /events/poll` の `events` 配列では、push された message を `kind: "message"` としてフロントエンドに渡す。Operation (revoke/read/reaction) は `pushTalkEvent` → `TalkPollEventPayload` として、`kind` で判別してバッファする。

重要: `25` は `SEND_MESSAGE` であり、新着メッセージや既読通知ではない。受信メッセージは `26`、既読通知は `55` / `28` / `91` 系として分類する。`25` を既読・受信分岐へ含めると、送信操作を誤処理して既読通知を取りこぼす。

既読者取得では `getMessageReadRange` の `success` wrapper と、`ranges` 内の単一rangeオブジェクトを正規化してからMID別ウォーターマークへ変換する。

## 4. Desktop 差分

- `bun run vyline:delta` (`reportDesktopDelta.ts`) で Desktop LINE の更新を検出
- 出力: `docs/reports/desktop-delta-YYYYMMDD.md`
- 関連: [docs/tools/vyline-search.md](../tools/vyline-search.md)

## 5. 参考箇所

- **バッファ**: `backend/src/line/talkEventBuffer.ts`
- **poll 受信**: `apps/desktop/src/lib/store.ts` `pollIncoming` (line ~1882)
- **push bridge**: `backend/src/service/lineService.ts` `attachTalkPushBridge` / `handleTalkOperation`
- **delta fast-path**: `fetchMessagesInner` `deltaAfterId` オプション（getMessageBoxes スキップ）
