# Vyline Message Engine vNext 実装計画

**Goal:** 既存のLINE形式とSQLite履歴を維持しながら、受信・履歴・既読・検索・UIの信頼性と性能を段階的に改善する。
**Architecture:** additive migrationと互換経路を使う。最初にOperation batch処理の失敗がcursorへ反映されないことをテストし、その後に履歴・DB・既読・UIを独立した検証単位で実装する。未確認のLINE意味論は前提にしない。
**Tech Stack:** Bun, TypeScript, Hono, SQLite, React, Zustand, IndexedDB.
**Spec:** docs/design/message-engine-audit.md

## Global Constraints
- 既存Git差分はユーザー作業として保持し、該当差分を読み合わせてから編集。
- SQLite変更は追加的かつrollback可能にする。実ユーザーDBで破壊テストしない。
- LINE protocolやOperation semanticsを推測で変更しない。
- 計測値は実測した値だけ報告する。

## Review Focus
- Operation途中失敗後のcursor進行 — fail-fast/batch retry test。
- message保存後・UI通知前のクラッシュ — duplicate-safe recovery fixture。
- ローカル履歴枯渇 — remote page/fallback test。
- read rangeの非連続・count-only — v4 shadow comparison。
- account切替中の遅延応答 — generation guard test。

## Tasks
1. Operation処理をfail-fastにし、イベントを永続化後に発行。成功したbatch後にのみcheckpointを更新。失敗Operationは次回syncで再試行可能な状態にする。既存schemaを使える範囲を先に検証し、全revision tupleのdurabilityが必要なら追加schemaを別テストで実装。
2. older pagingでSQLite pageを返し、ローカル枯渇時だけLINE previous RPCへfallback。終端/失敗/未取得を区別し、cursor境界を検証。
3. canonical mergeのsource/field規則を定義し、無変更child rowの再書込をskip。transactionと既存バックアップ互換を維持。
4. Read Engine v4をshadow比較し、readers/rangesの更新行だけを書き換える。LINE range連続性は仮定しない。
5. UI更新をchat/message単位に局所化し、仮想index計算・検索・スクロールアンカーを大量fixtureで比較。
6. 送信結果不明、メディア負荷、SQLite検索/FTS導入可否を既存API/プロトコル制約内で改善。
7. 各段階の型check、関連テスト、offline benchmarkを行い、未達/未計測事項を記録。

## 初回実行
- 対象: backend/src/line/clientManager.ts, backend/src/service/lineService.ts と新規のoperation batch test/helper。
- 先に失敗テストで、handler失敗時にcommit callbackが呼ばれないこと、処理順が維持されることを検証。
- 次に最小変更。対象ファイルの既存差分を保持。

