# コンビネーションスタンプ送信 引き継ぎ書

最終更新: 2026-08-21

## 目的

複数スタンプをドラッグして配置し、LINE のコンビネーションスタンプとして作成・送信・表示する機能を完成させる。

現状は UI 上で複数スタンプを配置できるところまで進んでいるが、**送信後に複数スタンプの組み合わせとして安定して表示・再取得できていない**。送信直後は画像が表示されても、再同期後に `🧩` へ置換される事象が残っている。

## 最重要の未解決症状

- コンビネーション作成領域に複数スタンプを配置できる
- 送信操作も実装済み
- 送信直後に一瞬画像が見えることがある
- その後、履歴更新・再同期・再描画で `🧩` に置換される
- 「複数スタンプを1つのコンビネーションスタンプとして送信できた」ことは未確認

## 現在の実装経路

### UI

対象: `Vyline/apps/desktop/src/components/sticker-emoji-panel.tsx`

- スタンプ長押しでコンビネーション領域へ追加
- ドラッグで配置を変更
- 配置情報 `{ packageId, stickerId, x, y, size }` を送信関数へ渡す
- 通常のメディアドロップとは MIME type `application/x-vyline-sticker` で分離
- 対応不可パッケージはドラッグ不可にする実装があるため、判定が全経路で効いているか再確認する

### Desktop store

対象: `Vyline/apps/desktop/src/lib/store.ts`

主な処理:

1. `sendCombinationSticker(chatId, items)` が呼ばれる
2. 各スタンプからローカル表示用の配置を作る
3. `api.line.sendCombinationSticker(...)` を呼ぶ
4. 応答メッセージを `mapMessage(...)` で UI 型へ変換
5. `renderCombinationStickerPreview(...)` でローカル合成 PNG を作成
6. `CSSTKID` とメッセージIDにプレビューを保存
7. 送信後に `refreshMessages(..., { force: true })` を予約

注意: retry 経路にも `combinationSticker` が追加されているが、retry 後の確認済みメッセージにローカルプレビューを再登録する処理は不十分。

### Backend

対象: `Vyline/backend/src/service/lineService.ts`

現在の送信は概ね以下の流れ:

```text
createCombinationStickerCore(accountId, items)
  -> Shop.createCombinationSticker(...)
  -> created.id

sendStickerMessage(...)
  -> contentMetadata: { CSSTKID: created.id }
```

対象 API: `Vyline/backend/src/api/line.ts`

- `POST /line/:accountId/combination-stickers`
- `POST /line/:accountId/send-combination-sticker`
- `POST /line/:accountId/combination-stickers/can-create`
- `POST /line/:accountId/combination-stickers/available`

## 直近で入った表示修正

対象: `Vyline/apps/desktop/src/lib/mappers.ts`

コンビネーションの識別子は `contentMetadata.CSSTKID` を使う。

プレビュー取得は次の優先順:

```text
localStorage の CSSTKID キーに保存された data URL
  -> lineStickerUrl(CSSTKID)
  -> 通常スタンプのURL
  -> 最終的な一般スタンプ fallback
```

重要な修正済み点:

- 以前は保存キーがメッセージID、取得キーが `CSSTKID` で不一致だった
- 現在は送信後に `CSSTKID` をキーとして保存するよう変更済み
- キャッシュ未取得時に即 `🧩` を返さず、`lineStickerUrl(CSSTKID)` を試すよう変更済み

それでも `🧩` が出るため、以下のどれかが残っている可能性が高い。

1. 実際の履歴レスポンスに `CSSTKID` が存在しない、または別名・別階層に入っている
2. `sendCombinationSticker` のレスポンスに `message` がなく、プレビュー保存処理が実行されていない
3. 再同期時に `CSSTKID` を含む raw message が別の mapper 経路で失われている
4. `createCombinationSticker` が作成したIDと、送信メッセージに付与されるIDが異なる
5. `lineStickerUrl(CSSTKID)` がコンビネーション用画像URLとして有効ではない
6. `mapMessage` 以外で `sticker: "🧩"` を上書きしている

## 次のAIが最初に行う調査

### 1. raw response を確認する

送信直後と再取得時に、次をログ出力して比較する。

- `res.message.id`
- `res.message.contentType`
- `res.message.contentMetadata`
- `res.message.text`
- `CSSTKID` の型と値
- `createCombinationSticker` の戻り値 `created.id`

ログにはトークンや本文全体を出さず、ID・キー名だけを出すこと。

### 2. `🧩` の全代入箇所を確認する

```powershell
rg -n '🧩|sticker\s*:' Vyline/apps/desktop/src
```

特に次を確認:

- `Vyline/apps/desktop/src/lib/mappers.ts`
- `Vyline/apps/desktop/src/lib/store.ts`
- `Vyline/apps/desktop/src/components/message-bubble.tsx`

### 3. mapper 呼び出し経路を全確認する

現在確認すべき呼び出し箇所:

- 初期 hydrate
- `refreshMessages`
- `mergeIncomingMessages`
- 通常送信の確認済みメッセージ処理
- コンビネーション送信の確認済みメッセージ処理
- retry 処理

どの経路でも raw の `CSSTKID` が mapper に渡ることを確認する。

### 4. サーバが返すコンビネーション画像を確認する

次のURLが本当に画像を返すか、ブラウザのNetworkで確認する。

```text
/api/cdn/line?u=https%3A%2F%2Fstickershop.line-scdn.net%2Fstickershop%2Fv1%2Fsticker%2F{CSSTKID}%2Fandroid%2Fsticker.png
```

無効なら、Desktop/HAR でコンビネーション用の画像URL形式を探す。`CSSTKID` を通常スタンプIDのURLに流用し続けないこと。

### 5. 作成と送信を分離して検証する

- 作成APIだけ呼び、返された `id` で画像取得できるか
- 作成済みIDを使って送信できるか
- 送信メッセージの `contentMetadata` にどのキーが付くか
- 送信後の履歴で同じキーが残るか

## 受け入れ条件

- 2個以上の対応スタンプを配置して送信できる
- 対応不可スタンプはドラッグできない
- 送信後に画像が `🧩` へ変わらない
- 画面再描画、チャット切替、再同期、アプリ再起動後も表示できる
- 通常の画像送信欄へスタンプが混入しない
- LINE側の受信者にもコンビネーションスタンプとして届く
- 単一スタンプ送信の既存動作を壊さない

## 安全な送信テスト先

実グループ・実友だちへ送信しない。許可されたテスト先のみ:

- グループ: `c1efe9d6cf1848350bc91848a8a29963e`
- BOT: `u81c530b68cc2efdd36911d214bd5f084`

## 現在のワークツリー注意事項

- 作業ブランチは `codex/hide-profile-details`
- 既に多数の未コミット変更があるため、無関係な差分を revert しない
- `docs/analysis/multi-image-send-handoff.md` は複数画像送信の別問題の引き継ぎ書
- 今回の主題は複数画像ではなく、複数スタンプのコンビネーション送信・表示
- Desktop の型チェックは成功
- ルート全体の型チェックは既存の `Vyline/backend/src/service/lineService.ts:1046` の型エラーで停止している

## ひとことで言うと

UI配置と送信API呼び出しは存在するが、**LINEの送信レスポンス・履歴レスポンスに含まれるコンビネーションIDと画像取得方法の実証が不足している**。次は `CSSTKID` の実値を送信直後・履歴再取得後で比較し、Desktop/HARの正しいコンビネーション画像取得経路を確定すること。
