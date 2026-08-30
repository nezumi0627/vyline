# Desktop LINE におけるメッセージ編集と Premium ゲートの挙動

最終更新: 2026-08-24

> 調査日: 2026-08-20
> 対象バイナリ: `source/desktop/unpacked_LINE.exe`（LINE Desktop 26.3.0.3916, Themida 解凍済み, 85.5 MB）
> 手法: `tools/findNativeSymbol.ts` による文字列/LEA-xref 特定 → Ghidra 12.1.2 headless 逆コンパイル
> 目的: メッセージ編集（editMessage）と Premium 制限がクライアント側でどう扱われるかを**文書化するのみ**（実装変更・バイパスは対象外）

## 結論（先行）

**Premium によるメッセージ編集の制限は、クライアント（Desktop LINE）側には存在しない。編集 RPC は常に無条件に送信され、ゲートは LINE サーバー側の資格（cmode / entitlement）チェックで施行される。** クライアントは premium 状態を「観測・キャッシュ・表示」するだけで、独自の gate ロジックは持たない。したがって「クライアント側での抜け穴」は存在せず、非プレミアムでの編集実現はサーバーの認証/資格チェックの偽装・悪用に帰着する（本調査の範囲外）。

## 発見した主要シンボル

| シンボル / 文字列 | 種別 | 意味 |
|---|---|---|
| `TalkService_editMessage_pargs` / `TalkService_editMessage_presult` | RTTI (thrift) | 編集 RPC のリクエスト/レスポンス型 |
| `TalkService_getMessageEditNotice_pargs` / `_presult` | RTTI (thrift) | 編集通知取得 RPC の型 |
| `line::LanService::onPremiumMessageEditTermsCompleted` | 関数名 | サーバー(LAN)からの premium 編集規約 受信コールバック |
| `line::PremiumManager::updatePremiumInfo` / `setPremiumStatus` / `onGetPremiumStatus` / `onGetProductTiers` / `onSessionOperationsReceived` | 関数名 | premium 状態の管理・キャッシュ |
| `[PremiumManager] init premium info` / `premium status changed:%s` / `receive GetPremiumStatus response. success:%d, errorCode:%d` | デバッグログ | サーバー応答の受信・キャッシュの証拠 |
| `function.premium.common.message_edit.agreement.lan` / `.agreement.version` | 設定キー | premium 編集の規約(agreement)設定 |
| `function.chatroom.message_edit.timelimit.privatechat` / `.timelimit.keepmemo` | 設定キー | 編集可能時間(プライベート/メモ保持) |
| `chat.messageedit.popupdesc.linepremiummembershipexpired` / `lyppremiummembershipexpired` | UI 文字列 | premium 期限切れ時のポップアップ文言 |
| `editMessage failed: unknown result` | エラーログ | サーバーからの失敗（NOT_PREMIUM 含む）の表示 |
| `NOT_PREMIUM` | 文字列 (1件, rva 0x31961920) | サーバーエラーコードを扱うための定数（クライアント内で gate としては使われない） |

## 逆コンパイルした証拠

出力: `tools/data/out/native-search/onPremiumMessageEdit+message_edit+PremiumManager+editMessage/functions/`

### 1. editMessage 送信側 — `FUN_7ff79b5be760`（命令 rva `0x1d7e7a1`）

`TalkService` クライアント（コンテキスト +0x30）に対してリクエスト引数を詰め、thrift 構造体を組み立て、`/S4` パス（`0x7ff79c953478`）へ `editMessage` メソッド（`0x7ff79c94d5f8`）を**無条件に送信**する。
この関数内に premium チェック・資格判定は一切ない。つまり RPC 層は「premium かどうか」を知らず、常に送る。

### 2. premium 編集規約 受信ハンドラ — `FUN_7ff79b344340`（命令 rva `0x1b043f5`）

`onPremiumMessageEditTermsCompleted` に対応。引数はサーバーからの結果コード（`param_3 & 0xffffffff`）とフラグ群。分岐は成功/失敗でログ文字列（`0x7ff79c89e300/318/330/348`、すなわち `[LAN] premium message edit terms result: %d` 等）を組み立てるだけ。**実行ロジック・ゲートはなし。** サーバーが「規約/利用可能か」を教えてくるのを受け取り、記録するのみ。

### 3. editMessage 失敗ハンドラ — `FUN_7ff79b576a60`（命令 rva `0x1d36b8f`）

ステータス（`aiStack_298[0]`）を見て、失敗時はエラーオブジェクトを作りログ（`0x7ff79cf21d40` 等 = `editMessage failed: unknown result`）に出す。サーバーから返ったエラー（NOT_PREMIUM を含む）を**表示・通知するだけ**。クライアントが gate を掛けているのではなく、サーバーの判定結果をユーザーへ伝える役割。

### 4. PremiumManager 群 — `FUN_7ff79b3391ba` / `339500` / `3395f0` / `339b52` / `339d80` / `339e70`

`onGetPremiumStatus` / `onGetProductTiers` / `onSessionOperationsReceived(NOTIFIED_UPDATE_PURCHASES)` で受け取ったサーバー応答を、内部オブジェクト（offset 0x1d8/0x1e8, 0x170/0x180 等）へ**コピー/キャッシュするセッター**に過ぎない。ローカルでの資格判定・制限演算は含まれていない。UI はこのキャッシュされた premium 状態を見て編集メニューの表示/非表示を切り替えるが、それはユーザー体験の話であり、権威的ゲートはサーバー。

## 補足: Vyline 側の状況

- `packages/protocol/stack/base/service/talk/mod.ts` の `editMessage` は `/S4` RPC の定義のみ。
- `backend/src/service/lineService.ts` はサーバーからの `NOT_PREMIUM` を日本語エラーに変換するだけで、クライアント側ゲートはない（Desktop と同じ構造）。
- よって Vyline でも「非プレミアムで編集できない」のはサーバー側起因。クライアント改修で解決する類のものではない。

## 備考

- `unpacked_LINE.exe` は `source/desktop/unpacked_LINE.exe`（26.3.0.3916）を使用。Themida 仮想化領域の一部は逆コンパイル不能な場合があるが、上記関数はいずれも正常に復元された。
- 調査は相互運用・理解のためのリバースエンジニアリングであり、Premium 全体のバイパス実装は意図的に行っていない。
