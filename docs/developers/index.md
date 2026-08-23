# Vyline 開発者ガイド（読む順序）

最終更新: 2026-08-24

このページは**人間の開発者向けの入口**です。AI エージェント向けは
[for-ai.md](./for-ai.md) を参照してください。

---

## Step 0: セットアップ（15分）

1. [../onboarding.md](../onboarding.md) — 環境構築チェックリスト
2. `git clone` 後、**サブモジュールを必ず取得**:

```bash
git submodule update --init --recursive
```

- `Vyline/packages/protocol` → [vyline-api](https://github.com/nezumi0627/vyline-api)（LINE プロトコルスタック）
- `Vyline/packages/plugin` → [vyline-plugin](https://github.com/nezumi0627/vyline-plugin)（plugin-sdk + examples）
- `Vyline/packages/themes` → [vyline-theme](https://github.com/nezumi0627/vyline-theme)（VyTheme プリセット）
- `tools/` → vyline-search ツールキット

3. `bun install && bun run dev` で backend :3001 / frontend :5173

## Step 1: アーキテクチャを知る（30分）

読む順序:

1. [../architecture.md](../architecture.md) — 層構造とデータフロー
2. [../CONTRIBUTING.md](../CONTRIBUTING.md) — 機能追加のフロー（辞書→Desktop→domain→BFF）
3. コード正本ファイル:
   - `Vyline/backend/src/service/lineService.ts`（ビジネスロジック）
   - `Vyline/apps/desktop/src/lib/store.ts`（フロント state）

## Step 2: API を使ってみる（20分）

1. Swagger UI を開く: <http://127.0.0.1:3001/docs>
2. [../api/openapi.md](../api/openapi.md) — 仕様の管理方法
3. サンプルを実行:

```bash
bun examples/api/basic-operations.ts
bun run test:api   # 全エンドポイント smoke test
```

## Step 3: プラグインを作る（30分）

1. [plugin-system.md](./plugin-system.md) — ユーザーガイド
2. `examples/plugins/message-logger` をコピーして書き換える
3. 有効化: `POST /line/{accountId}/plugins/<id>/enable`

## Step 4: プロトコルに触れる（必要になったら）

- [../protocol/dictionary.md](../protocol/dictionary.md) — RPC 辞書
- プロトコルスタック本体は **vyline-api サブモジュール** (`Vyline/packages/protocol`)
  で開発する。変更はサブモジュール側でコミット & push し、本 repo でポインタを更新。

## Step 5: 品質ゲート

PR 前に必ず:

```bash
bun run typecheck
bun run lint
bun test
bun run test:api   # backend 起動中
```

## よくある質問

**Q: テスト送信はどこでできる?**
A. AGENTS.md の「テスト環境」参照。許可されたテスト先のみ。

**Q: プラグインが動かない**
A. `loadable: true` になっているか GET plugins で確認。activate 失敗は backend ログ
(`plugin:<id>` サブシステム) を見る。

**Q: AI エージェントに作業させたい**
A. [for-ai.md](./for-ai.md) をエージェントに読ませてください。skill の確認手順も含まれます。
