# LIFF 実装メモ

最終更新: 2026-08-29

Vyline の LIFF は `@vyline/protocol` の `stack/base/service/liff/mod.ts` と `stack/client/features/liff.ts` を正本とする。UI 固有の表現はここへ持ち込まず、LIFF view/token 取得と share payload の組み立てを protocol 層で扱う。

## 主要フロー

1. `issueLiffView({ liffId, chatMid })` を `/LIFF1` に送る。
2. `LiffViewResponse.accessToken` を利用する。`getLiffToken()` は `CONSENT_REQUIRED` の場合だけ同意処理を試し、成功後に再発行する。
3. `sendLiff()` / `client.liff.shareMessage(s)` が `https://api.line.me/message/v3/share` に `Authorization: Bearer <LIFF access token>` と `{ messages }` を送る。
4. `forceIssue` を指定すると宛先単位の LIFF token cache を使わず再発行する。

LIFF access token は通常の LINE access token や Note/Album の ChannelToken と別物。保存・ログ出力・引き継ぎ時に同じ値として扱わない。

## 高レベル message helper

`stack/client/features/liff.ts` には `text` / `sticker` / `image` / `flex` がある。追加の任意フィールドが必要な場合は UI に直接 JSON 組み立てを置かず、protocol helper で表現する。

### `sender`

今回追加する helper は namespace export される `liff` から利用する。

```ts
import { liff } from "@vyline/protocol/stack";

const message = liff.withSender(liff.text("Hello!"), {
  name: "Cony",
  iconUrl: "https://example.com/icon.png",
});

await client.liff.shareMessage(chatMid, message);
```

生成される payload:

```json
{
  "type": "text",
  "text": "Hello!",
  "sender": {
    "name": "Cony",
    "iconUrl": "https://example.com/icon.png"
  }
}
```

`withSender()` は元 message を変更せず新しい object を返す。現時点では UI には接続しない。

### `sender` と `sentBy` の違い

既存 `text(body, sentBy)` の `sentBy` は `label` / `iconUrl` / `linkUrl` を持つ既存の footer metadata で、今回の `sender: { name, iconUrl }` とは別フィールド。互換性維持のため統合・置換しない。

## LIFF feature 実装

アプリ本体の `Vyline/backend/src/service/liffFeatures.ts` では、用途ごとの LIFF ID を使い schedule / ladder / poll などの HTTP API を呼ぶ。アプリごとに token header の形が異なるため、共通化するときも `X-Liff-Token` と `x-liff-access-token` / `x-liff-id-token` を混同しない。

## エラー確認

- `CONSENT_REQUIRED`: `getLiffToken()` の同意フローを確認する。
- 401/403: LIFF ID・chat context・token header の組み合わせを確認し、LINE access token や ChannelToken を代入しない。
- share 失敗: `forceIssue: true` で LIFF token を再取得して切り分ける。
- payload rejection: UI から送られた object ではなく protocol helper の単体テストで shape を固定する。

## 関連ソース

- `Vyline/packages/protocol/stack/base/service/liff/mod.ts`
- `Vyline/packages/protocol/stack/client/features/liff.ts`
- `Vyline/packages/protocol/stack/client/features/liff.test.ts`
- `Vyline/backend/src/service/liffFeatures.ts`
- `Vyline/backend/src/api/line.ts`
