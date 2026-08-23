# Vyline — AI エージェント向け指示書

最終更新: 2026-08-24

> このドキュメントは AI コーディングエージェント向けに最適化されています。
> 人間は [index.md](./index.md) を読んでください。

## 0. 作業開始プロトコル（毎回実行）

1. `AGENTS.md` を読む（必須ルール・テスト環境・報告プロトコル）
2. Skill Bootstrap を行う:
   - 使用可能 skill: `ponytail` / `caveman` / `agent-skills-standard` /
     `api-and-interface-design` 系 / `minimize-cursor-cost`
   - 大型タスクでは最初の報告に Skill Bootstrap 表を含める
3. 不明点は**作業前にユーザーへ質問してください**。推測での実装進行は禁止。

## 1. リポジトリ構造（機械向けサマリ）

```txt
Vyline/
  apps/desktop/     React + Vite フロントエンド (state: lib/store.ts)
  backend/          Hono BFF (ロジック: service/lineService.ts)
  packages/
    protocol/       → GIT SUBMODULE (= github.com/nezumi0627/vyline-api)
    plugin/         → GIT SUBMODULE (= github.com/nezumi0627/vyline-plugin) — sdk/ + examples/
    themes/         → GIT SUBMODULE (= github.com/nezumi0627/vyline-theme) — VyTheme プリセット
    line-types/     Thrift 型定義（生成物に準拠）
examples/
  plugins/          プラグインサンプル（コピーして使う）
  api/              BFF API サンプルスクリプト
docs/
  developers/       このガイド群
```

## 2. コマンド

| 目的 | コマンド |
|---|---|
| 全体型チェック | `bun run typecheck` |
| Lint | `bun run lint` |
| 単体テスト | `bun test` |
| API smoke test | `bun run test:api`（backend 起動中） |
| 開発サーバ | `bun run dev` |

## 3. 変更種別ごとの手順

### BFF エンドポイント追加
1. `backend/src/service/<name>Service.ts` にロジック（api 層は入出力のみ）
2. `backend/src/api/line.ts` にルート（`handleError` を使用）
3. `backend/src/api/openapi.line.ts` に spec 追加（Redocly valid 維持）
4. 型は `@vyline/line-types` の Thrift Request に合わせる

### プラグイン関連
- SDK・サンプル: **vyline-plugin サブモジュール** (`Vyline/packages/plugin`) 内で変更 → コミット & push → 本 repo でポインタ更新
- ランタイム: `backend/src/line/pluginRuntime.ts`
- レジストリ: `pluginManager.ts`（manifest 検出・状態永続化）
- 権限を増やす場合は SDK の `PluginPermission` と runtime の強制を両方更新

### プロトコル変更
- **vyline-api サブモジュール内でコミット & push** → 本 repo でポインタ更新をコミット
- 新 RPC は `stack/base/service/*/mod.ts` に薄いラッパーとして追加
- 未ラップ RPC は `LINEStruct.<method>_args` 経由の汎用呼び出しも可
  （例: `backend/src/service/extraFeaturesService.ts`）

## 4. 安全規則

- 送信系テストは AGENTS.md 許可のテスト先のみ
- raw MID / token / session をログ・PR・docs に出さない
- `data/` 配下はコミット禁止
- 破壊的操作（メンバー削除・通報等）の API には「実機テスト未実施」コメントを必須化

## 5. 完了定義

- typecheck / lint / test / （API 変更時は test:api）全 pass
- Confirmed と Suspected を分けて報告
- 未検証項目は「未検証」と明記（推測で完了扱いしない）

## 6. 質問してよいこと（むしろ推奨）

以下の場合は実装前にユーザーへ質問:

- 破壊的変更が必要なとき
- テスト送信の要否が不明なとき
- 仕様の解釈が 2 通り以上あるとき
