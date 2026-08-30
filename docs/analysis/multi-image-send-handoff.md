# multi-image-send — 引き継ぎメモ

最終更新: 2026-08-24

## 2026-08-22 夜間の結論（重要）

**原因確定: 旧経路はサーバに届いていなかった。**

- `uploadObjTalkMessage`（UUID OBS パス + thrift sendMessage）で送っても
  **getPreviousMessagesV2 に一切現れない**ことを実機で実証
- 公式アプリ（HAR は iPhone から捕捉）は **OBS `/r/talk/m/reqseq` に連番 reqseq で
  アップロードし、サーバ側がメッセージを生成する** 方式
- 対応: `sendMediaBatch` plain 経路を `uploadObjTalkBatch`（reqseq 連番）へ変更
  → 2〜3 枚送信で履歴に IMAGE が出ることを実機確認
- 応答ヘッダ `x-obs-oid`（== 生成メッセージ ID の実測）をキーに送信バイトを
  サーバー側の永続メディアストレージに置き、自クライアントの再表示を実現
  （reqseq 生成メッセージは contentMetadata に OID を持たないため）

## 未解決

1. **アルバムメタデータ (GID/GSEQ/GTOTAL) の再現未達**
   - 公式クライアント送信分は `contentMetadata` に GID/GSEQ/GTOTAL が付く
     （chatdb の ClockAngel 送信分で確認: GID=先頭メッセージID+1 の実測例あり）
   - Vyline からの reqseq 送信には付かない。OBS 応答ヘッダ `x-line-message-gid`
     は Desktop HAR で確認済みだが Vyline 分は未確認（ヘッダログの [object Headers] 化は要修正）
   - UI は `shouldGroupAdjacentImages`（sender + 30s 窓）でフォールバックグルーピング
   - 次の調査: OBS 応答ヘッダの gid 有無を確認（uploadObjTalk の戻り headers を
     ちゃんとシリアライズしてログ）、リージョン host / x-line-application 差分
2. **受信側の最終確認**（朝推奨）: スマホ公式アプリで うがうがうー の
   2026-08-22 深夜の画像群が表示・開けるか
3. `x-obs-oid == メッセージID` の一致は 2 回の実測のみ。大量送信での妥当性検証

## テスト手順（実機）

```powershell
# backend 起動（ログキャプチャ推奨）
bun Vyline/backend/src/index.ts *> backend.log

# 3枚送信
POST http://127.0.0.1:3001/line/main/send-media-batch
{ "chatMid": "c1efe9d6cf1848350bc91848a8a29963e",
  "items": [ { "dataBase64": "...", "mimeType": "image/png", "mediaType": "image" } x3 ] }

# 履歴確認（force でサーバ取得）
GET http://127.0.0.1:3001/line/main/messages/c1efe9d6cf1848350bc91848a8a29963e?limit=15&force=1
# → contentType IMAGE が連続してればOK。media は
# GET /line/main/media/<chatMid>/<messageId> で保存メディアの HIT（互換ヘッダー `X-Vyline-Media-Cache: HIT`）を確認
```

---

# 以下: 2026-08-21 時点の旧メモ（参考）

## 現在の作業状態

- 作業ブランチ: `codex/hide-profile-details`
- ワークツリーは既に複数機能の未コミット変更を含む。無関係な差分を戻さないこと
- コンビネーションスタンプの表示修正も同じワークツリーに含まれるが、複数画像送信とは別問題
- Desktop の型チェックは成功: `bun run typecheck` を Desktop ディレクトリで実行
- ルートの全体型チェックは既存の backend エラーで停止中: `Vyline/backend/src/service/lineService.ts:1046` の `string | null` を `string | undefined` に代入している箇所

## 結論

Vyline はまだ **「本当の複数画像送信」** を実現できていない。

2026-08-21 時点でも未解決で、今のところ「複数選択 UI」や「batch 送信 API」はあるが、最終的な送信結果は 1 message に束ねられていない。

- UI 上で複数画像をまとめて選択して送る導線はある
- backend / protocol 側でも batch 送信の経路は追加した
- ただし現状の送信結果は **画像 3 枚なら message 3 件** で、ユーザーが求めている「1 回の送信で複数画像を持つ payload」にはなっていない
- `sendLiff` は今回の要件から除外すること。ユーザーが明示的に拒否している

## ユーザー要求

- 複数画像を送るときに、チャット欄上の送信前プレビューでまとまって見えること
- 送信時も UI だけでなく、**実際の payload として multi image** で送れること
- 合成画像 1 枚にするのは不可
- 連投で 3 件に分かれるのも不可
- Desktop の実装や `search tool` 由来の解析を元に移植すること
- `sendLiff` 経由ではなく探すこと

## 症状

過去に確認された失敗:

- `getLastE2EEPublicKeys(/S4)` → `E2EE_RETRY_PLAIN`
- `sendMessage(/S4)` → `REFRESH_MEDIA_FLOW`

その後、`determineMediaMessageFlow` を送信前に呼んで plain / reqseq 経路へ分岐する変更は入れたが、**message が 1 件にまとまる問題は未解決**。

## 安全なテスト先

送信テストはこの 2 つのみ:

- グループ `c1efe9d6cf1848350bc91848a8a29963e`
- BOT `u81c530b68cc2efdd36911d214bd5f084`

## 調査で確認できた事実

### 1. HAR 上の送信

対象:

- `obs-jp.line-apps.com_2026_08_21_20_06_00.har`
- `uts-front.line-apps.com_2026_08_21_18_13_58.har`

確認できたこと:

- `obs-jp...har` では `POST https://obs-jp.line-apps.com/r/talk/m/reqseq` が 3 件
- 各リクエストの `X-Obs-Params` は別々の `reqseq`
- 例:
  - `17195037`
  - `17195038`
  - `17195039`
- `tomid` は同一チャット
- `type` は `image`
- HAR 上では **1 つの HTTP payload に複数画像を同梱している証拠は見つかっていない**

### 2. media flow

ローカルで `determineMediaMessageFlow` を確認した結果:

- chat: `c1efe9d6cf1848350bc91848a8a29963e`
- `flowMap: {"1":1,"2":1,"3":1,"14":1}`
- `cacheTtlMillis: "21600000"`

解釈:

- image / video / audio / file ともに `MediaMessageFlow.V1 = 1`
- この chat は Desktop 準拠で `OBS /r/talk/m/reqseq` に寄せる必要がある

### 3. linejs 調査

参照:

- `https://github.com/evex-dev/linejs`

確認できたこと:

- `packages/linejs/base/obs/mod.ts` に `uploadObjTalk(...)` がある
- ここは `oid: "reqseq"` と `tomid`, `reqseq` を使って OBS へ送る
- OpenChat 側コメントでも「reqseq mode では server creates the message」と読める
- `sendLiff` / `shareMessages` は存在するが、ユーザー要件から除外
- **LIFF 以外で「1 message の中に複数 image payload を持つ Talk 実装」は見つけられていない**

## 今回入った変更

主に以下:

- frontend で複数選択時の送信を `sendMediaBatch` に寄せた
- 画像合成処理は削除
- backend に `sendMediaBatch(...)` を追加
- `determineMediaMessageFlow` を送信前に呼び、flow=1 なら plain reqseq 経路へ分岐
- protocol `BaseClient` に `getReqseqs(...)` を追加
- protocol `LineObs` に `uploadObjTalkBatch(...)` を追加
- `uploadObjTalkBatch(...)` は複数 `reqseq` をまとめて確保し、各画像を OBS へ投げる
- E2EE plain fallback で `E2EE_RETRY_PLAIN` / `member settings off` を拾うようにした

## コンビネーションスタンプの直近修正（参考）

複数画像送信とは別だが、直近で `🧩` に置換される不具合を調査した。

- `Vyline/apps/desktop/src/lib/store.ts` でプレビュー保存キーを `mapped.id` だけでなく `CSSTKID` に統一
- `Vyline/apps/desktop/src/lib/mappers.ts` でキャッシュ未取得時も `🧩` ではなく `lineStickerUrl(CSSTKID)` を表示
- `Vyline/apps/desktop/src/utils/combinationStickers.ts` にローカルプレビューを保存
- 送信後の再同期でプレビューを保持する処理を `store.ts` に追加

この変更を複数画像送信の調査と混ぜないこと。`CSSTKID` の問題を直しても、画像3枚が1つのLINEメッセージになるわけではない。

## 重要: まだ未解決な点

今の batch 実装は「route レベルの逐次ループ」よりは Desktop に近いが、**結果としては still 3 messages**。

つまり:

- `sendMediaBatch` はある
- `uploadObjTalkBatch` もある
- しかし server side で生成される message が 1 件に束ねられていない

ここが今回の handoff の本題。

## 変更済みファイル

今回の作業で直接触った主要ファイル:

- `Vyline/backend/src/service/lineService.ts`
- `Vyline/backend/src/api/line.ts`
- `Vyline/packages/protocol/stack/base/core/mod.ts`
- `Vyline/packages/protocol/stack/base/obs/mod.ts`
- `Vyline/packages/protocol/stack/_dist/base/core/mod.d.ts`
- `Vyline/packages/protocol/stack/_dist/base/obs/mod.d.ts`
- `Vyline/apps/desktop/src/components/message-input.tsx`

補助的に、UI 側では受信表示をグループ化する変更も入っている:

- `Vyline/apps/desktop/src/components/chat-area.tsx`
- `Vyline/apps/desktop/src/components/message-bubble.tsx`

ただしこれは送信 payload 解決ではない。

## 既に通した確認

- `bun run --cwd Vyline/backend typecheck`
- `bun run --cwd Vyline/packages/protocol typecheck`
- `bun run --cwd Vyline/apps/desktop typecheck`
- `bunx biome check ...`

また、テスト API 呼び出しで以下は通った:

- `POST http://127.0.0.1:3001/line/main/send-media-batch`
- 結果: `{ "ok": true, "count": 3 }`

この `count: 3` 自体が、未解決の本質でもある。

## 次の AI が最優先でやること

### 1. Desktop 実装の「message まとまり条件」を特定する

見るべき観点:

- `reqseq` 連番だけで十分なのか
- 追加の S4 / UTS / LIFF 以外の事前 RPC があるか
- 複数画像の束ねに必要な `contentMetadata` / `messageRelationType` / `chunks` / `headers` があるか
- OBS 送信後に別 RPC で group 化している可能性がないか

特に、HAR だけでなく Desktop 解析ツール側で:

- `multi image`
- `media message flow`
- `reqseq`
- `talk/m/reqseq`
- `messageRelationType`
- `album`
- `media bundle`

あたりを重点的に追うこと。

### 2. linejs 以外の Desktop 痕跡を探す

linejs に無いから終わり、ではない。

- Vyline-Search / Desktop 解析結果
- `rpcMap.ts`
- recovered strings
- `source/desktop/` の解析成果

を使って、公式 Desktop がどこで multi image を束ねているか再確認すること。

### 3. UI grouping と送信 payload を混同しない

受信表示を 1 塊に見せる変更は入っているが、ユーザーが欲しいのはそこではない。

判定基準:

- LINE 本体や他クライアントでも「複数画像 1 回送信」として見えるか
- HAR / RPC / 保存 message に multi-image の痕跡が残るか
- Vyline ローカル UI だけの grouping になっていないか

## 注意

- `sendLiff` は使わない
- 合成画像は不可
- 実グループ・実友だちには送らない
- 既存の dirty worktree があるので、関係ない差分は巻き込まない
- 調査用の `.tmp-linejs-b015243/` は未追跡で残っている

## ひとことで言うと

今の実装は **「複数選択を batch 送信するところ」までは進んだが、「LINE の本当の multi image message を再現する条件」がまだ取れていない**。
