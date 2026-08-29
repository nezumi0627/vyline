# Note / Album API 実装メモ

最終更新: 2026-08-29

LINE のノートとアルバムは Talk RPC ではなく、ChannelToken を使う REST/OBS 系 API が中心。Vyline は既定デバイス `IOSIPAD` の通常ログインセッションから必要な ChannelToken を発行し、Note/Album 専用の2回目ログインを前提にしない。

## 認証の整理

| 用途 | Channel ID | 主な認証 |
| --- | --- | --- |
| Note | `1655599932` | `X-Line-ChannelToken` + ログイン済み MID/アプリ情報 |
| Square Note | `1657618623` | Square Note 用 ChannelToken |
| Album | `1375220249` | `X-Line-ChannelToken` + `X-Line-Mid` / `X-Line-Chat-Id` |

ChannelToken は `channelTokens.get(channelId, { approve: true })` から取得し、401 の場合は `channelTokens.reissue(channelId, true)` で再発行する。通常の LINE access token、LIFF access token、ChannelToken を相互流用しない。

## Note

正本:

- protocol: `Vyline/packages/protocol/stack/base/timeline/mod.ts`
- BFF service: `Vyline/backend/src/service/noteService.ts`
- HTTP routes: `Vyline/backend/src/api/line.ts`

### 実装済み操作

- 一覧取得
- 単体取得
- 作成
- 更新
- 削除
- チャットへの共有
- いいね / いいね解除 / 状態取得 / 一覧取得
- コメント作成
- 投稿メディア upload
- コメント画像 upload

Note REST は主に `https://legy-jp.line-apps.com/ext/note/nt/api/v57/...` を使う。投稿 CRUD は `post/create.json`, `post/update.json`, `post/delete.json`, `post/get.json`, `post/list.json`, `post/share.json` 系。

### 投稿メディア

現在の iOS/iPad 実測経路では投稿メディアを `obs-jp.line-apps.com/r/privnote/post/<oid>` に upload する。`x-obs-params` は JSON を base64 化した値を使い、レスポンスの `x-obs-oid` / `x-obs-hash` を Note payload の media entry に反映する。

コメント画像は投稿メディアと OBS namespace が異なる。`myhome/cmt` 系を使い、Note コメントの `contentsList` には `categoryId: "media"` と `serviceName: "myhome"`, `obsNamespace: "cmt"` を設定する。コメント画像と投稿画像の object id を使い回さない。

### 401 の扱い

以前の 401 は upload 完了前の HAR や未完了 ChannelToken フローを根拠に固定実装しない。現在は ChannelToken manager を正本にして、token 取得完了後に OBS/REST を実行し、401 の場合だけ明示的に再発行して再試行する。

## Album

正本:

- protocol: `Vyline/packages/protocol/stack/base/album/mod.ts`
- BFF service: `Vyline/backend/src/service/albumService.ts`
- HTTP routes: `Vyline/backend/src/api/line.ts`

### 実装済み操作

- アルバム一覧 / preview
- 作成
- タイトル更新
- 削除
- チャット共有
- 写真一覧
- 写真追加
- 写真削除
- メディア upload
- メディア download

Album REST は `https://legy-jp.line-apps.com/ext/album/api/v6/...` を使う。チャット対象は `X-Line-Chat-Id`、ChannelToken は Album channel `1375220249` を利用する。

### Album OBS upload

画像 upload は `https://obs-jp.line-apps.com/r/album/a/<oid>`。主要 header:

- `X-Line-ChannelToken`
- `X-Line-Mid`（対象 chat id）
- `X-Line-Album`
- `Upload-Draft-Interop-Version: 6`
- `Upload-Complete: ?1`
- `content-type: application/octet-stream`
- `x-obs-params`

upload 後は `x-obs-oid` を優先して写真作成 payload の `obsResourceId.oid` に使う。`obsResourceId` の既定は `sid: "a"`, `svc: "album"`。

### download

`/r/album/a/<oid>/m1200` 系を使い、upload と同じ Album ChannelToken / chat / album context を付ける。UI では API response を直接保存せず、既存 media storage / cache 方針に合わせる。

## BFF の方針

任意 URL/path を受け取る proxy は公開しない。`Vyline/backend/src/api/line.ts` には操作ごとの固定 route を置き、入力検証後に `noteService.ts` / `albumService.ts` へ委譲する。

主な route family:

- `/:accountId/notes...`
- `/:accountId/albums...`

認証情報・ChannelToken・OBS header は frontend へ露出させない。

## 検証時のチェックリスト

1. 通常の `IOSIPAD` ログイン1回で session が利用可能か。
2. ChannelToken が対象 channel ID で発行・保存されているか。
3. REST の chat/home context が実対象と一致するか。
4. upload 完了レスポンスの object id/hash を次の create/update に使っているか。
5. 401 時は同じ stale token の単純再送ではなく再発行しているか。
6. 作成テストでは最後に削除まで行い、テストデータを残さない。

## 関連ドキュメント

- [token-lifecycle.md](./token-lifecycle.md)
- [dual-login-desktop.md](./dual-login-desktop.md)
- [../protocol/dictionary.md](../protocol/dictionary.md)
