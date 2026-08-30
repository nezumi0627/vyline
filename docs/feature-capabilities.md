# Feature Capability Matrix

最終更新: 2026-08-31

この表は「コードが存在する」ことではなく、現在の worktree で確認できる Evidence Chain を基準に Vyline の機能状態を分類する。

## Status semantics

- `verified`: ユーザー可視またはローカル完結の機能について、現在の worktree で実装 chain と実行可能な検証が成立している。
- `partial`: 実装 chain は存在するが、実 LINE 環境 E2E、UI/BFF の一部、または現在の worktree 制約により終端まで実証できていない。
- `unverified`: 下位 layer の実装/evidence はあるが、製品機能としての接続 chain を確認できていない。
- `unsupported`: 現在の product chain に実装がないことを evidence で確認できたもの。推測では付与しない。

`partial` は「壊れている」という意味ではない。外部 LINE runtime を必要とする機能は、live account を使った E2E 証拠がない限り原則 `verified` に上げない。

## Matrix

| Capability | status | user behavior | evidence chain | verification | missing link / limitation |
| --- | --- | --- | --- | --- | --- |
| Login | partial | アカウントへログインする | `backend/src/api/auth.ts` → `backend/src/line/clientManager.ts` → protocol login patches → login RPC | auth/client/protocol code reviewed | 実 LINE account での live login 成功を今回未実行 |
| QR Login | partial | QR を表示してログインする | `/login/qr`, `/content/qr` → `loginWithQRCode` → protocol login | route + manager + protocol chain reviewed | live QR scan/login E2E 未実証 |
| Token | partial | 保存 token からログイン/復元する | `/login/token` → `loginWithToken`/`loginWithAuthToken` → token store | token isolation/migration、credential handoff、Windows DPAPI tests PASS | token の live server acceptance 未実証 |
| Session | partial | セッションを復元・切替する | `/restore`, `/switch/:id`, `/sessions` → client manager/session storage | token/session-related tests PASS | live reconnect/expiry handling E2E 未実証 |
| Chat List | partial | トーク一覧を見る | frontend store/sync → `GET /line/:accountId/getMessageBoxes` → `fetchChats` → Talk `getChats` | BFF/service/RPC evidence reviewed | live account の一覧取得未実証 |
| Sync | partial | 新着・差分を同期する | `useVylineSync.ts` / store polling → BFF/service sync paths → protocol | frontend account-switch/read-state tests PASS | live long-running polling/delta E2E 未実証 |
| Read | partial | 既読を送る/既読状態を保持する | frontend store → `POST /line/:accountId/sendChatChecked` → service → Talk `sendChatChecked` | local read-state merge/watermark tests PASS | `lineService.readReceipts` 系は deleted stack import で実行 blocked |
| Unread | partial | 未読数・未読位置を表示する | store/read state → chat/message mapping → sync | store persistence/read-state tests PASS | live server read/unread convergence 未実証 |
| Text | partial | テキストを送受信する | composer/store → `POST /line/:accountId/sendMessage` → service → Talk `sendMessage` | route/RPC/type evidence reviewed | live send/receive E2E 未実証 |
| Reply | partial | メッセージへ返信する | send options/metadata → `sendMessage` service → Talk message payload | implementation reviewed | live reply metadata roundtrip 未実証 |
| Unsend | partial | 送信取消する | UI/API → `POST /line/:accountId/unsendMessage` → service → Talk `unsendMessage` | unsend policy standard/premium tests PASS | live unsend server E2E 未実証 |
| Edit | partial | メッセージを編集する | UI/API → edit route/service → Talk `editMessage` | Desktop/Talk RPC evidence added to dictionary | live edit E2E 未実証 |
| Image | partial | 画像を送受信・表示する | frontend media → BFF/service media path → E2EE/OBS | implementation/evidence reviewed | live upload/download + E2EE roundtrip 未実証 |
| Video | partial | 動画を送受信・再生する | frontend media → BFF/service → OBS/media flow | implementation reviewed | live upload/download E2E 未実証 |
| Audio | partial | 音声を送受信・再生する | frontend media → BFF/service → OBS/media flow | implementation reviewed | live media E2E 未実証 |
| File | partial | ファイルを送受信・保存する | frontend media → BFF/service → OBS/media flow | implementation reviewed | live file E2E 未実証 |
| Sticker | partial | スタンプを送受信・表示する | frontend mapper/render → BFF/service message metadata → Talk | implementation reviewed | live sticker roundtrip 未実証 |
| Emoji | partial | LINE 絵文字を表示する | message mapper/render + metadata handling | implementation reviewed | representative live payload set 未検証 |
| Mention | partial | `@ALL` / member mention を送受信する | mention picker/renderer → message metadata → `sendMessage` | implementation/evidence reviewed | test groupでの live send/receive 未実証 |
| Flex | partial | Flex message を表示・操作する | message mapper → Flex renderer/components | implementation reviewed | representative payload/runtime visual E2E 未完 |
| Rich content | partial | Rich/複合 content を表示する | mapper/content renderer → media/Flex components | implementation reviewed | format coverage の executable matrix 未完 |
| Profile | partial | 自分のプロフィールを取得/更新する | frontend/API → `GET /getProfile`, `PATCH /updateProfileAttributes` → service → Talk | BFF route + dictionary/RPC evidence reviewed | live profile get/update E2E 未実証 |
| Contacts | partial | 連絡先を取得・設定変更する | `GET /getContact/:targetMid` → Relation `getContactsV3`/`getTargetProfiles`; rename/settings → Talk `updateContactSetting` | `/RE4` Relation evidence corrected and documented | live contact fetch/update E2E 未実証 |
| Groups | partial | グループ作成・招待などを行う | BFF `createChat`, `inviteIntoChat` → service → Talk `/S4` | Desktop/Talk RPC evidence reviewed | live group mutation E2E 未実証 |
| Group Members | partial | メンバー一覧・プロフィールを見る | BFF member routes → contact/profile resolution/cache → protocol | implementation reviewed | live large-group resolution/cache convergence 未実証 |
| OpenChat / Square | unverified | OpenChat/Square を利用する | protocol baseline に SquareService `/SQ1` と多数 RPC | lower-layer baseline reviewed | 現 worktree で専用 frontend → BFF → backend → Square chain を確認できない。通常チャットの `openChat()` は Square evidence ではない |
| Album | partial | アルバム一覧/作成/編集/写真操作を行う | frontend → BFF/backend → Album REST (`legy-jp.line-apps.com`, `obs-jp.line-apps.com`) | consumer/BFF/backend chain reviewed | live external Album API 成功未実証 |
| Note | partial | ノート作成/編集/削除/閲覧する | frontend → BFF/backend → Timeline/Note REST `/ext/note/nt/api/v57/...` | consumer/BFF/backend chain reviewed | live external Note API 成功未実証 |
| Calls | partial | 通話開始/終了、音声送受信を行う | `useCall.ts` → `/call/start` → call manager → `/call/ws` → binary PCM → `/call/end` | frontend/BFF/session/WebSocket PCM chain reviewed | 実 LINE call E2E 成功未実証 |
| Backup | partial | VylineBackup を作成/復元/削除する | settings/backend → `backupService.ts` → `data/backups/` | path sanitization/security test PASS | create → restore の完全 roundtrip executable test 未確認 |
| Restore | partial | バックアップ/履歴を復元する | restore services → storage/chat mapping | iOS history → chatdb mapping PASS | Android restore test は deleted protocol stack import で blocked |
| Import | partial | iOS backup 等からデータを取り込む | `packages/ios-backup` → parser/keybag/extract → backend importer | parser/keybag/extract safety tests PASS | 実端末バックアップ全体の E2E import 未実証 |
| Multi Account | partial | 複数アカウントを切替・分離する | auth account routes → client manager/token store → frontend account store | token account isolation + frontend account switching tests PASS | 複数 live LINE session の同時/長時間 E2E 未実証 |
| Subdevice | partial | サブデバイスをペアリングして利用する | subdevice API/store → installation ID/session binding | pairing/session blocking、device binding、LAN URL policy tests PASS | 実別端末との E2E pairing 未実証 |
| Theme | partial | テーマを選択・適用する | settings/store → CSS variables/theme package | implementation reviewed | visual regression/runtime matrix 未実行 |
| Plugin | partial | plugin を有効化・無効化して動かす | plugin runtime → plugin package/hooks | lifecycle activate/deactivate test PASS | third-party plugin compatibility/security matrix 未実証 |
| Diagnostics | verified | 診断ログを記録・閲覧・削除し安全に出力する | settings/BFF/service → diagnostics persistence/redaction | persist/levels/disable/retention + credential/PII/JWT redaction tests PASS | `verified` はローカル診断機能範囲。外部 Issue 投稿は別機能 |
| Update | partial | 更新を検出・案内/適用する | update UI/backend/tooling → version/update flow | implementation/docs reviewed | 配布物を使った end-to-end updater test 未実証 |

## Notes

今回の監査では実グループ・実友だちへの送信テストを行っていない。送信系を live 検証する場合は `AGENTS.md` で許可された「うがうがうー」または「ねずBOT」のみを使う。

また、現在の worktree では `Vyline/packages/protocol/stack/**` にユーザー既存の大量削除がある。これを復元せず監査したため、stack import を必要とする一部 test/typecheck は worktree 制約として未実行/blocked 扱いにしている。
