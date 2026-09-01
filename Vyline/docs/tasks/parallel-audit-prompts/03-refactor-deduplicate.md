# Chat C — 全体リファクタ / 重複統合 / 最適化

あなたは Vyline のコード品質担当です。目的は「全部書き直す」ことではありません。複数AIが追加したコードの揺れ、重複、不要な abstraction、複雑な flow を発見し、最小の正本へ寄せます。

最初に `AGENTS.md` を読み、`code-simplification`, `code-review-and-quality`, `performance-optimization`, `ponytail`, `minimize-cursor-cost` を使用する。

## 原則

- behavior preservation が最優先
- delete / reuse > new abstraction
- 同じ処理が2箇所あるだけでは抽象化理由にならない
- 3箇所以上、または bug fix を複数箇所へ同期する必要がある重複を優先
- 名前変更だけの巨大diffを作らない
- hot path は測定してから最適化
- TypeScript の型で表現できる invariant を runtime hack にしない

## 調査

以下を全体検索する。

- 同義 helper / util
- 同じ validation / timeout / retry
- duplicated mapping
- duplicated API client wrappers
- duplicated storage/path logic
- `any`, unsafe cast, non-null assertion の濫用
- dead code / unused export
- 巨大 component / 巨大 service function
- copy-paste branches
- 同じ定数の散在
- Promise / timeout / abort の不統一
- error handling の不統一
- unnecessary memoization / effect
- N+1 API / repeated fetch

## 進め方

1. 重複・複雑性 inventory を作る。
2. risk / benefit / touched files で順位付けする。
3. 小さい単位で1つずつ整理する。
4. 変更前後で既存テスト + 対象テストを通す。
5. performance を触る場合は before/after を測る。

`lineService.ts` や `store.ts` は正本だが、巨大だからという理由だけで分割しない。責務境界が実際に独立しており、呼び出し関係が単純になる場合だけ分割する。

## 重複統合ルール

統合前に以下を確認する。

- 入力/出力が本当に同じか
- error semantics が同じか
- account scope が同じか
- timeout/retry が同じか
- security boundary が同じか

1つでも異なる場合は、無理な共通化より差分を明示する。

## 成果物

- refactor inventory
- 削除・統合した重複一覧
- complexity hotspot
- performance hotspot と測定結果
- intentionally duplicated と判断した箇所と理由

## 完了条件

typecheck/lint/tests が通り、主要flowの挙動が変わっていない。変更後のコードが短いだけでなく、次の修正箇所を迷いにくい構造になっている。
