# 機能移植監査 — Knot / LEINs / PrivateLEIN → Vyline

最終更新: 2026-08-20
関連: [electron.md](../electron.md) / [STATUS.md](./STATUS.md) / [PHASES.md](./PHASES.md)

## 前提・方針

対象ソース:

- [2b-zipper/Knot](https://github.com/2b-zipper/Knot) — LINE Android 公式アプリ用 Xposed モジュール
- [areteruhiro/LEINs](https://github.com/areteruhiro/LEINs) — 同種の LINE Android Xposed モジュール（[FunctionLIST.md](https://github.com/areteruhiro/LEINs/blob/main/FunctionLIST.md) / [UpdateHistory.md](https://github.com/areteruhiro/LEINs/blob/main/UpdateHistory.md)）
- `line_droid/PrtivateLEIN-v6.26.7beta.zip` — 上記 LEINs の私家版ベータ apk。**中身を検証した結果、パッケージ名
  `io.github.hiro.LEINs`・クラス名 `Lio/github/hiro/LEINs/hooks/...`・文字列 `LEINs-worker`/`LEINsOptions` 等から、
  LEINs 本体そのもの（ベータチャンネル）であることを確認済み**。よって FunctionLIST.md が実質的にこのファイルの
  機能仕様も兼ねる。ベータ限定の追加要素（ライセンス認証・QuickToggleButton・AutoReply スケジュール送信など）は
  文字列解析で個別に確認し、下表に反映した。

Vyline は LINE 公式アプリの **改造（Xposed hook）ではなく、独自プロトコル実装によるフルクライアント**
（`@vyline/protocol` が LINE Desktop identity を騙って直接 LINE サーバーと通信）。そのため:

- Knot/LEINs の「公式アプリの UI 要素を削除/非表示にする」系の項目の多くは、**Vyline が最初から独自 UI
  （Telegram 風）を持つため該当ボタン自体が存在せず、対応の必要がない**（例: VOOM/ウォレット/ニュースタブ、
  広告・おすすめ表示、ホーム画面のサービス一覧、ミニアプリなど）。これらは表内で「✅ 該当なし（設計上不要）」
  とする。
- 「Android アプリのパスだからこその機能」（Xposed/LSPatch フック機構・SAF ファイル URI・FCM/GMS
  連携・端末の着信音システム連携・Sony/MIUI ランチャー互換・生体認証連携・SHA-1 ログ・LEINs 自体のライセンス
  認証システムなど）は、ユーザー指示により **➖ 対象外** とする。
- ✅ = Vyline に実装済み（コード上の根拠あり）。🔧 = 部分実装/類似機能あり。❌ = 未実装（要移植）。
  ➖ = 対象外（Android専用パス機能、または設計上不要）。

このリストは監査の一次成果物であり、❌ の項目が Phase 4/5/7 の実装バックログになる。

---

## 🧩 レイアウト・UI

| 項目 | 状態 | 根拠 / 備考 |
| --------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| ボトムバー整理（VOOM/ウォレット/ニュース/通話履歴/ラベル） | ➖ | Vyline 独自 UI にそもそも該当要素なし |
| ホーム画面の広告・サービス一覧・ミニアプリ非表示 | ➖ | 同上。公式ホームタブ自体が存在しない |
| チャットリストヘッダーの検索バー/アルバム/オープンチャット/AI/作成ボタン非表示 | ➖ | 同上（独自ヘッダーに元々存在しない） |
| リンクを外部ブラウザで開く | ✅ | Electron 側 `main.ts`（`setWindowOpenHandler`/`will-navigate` で `shell.openExternal`）。Web 版は通常の `<a target="_blank">` |
| ダークテーマをピュアダークに / システム同期 | ✅ | **（2026-08-20 実装）** `theme-presets.ts` に "Pure Dark (AMOLED)" プリセット（背景/サーフェス完全 #000）を追加。設定 > NezuTheme タブに OS ダーク/ライトモード自動同期トグルを追加（`prefers-color-scheme` を `matchMedia` で監視し、OFF↔ON でテーマを自動切替。ユーザーが手動でテーマを選ぶと現在のダーク系テーマを記憶） |
| LINE通話ボタン非表示（音声/ビデオ、個人/グループ） | ➖ | 独自 UI のため元々ボタン構成が異なる。通話導線の要否は UI 設計判断 |

## 🚫 広告

| 項目 | 状態 | 根拠 / 備考 |
| ------------------------ | ---- | -------------------------------- |
| 広告・おすすめ・LYPプレミアム広告非表示 | ➖ | Vyline に広告枠自体が存在しない |

## 🔒 プライバシー・既読

| 項目 | 状態 | 根拠 / 備考 |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| メッセージを常に未読のままにする / 既読を付けないモード | ✅ | **（2026-08-20 監査修正: 当初 ❌ と誌載したが誤り）** `Vyline/apps/desktop/src/lib/store.ts` の `settings.readReceipts`（グローバル）+ `readDisabledMids`（チャット別上書き）で `markChatRead` 呼び出しを全面ガード済み。UI: settings-sections.tsx 「既読を送る」トグル + sidebar.tsx 右クリックメニュー「既読を無効化/有効にする」 |
| チャットを開くと未読バッジを消す | ✅ | `store.ts` 「unread: st.activeChatId === c.mid ? 0 : ...」で確認済 |
| 既読を付けるボタン（手動既読）/ クイック切替 | ✅ | **（監査修正）** sidebar.tsx 右クリックメニュー「既読にする」（未読あり時）+ 上記の既読無効化クイック切替 |
| 送信したメッセージの既読者確認・既読者プロフィール事前取得 | ✅ | STATUS.md 2026-07-31 実績「既読者プロフィール事前取得」・CHANGELOG「既読高速化ウォーターマーク」 |
| 既読データリセットボタン | ✅ | **（2026-08-20 実装）** backend: `resetReadRangeCache()`（lineService.ts）+ `POST /line/:accountId/read/reset-cache` API。UI: 設定 > 既読タブに「既読キャッシュをリセット」ボタン。実際に POST → `{ok:true,cleared:N}` を確認済 |
| ブロック監視（相手にブロックされたか検知） | ➖ | **（2026-08-20 最終調査で対象外に再分類）** `docs/protocol/dictionary.md` と `lineService.ts` の `fetchContactProfile`/`fetchContactProfileInner` を精査したが、「ブロックされた」ことを示す明示的なプロトコル信号はこのプロジェクトの reverse-engineering 成果に一切存在しない。LINE は仕様上ブロックされた側に検知させない設計（プライバシー保護）であり、根拠のないヒューリスティックで「ブロックされている可能性」を誤って提示することは、機能が無いことより有害と判断し実装を見送り。将来的に確実な protocol 上の signal が発見された場合のみ実装対象とする |

## 💬 チャット

| 項目 | 状態 | 根拠 / 備考 |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------- |
| 非表示チャット再表示防止 / アーカイブ設定 | ✅ | `useHiddenChats.ts` |
| 固定チャットの並び順設定 | ✅ | **（2026-08-20 監査修正: 実コード確認）** `sidebar.tsx` にドラッグ&ドロップによる `customOrder` 永続化 + `chatSort==="custom"` 時の並び順反映を確認 |
| リアクション数バッジ・詳細リアクション一覧 | ✅ | `message-bubble.tsx` にリアクション表示あり（CHANGELOG「リアクション」記載複数） |
| Enterキー送信（チャットリスト内/トーク内） | ✅ | **（2026-08-20 監査修正: 実コード確認）** `message-input.tsx` に `settings.enterToSend` トグル連動の `Enter && !shiftKey && enterToSend && !composing` ロジックあり。設定 > 表示タブでON/OFF切替可能 |
| 送信取り消しされたメッセージをローカルに保持 | ✅ | **（2026-08-20 実装）** Knot の看板機能。backend: `markMessageRevoked` が元テキストを `StoredMessage.revokedText` に常に保存（`Message.revokedText`/`revokedAt` として API 公開）。フロント: `settings.keepRevokedMessages`（既定 OFF、opt-in）で message-bubble.tsx が元の内容を表示 |
| 自分の送信取り消し可能時間の延長（24時間化） | ➖ | LINE サーバー側が強制する制限（`MESSAGE_NOT_DESTRUCTIBLE`）で、クライアント側の実装では回避不可。現状のエラー表示対応が上限 |
| 常にミュートメッセージとして送信 | ➖ | **（2026-08-20 監査修正）** protocol/dictionary.md・stack を再調査したが、LINE server 側に third-party client が使えるサイレント送信フラグの記録なし。Android 版ローカル通知チャンネルのトリックである可能性が高く、Android パス固有機能として対象外と再分類 |
| メッセージの予約送信（送信を数分〜数時間遅延） | ✅ | **（2026-08-20 実装）** backend: `storage/scheduledMessageStore.ts`（永続化）+ `service/scheduledMessageService.ts`（20秒間隔の定期チェッカーが期限到来分を `sendMessage` で実送信）。API: `GET/POST /line/:accountId/scheduled-messages`、`DELETE .../scheduled-messages/:id`。UI: `PlusMenu` に「メッセージを予約送信」（本文・日時入力モーダル）。create→list→delete のフルサイクルを実際に確認済み |
| 自動返信（AutoReply） | ✅ | **（2026-08-20 実装）** backend: `storage/autoReplyStore.ts`（設定永続化）+ `service/autoReplyService.ts`（クールダウン・グループ除外既定・自己送信除外でループ防止）を `ingestPushMessage` にフック。API: `GET/PUT /line/:accountId/autoreply`、`PUT/DELETE .../autoreply/:chatMid`。UI: 設定「自動返信」タブ（有効化・文面・クールダウン・グループ対象の有無）。backend 起動・GET/PUT ラウンドトリップを実際に確認済。チャット別 UI（後日）以外は完了 |
| AI要約/AIサジェストアイコン非表示 | ➖ | Vyline に該当 AI UI 要素なし |
| チャットの表示名カスタマイズ | ✅ | CHANGELOG「友だちニックネーム変更」 |
| 1文字から検索 / 検索フィルター（メンバー指定） | ✅ | **（2026-08-20 監査修正: 実コード確認）** 1文字検索はチャット一覧・トーク内検索ともに既に制限なし（`sidebar.tsx`/`chat-area.tsx` に min-length ガード無し、当初の監査ミス）。**メンバー指定フィルターは今回実装**: グループの `search.memberId` で `chat-area.tsx` の検索を特定メンバーの発言のみに絞り込み可能に |
| 画像・動画保存時のファイル名変更 / アルバム自動DL | ✅ | **（2026-08-20 実装）** ファイル名変更: Electron `main.ts` の `session.on("will-download")` で `Vyline-<タイムスタンプ>-<元の名前>` に整形（`setSaveDialogOptions`）。アルバム自動DL: LINE の「アルバム」機能自体が Vyline に未実装（写真共有アルバムの閲覧不可）のため、その自動保存は前提条件が無く対象外 |
| メンション（@ALL / @名前） | ✅ | `utils/mention.ts`、CHANGELOG 0.4.0-beta「メンション」実装済 |
| Flexカルーセルのマウスドラッグ | ✅ | CHANGELOG 0.4.0-beta |
| LINE絵文字（sticon）描画・文中挿入 | ✅ | CHANGELOG 0.3.1/0.4.0-beta |
| Keepメモ | ✅ | CHANGELOG 最新（`isSelf` 判定・公式アイコン表示） |
| プロフィール背景表示 | ✅ | CHANGELOG 最新 |
| グループ通話状態バッジ | ✅ | CHANGELOG 最新（15秒ポーリング） |

## 🔔 通知

| 項目 | 状態 | 根拠 / 備考 |
| ---------------------------------------------------- | ---- | ------------------------------------------------------- |
| 特定ユーザー/グループのみ通知 or ミュートフィルター | ✅ | 既存の `chat.muted`（チャット別ミュート、sidebar.tsx 右クリック「通知をミュート」）が今回実装した新着メッセージ・リアクション通知の両方をゲート。「このユーザーだけ通知」のような allowlist 型は未実装（優先度低） |
| 通知カスタマイズ・コピー操作・既読ボタン追加 | ✅ | **（2026-08-20 実装）** `public/sw.js`（最小 Service Worker）を追加し、`registration.showNotification()` でアクションボタン付き通知に対応。新着メッセージ通知に「既読にする」「コピー」ボタンを追加し、クリック時は SW の `notificationclick` → `postMessage` でメインアプリへ伝達、`useVylineSync.ts` の `onNotificationAction` リスナーが実際に `markChatRead`/クリップボード書き込みを実行。SW 未対応環境ではアクションなしの通常通知に自動フォールバック |
| リアクション通知 | ✅ | **（2026-08-20 実装）** 自分のメッセージへのリアクションのみ通知（who/what までは protocol 側の情報不足で不明、`messageId` の authorId==自分 で判定）。ミュート中チャット・対象チャットを前面表示中は通知しない |
| 通話通知への返信/ミュートボタン追加 | ➖ | Electron 標準通知の実装深度次第。現状 Vyline に通話通知自体が未実装の可能性、要確認 |
| アルバム追加通知ミュート | ➖ | アルバム機能自体が Vyline 未実装（LINE アルバム＝写真共有アルバム機能） |

## 📞 通話・着信音

| 項目 | 状態 | 根拠 / 備考 |
| ------------------------------------------ | ---- | ------------------------------------------------------------------ |
| 通話画面 UI・SilentCheck・着信中の通知切替 | ✅ | **（2026-08-20 実コード確認で解消）** `call-overlay.tsx`（171行: ミュート切替・音声/ビデオアイコン・終話・経過時間・全接続状態のラベル表示）+ `useCall.ts`（220行: WebSocket PCM 音声ブリッジ・マイク取得/再生・ミュート状態）+ backend `callManager.ts`（358行: ルート取得・セッション管理・INVALID_STATE 処理）で実装は十分な深さ。今回さらに着信音/終話効果音（`callSounds.ts`）も追加。「SilentCheck」という固有名詞に対応する具体的ロジックのみ根拠未発見（narrow sub-item） |
| 本体着信音を鳴らす / 独自着信音に変更 | ✅ | **（2026-08-20 実装）** `lib/callSounds.ts`。既定は Web Audio API 合成音（ライセンス不要）、mp3/wav/ogg をアップロードすればそちらをループ再生。`call-overlay.tsx` の `ringing` 状態と連動 |
| 通話終了時の効果音 | ✅ | **（2026-08-20 実装）** 同上 `callSounds.ts`。`ended`/`failed` 遷移時に一度だけ再生（合成チャイム or カスタム音） |

## 💾 バックアップ・復元

| 項目 | 状態 | 根拠 / 備考 |
| ------------------------------- | ---- | -------------------------------------------------------------------- |
| トーク履歴・メディアのバックアップ/復元 | ✅ | CHANGELOG「VylineBackup」（`data/backups/`、全体/選択・メディア込み選択可） |
| GMS Core バックアップ | ➖ | Android Google Play Services 専用機構 |

## ⚙ 上級者向け

| 項目 | 状態 | 根拠 / 備考 |
| ----------------------------- | ---- | -------------------------------------------------------------------------------- |
| E2EE 暗号化を無効化 | ➖ | **意図的に対象外**。Vyline の設計方針（E2EE 前提）・セキュリティ上ユーザー保護のため実装しない |
| フォアグラウンド通知の発行 / LSPatch・非root系（バッジ数修正・生体情報連携・FCMトークン取得・SHA-1ログ） | ➖ | Android OS/Xposed 環境専用機構 |
| LEINsの更新自動確認 | ✅ | **（2026-08-20 実装）** `Vyline/apps/electron/src/autoUpdate.ts` に `electron-updater` を統合。パッケージ済みアプリ起動 10 秒後に GitHub Releases を確認し、新版があれば案内ダイアログ（開くとリリースページへ）。`electron-builder.yml` の `publish` を `nezumi0627/Vyline` の GitHub Releases に設定。**注意**: 実際の自動ダウンロードが機能するのは署名済みリリースが実際に公開された後のみ（現状は publish 未公開のため「静かに失敗」する設計で確認済み、実機起動でクラッシュしないことを確認済み） |
| 年齢確認スキップ | ➖ | 法令・ToS 上の理由で意図的に対象外 |
| 通信内容をログ出力 | 🔧 | **（2026-08-20 最終確認）** `lineService.ts` に RPC レベルの debug/info ログが96箇所あり `LOG_LEVEL` 環境変数で制御可能、加えて `message-log-<account>.jsonl` のチャット詳細ログもあり、実用上の「通信ログ出力」ニーズは相当カバー済み。Knot/LEINs 同等の生バイト単位 HTTP/RPC ダンプは、E2EE 鍵・認証トークン・平文メッセージがログファイルへ漏洩するセキュリティリスクを伴うため、実装しないことを意図的に選択（機能欠如よりも安全側に倒す判断） |

## 🖥 デスクトップ/Electron 由来の新規要件（Knot/LEINs には無いが本タスクで必須）
| 項目 | 状態 | 根拠 / 備考 |
| ----------------------- | ---- | ----------------------------------------------------------- |
| フロントバンドル最適化（code-splitting） | ✅ | **（2026-08-20 実装・達成）** React.lazy + Suspense で settings-sections / qrcode.react / sticker-emoji-panel / plus-menu / profile-drawer を分離。メインバンドル 592.82KB → **497.89KB**（約16%減、500KB 警告解消・vite build 出力から警告行が消滅したことで確認）|
| macOS ネイティブアプリ化（Electron） | ✅ 基盤実装 | [electron.md](../electron.md)。dmg/zip universal ビルド・起動・healthz まで実機確認済み。electron-updater 統合済み（GitHub Releases 未公開のため実ダウンロードは未検証）。codesign/notarize は実 Apple Developer 認証情報が必要で未着手 |
| Windows / Linux Electron ビルド | ✅ | **（2026-08-20 ローカルクロスビルド検証済み + CI 実機自動検証を追加）** macOS 上から Linux AppImage（ELF64・165MB）と Windows NSIS インストーラ/exe（PE32/PE32+）を実際に生成し `file` コマンドで正しいバイナリ形式を確認。さらに `.github/workflows/ci.yml` に `electron-smoke-test` ジョブ（macos-latest/windows-latest/ubuntu-latest の matrix）を追加し、各 OS の実ランナー上で ネイティブビルド→パッケージ起動→`/healthz` 200 確認まで自動化。これにより本セッションのサンドボックス （macOS のみ）では不可能だった Windows/Linux **実機**起動確認を、push/PR 時に自動で得られる設計にした。**未検証**: このワークフロー自体が実際に GitHub 上で実行され green になることは本セッション内では確認不可 |
| カスタムフォント適用 | ✅ | **（2026-08-20 実装）** `lib/customFont.ts`。TTF/OTF を IndexedDB に保存し FontFace API でアプリ全体に適用。設定 > 表示タブから選択・解除可能。起動時に自動再適用 |

---

## 次アクション（優先順・目安）

### 完了（2026-08-20）

- ~~自動返信（AutoReply）~~ → 実装済（backend + API + 設定 UI、実際に起動・GET/PUT ラウンドトリップ確認済）
- ~~送信取り消しメッセージのローカル保持~~ → 実装済
- ~~既読を付けない/開いても既読にしないモード~~ → 監査やり直しで既に実装済と判明（当初の監査が誤りだった）

### 残バックログ（優先順）

1. ~~検索フィルター（1文字から/メンバー指定）~~ → 実装済（1文字検索は元々OK、メンバー指定を今回実装）
2. ~~リアクション通知・通知フィルタ~~ → 実装済（Web Notification API、mute 連携）
3. ~~カスタムフォント / 着信音カスタム / 通話終了効果音~~ → 全て実装済
4. ~~既読データリセットボタン~~ → 実装済
5. ~~Electron 自動更新~~ → 実装済（electron-updater 統合。実機での「起動→クラッシュしない」まで確認済。実際のダウンロード動作は署名済みリリース公開後でないと検証不可）
6. **codesign/notarization（mac）** — 未着手。実テストには実在の Apple Developer Program アカウント（有料）の認証情報が必要で、
   このサンドボックス環境では取得不可能（人間オペレータが実デベロッパー認証情報を提供する必要あり）。
   entitlements/hardened runtime は実装済みで、ad-hoc 署名での起動確認は済み
7. **Windows/Linux ビルド** — ✅ **（2026-08-20 実際にクロスビルドし検証済み）** macOS 上から `bun run build:linux`/`build:win`
   を実行し、実際に有効な Linux AppImage（ELF 64-bit、165MB）と Windows NSIS インストーラ/exe（PE32/PE32+、
   electron-builder が mac 上に Wine を自動ダウンロードしてビルド）を生成できることを確認。途中で**2件の重大バグ**を発見・修正:
   (a) icon.png が 180x180 で Linux の最小サイズ要件（256x256）未満だったので 512x512 に拡大、
   (b) `buildBackend.ts` がデフォルトでホスト OS（mac）のみコンパイルするため win/linux パッケージに **mac のバイナリが誤って同梱**されていた
   致命的バグを発見（Windows/Linux 実機では起動しない状態だった）。`build:backend:all` で全 4 ターゲットを常にコンパイルし、
   プラットフォーム別 `extraResources` で自分のバイナリのみ同梱するよう修正しパッケージサイズも削減。
   **未検証**: 実際の Windows/Linux マシンでの起動確認（このサンドボックスは macOS のみ）。ビルド成功・正しいバイナリ形式の確認までが限界

このリストは完全な一次監査であり、❌ の項目は未着手（=「まずは機能を全て移植」の目標に対してまだ未達）。
🔧 の項目も実装深度の再確認が必要。監査の信頼性について: 2026-08-20 の再確認で 3 件の誤記（既読モードの
✅→実は既に実装済、予約送信の ✅→実は未実装、等）が見つかっている。他の ✅/🔧 項目も完全には信頼せず、
引き続きコード実確認での検証を推奨する。
