# Vyline

LINE のサードパーティクライアント。Bun + Hono + React、自前の LINE プロトコルスタック（`@vyline/protocol`、`@evex/linejs` 非依存）を持つ monorepo。

Bun workspaces で管理。`bun install` 一回で全パッケージが入る。

```bash
bun run dev        # backend :3001 + frontend :5173
bun run typecheck
bun run lint
bun test
```

## 安全制約（必読）

- **送信テストは次の 2 箇所のみ。** 実グループ・実友だちには送信しない（過去にテスト送信で問題が起きた）
  - グループ「うがうがうー」: `c1efe9d6cf1848350bc91848a8a29963e`
  - ねずBOT（自己所有の公式アカウント）: `u81c530b68cc2efdd36911d214bd5f084`
  - 受信のみの表示確認（Flex など）は制限なし
- 連絡先への無断メッセージ送信禁止。明示的な指示がない限り LINE 送信ツールを使わない
- `desktop-e2ee-keys.json` / tokens / session / `Vyline/backend/data/` はコミット禁止
- 鍵・トークンの実値を PR・チャット・docs に貼らない

## Git

ブランチを切れば commit / push 可。`main` への直接 push は不可。マージは repo 所有者の承認が必要（Branch Protection 設定済み）。

## パッケージ

| パッケージ | 内容 |
| --- | --- |
| [Vyline/packages/protocol](Vyline/packages/protocol/AGENTS.md) | LINE プロトコルスタック・E2EE・RPC 辞書 |
| [Vyline/backend](Vyline/backend/AGENTS.md) | Hono BFF・ビジネスロジック |
| [Vyline/apps/desktop](Vyline/apps/desktop/AGENTS.md) | React + Vite フロントエンド |

`Vyline/packages/{line-types,loose-types,types}` は型定義のみ（vendored、手編集しない）。

## ドキュメント

- [docs/README.md](docs/README.md) — 全体索引
- [docs/onboarding.md](docs/onboarding.md) — 初日チェックリスト
- [docs/architecture.md](docs/architecture.md) — 層構造・主要ファイル・重要定数・共通パターン
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — 機能追加フロー（辞書 → Desktop → domain → BFF）
- [docs/tools/](docs/tools/) — Desktop 解析ツール
- [docs/RELEASE.md](docs/RELEASE.md) — バージョン・リリース手順
- [docs/tasks/STATUS.md](docs/tasks/STATUS.md) — 進捗ボード（**進捗の唯一の正本**）
