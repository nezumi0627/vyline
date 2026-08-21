# Vyline ドキュメント索引

最終更新: 2026-08-22

新規参入者は **[onboarding.md](./onboarding.md)** から始めてください。
エージェントは **[../AGENTS.md](../AGENTS.md)** を最初に読んでください。

---

## API / デプロイ / 開発者ガイド

| ドキュメント                                            | 内容                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- |
| [api/openapi.md](./api/openapi.md)                      | OpenAPI / Swagger ルートと仕様の管理方法                 |
| [api/media-batch.md](./api/media-batch.md)              | 複数メディア一括送信 API                                 |
| [deployment/docker.md](./deployment/docker.md)          | Docker / Docker Compose デプロイ                         |
| [developer-guide/plugin-system.md](./developer-guide/plugin-system.md) | プラグインシステム基盤とロードマップ       |
| [developer-guide/multi-account.md](./developer-guide/multi-account.md) | マルチアカウントデータ分離の現状と計画     |

---

## はじめに

| ドキュメント                         | 内容                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| [../AGENTS.md](../AGENTS.md)         | **エージェント向け全体ガイド**（検索ツール・linejs参照・最新修正） |
| [onboarding.md](./onboarding.md)     | 初日チェックリスト（環境・コード地図・Desktop ツール）             |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 機能追加フロー（辞書 → Desktop → domain → BFF）                    |
| [development.md](./development.md)   | 開発コマンド・環境変数                                             |
| [architecture.md](./architecture.md) | 層構造・データフロー                                               |
| [distribution.md](./distribution.md) | Windows exe / アップデーター / リリース手順                        |
| [selfhosting.md](./selfhosting.md)   | Docker セルフホスト・Cloudflare Access・データ永続化               |
| [../CHANGELOG.md](../CHANGELOG.md)   | 変更履歴                                                           |

## 予定（未実装）

| ドキュメント                         | 内容                                          |
| ------------------------------------ | --------------------------------------------- |
| [plugin-api.md](./plugin-api.md)     | プラグイン API（設計メモ・現状非対応）        |
| [tasks/STATUS.md](./tasks/STATUS.md) | 予定機能（プラグイン / オープンチャット）一覧 |

---

## プロトコル・LINE 連携

| ドキュメント                                       | 内容                               |
| -------------------------------------------------- | ---------------------------------- |
| [protocol/dictionary.md](./protocol/dictionary.md) | RPC 辞書・Desktop 検証表・API 早見 |
| [login-flow.md](./login-flow.md)                   | QR / Email E2EE ログインフロー     |
| [analysis/README.md](./analysis/README.md)         | 機能別解析メモ索引                 |
| [analysis/stickers.md](./analysis/stickers.md)     | スタンプ/絵文字 API 解析           |
| [analysis/line-emoji.md](./analysis/line-emoji.md) | LINE 絵文字 (sticon) 解析          |

## 検索・参照ツール

| リソース                                                                                                     | 内容                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [../Vyline/packages/protocol/src/dictionary/rpcMap.ts](../Vyline/packages/protocol/src/dictionary/rpcMap.ts) | **RPC_DICTIONARY** — linejs名→Desktop証拠→実装の対応表        |
| [tools/vyline-search.md](./tools/vyline-search.md)                                                           | **vyline-search ツールキット** — unpack・find-native・delta 概要 |
| [tools/find-native-symbol.md](./tools/find-native-symbol.md)                                                 | Desktop LINE.exe 内 RPC 名検索 (`bun run vyline:find-native`) |
| `@evex/linejs`                                                                                               | **参考元**（外部依存なし）。メソッド名・構造パターンのみ参照  |

---

## タスク・進捗

| ドキュメント                         | 内容                       |
| ------------------------------------ | -------------------------- |
| [tasks/STATUS.md](./tasks/STATUS.md) | マスター進捗ボード         |
| [tasks/PHASES.md](./tasks/PHASES.md) | フェーズ目標・受け入れ条件 |

---

## ツール

| ドキュメント                                                         | 内容                         |
| -------------------------------------------------------------------- | ---------------------------- |
| [tools/find-native-symbol.md](./tools/find-native-symbol.md)         | Desktop 内 RPC 名検索        |
| [tools/desktop-delta.md](./tools/desktop-delta.md)                   | Desktop 更新時の差分調査     |
| [tools/focus-recovered-source.md](./tools/focus-recovered-source.md) | 復元ソースのピンポイント表示 |

---

## パッケージ README

| パス                                                                                       | 内容                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------- |
| [../Vyline/packages/protocol/README.md](../Vyline/packages/protocol/README.md)             | Vyline（identity / E2EE / domain） |
| [../Vyline/packages/protocol/stack/README.md](../Vyline/packages/protocol/stack/README.md) | 内部 RPC stack                     |

---

## 読む順（おすすめ）

```
AGENTS.md → onboarding → architecture → CONTRIBUTING → protocol/dictionary
  → protocol/src/dictionary/rpcMap.ts（検索ツール）
  → 担当機能の docs/analysis/<feature>.md
  → protocol/src/modules.map.ts（機能→ファイル地図）
```
