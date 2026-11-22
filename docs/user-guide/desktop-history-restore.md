# Windows LINE Desktop 履歴の取り込み

設定 > 詳細・復元 > **LINE Desktopのトーク履歴を取り込む**から、現在のWindowsユーザーのLINE Desktop履歴をログイン中のVylineアカウントへ追加できます。

## EDBとWAL

LINE Desktopは暗号化したSQLiteデータベース（EDB）を使います。SQLiteのWAL（write-ahead log）は本体DBとは別の一時的な更新ログで、確定済みの変更がまだ本体へcheckpointされていない場合があります。EDBだけを読むと最新の確定済み変更を取りこぼすため、VylineはEDBと隣接するWALの安定した読み取りスナップショットを取得し、コミット済みフレームだけをメモリ上で適用してからSQLiteとして検証します。未コミットのWALフレームは取り込みません。

## 安全性と統合

- Windows上の公式LINE Desktopプロセスが1つ起動している必要があります。別のDesktopクライアントや複数起動は対象にしません。
- 実行前に、設定画面でプロセスメモリ走査と履歴取り込みへの同意が必要です。
- 復号データは一時的にメモリ上だけに保持し、平文DBファイルを作成しません。API応答・診断ログにトーク本文、MID、鍵、ローカルファイル名を含めません。
- 取り込み先アカウントとDesktop DBのアカウントが一致することを確認します。
- 現在のSQLite履歴とメッセージIDで重複排除し、既存メッセージや取消し済み行を上書きしません。ローカルの既読状態、未読数、チャット表示名も復元元の古い値で巻き戻しません。
- 500件以下の短いバッチで挿入するため、中断後は同じDBから再実行できます。

この機能はローカルDesktopに残る範囲の履歴を補完します。LINEサーバー上にある全履歴の取得を保証するものではありません。完了時に表示する件数は新規追加数であり、既存行や不正行の件数は含みません。

## 関連実装

- UI/API: `apps/desktop/src/components/settings-sections.tsx`, `apps/desktop/src/api/client.ts`, `backend/src/api/line.ts`
- 取り込み・マージ: `backend/src/service/desktopMessagesRestore.ts`, `backend/src/service/desktopHistoryRestore.ts`, `backend/src/storage/chatStore.ts`
- EDB/WALスナップショット: `packages/protocol/src/tools/decryptDesktopEdb.ts`
