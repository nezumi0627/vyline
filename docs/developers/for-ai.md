# Vyline — AI Entry / Docs Router

最終更新: 2026-08-31

> このページは巨大な docs 全体を毎回読む代わりに、作業種別ごとの正本へ案内する router です。
> 必須ルールそのものは [AGENTS.md](../../AGENTS.md) が正本です。人間は [index.md](./index.md) を読んでください。

## 0. 作業開始プロトコル（毎回実行）

1. `AGENTS.md` を読む（必須ルール・テスト環境・報告プロトコル）
2. Skill Bootstrap を行う:
   - 使用可能 skill: `ponytail` / `caveman` / `agent-skills-standard` /
     `api-and-interface-design` 系 / `minimize-cursor-cost`
   - 大型タスクでは最初の報告に Skill Bootstrap 表を含める
3. [DOCS_OWNERSHIP.md](../DOCS_OWNERSHIP.md) で対象領域の source of truth を決める。

## 1. 作業種別ルーター

| 目的 | 最初に読むもの |
| --- | --- |
| UI / state / sync | `architecture.md` → `apps/desktop/src/lib/store.ts` → 対象 component/hook |
| Backend / BFF | `architecture.md` → `CONTRIBUTING.md` → `backend/src/service/lineService.ts` → `backend/src/api/line.ts` |
| API | `api/openapi.md` → `openapi.yaml` → BFF route → service |
| LINE RPC | `protocol/dictionary.md` → `api-rpc-mapping.md` → `packages/protocol/src/dictionary/rpcMap.ts` |
| Security | `security/threat-model.md` → 最新 findings → 対象コード / regression test |
| Performance | `performance.md` → 実測対象コード / benchmark |
| Docs / README | `DOCS_FORMAT.md` → `DOCS_OWNERSHIP.md`; README は `.src.md` だけ編集 |
| 機能の完成度 | `feature-capabilities.md`。live E2E 未実証を `verified` と呼ばない |

## 2. Sensitive areas

- `backend/src/line/clientManager.ts`, token/session storage: credential lifecycle と account isolation。
- `backend/src/api/public.ts`, `apiTokenStore.ts`: authorization / account scope。
- media / backup / import: SSRF、path traversal、archive bomb、秘密情報の混入。
- diagnostics / logs: token、session、key、secret、full MID、private message body を共有データへ出さない。
- `packages/protocol/`: submodule。ユーザー既存の変更を勝手に reset / restore しない。

## 3. Tests / completion evidence

- UI: typecheck に加え、可能なら実ブラウザで desktop/mobile を確認。
- Security: 修正コード + regression test。
- API/RPC: consumer → BFF → service/domain → RPC の chain を確認。
- Docs: source-of-truth consistency + README generation + link validation。
- 外部 LINE runtime が必要な機能は、許可された live test がない限り `partial` / `unverified` のまま扱う。

## 4. Common gotchas

- README の正本は `README.src.md` / `README.en.src.md`。生成物へ直接修正しない。
- `process.env.X = undefined` は Bun/Node で文字列化され得る。環境変数を消す意図なら `delete process.env.X`。
- `analysis/` と `tasks/` は歴史・計画。現在の product capability を断言する正本ではない。
- protocol stack が欠けている worktree では backend typecheck が cascade failure するため、個別の `any` 追加で隠さない。

## 5. リポジトリ構造（機械向けサマリ）

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

## 6. コマンド

| 目的 | コマンド |
|---|---|
| 全体型チェック | `bun run typecheck` |
| Lint | `bun run lint` |
| 単体テスト | `bun test` |
| API smoke test | `bun run test:api`（backend 起動中） |
| 開発サーバ | `bun run dev` |

## 7. 変更種別ごとの手順

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

## 8. 安全規則

- 送信系テストは AGENTS.md 許可のテスト先のみ
- raw MID / token / session をログ・PR・docs に出さない
- `data/` 配下はコミット禁止
- 破壊的操作（メンバー削除・通報等）の API には「実機テスト未実施」コメントを必須化

## 9. 完了定義

- typecheck / lint / test / （API 変更時は test:api）全 pass
- Confirmed と Suspected を分けて報告
- 未検証項目は「未検証」と明記（推測で完了扱いしない）

## 10. 立ち止まるべきケース

以下の場合は実装前にユーザーへ質問:

- 破壊的変更が必要なとき
- テスト送信の要否が不明なとき
- 仕様の解釈が 2 通り以上あるとき
