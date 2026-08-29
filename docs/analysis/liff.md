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

namespace export される `liff` から利用できる。

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

Vyline の公開 API では分かりやすい `sender: { name, iconUrl, linkUrl }` を受け付ける。実際の LIFF share 送信時には、この値を LINE 側で表示確認できた `sentBy: { label, iconUrl, linkUrl }` へ変換する。

つまり呼び出し側の正本は `sender.name` / `sender.iconUrl` / `sender.linkUrl`、wire payload の正本は `sentBy.label` / `sentBy.iconUrl` / `sentBy.linkUrl` とする。UI 側が `sentBy` の命名差を意識する必要はない。

通常の送信では、text / flex / image などの message JSON を `sendLiff()` に渡し、表示名・アイコン・URLだけ `sender` にまとめて指定する。

```ts
await client.liff.sendLiff(chatMid, {
  type: "text",
  text: "Hello!",
  sender: {
    name: "Cony",
    iconUrl: "https://example.com/icon.png",
    linkUrl: "https://example.com/profile",
  },
});
```

生成される payload:

```json
{
  "type": "text",
  "text": "Hello!",
  "sender": {
    "name": "Cony",
    "iconUrl": "https://example.com/icon.png"
  },
  "sentBy": {
    "label": "Cony",
    "iconUrl": "https://example.com/icon.png",
    "linkUrl": "https://example.com/profile"
  }
}
```

`sendLiff()` は送信直前に `sender` を取り除き、同じ値を `sentBy` へ正規化する。実アカウントの許可済みテストグループでも、この形で LIFF share が成功し送信者表示を確認できた。`liff.text()` / `withSender()` / `withAttribution()` は互換・低レベル用途として残す。

`sentBy` は公開 LIFF SDK の一般的な message 型として文書化されている前提にはせず、Vyline では実通信・実機表示で確認した LIFF share 用 wire metadata として扱う。

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
