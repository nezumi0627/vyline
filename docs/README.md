# Vyline ドキュメント索引

最終更新: 2026-08-30

一般ユーザーは **[start-here.md](./start-here.md)**、人間の開発者は **[developers/index.md](./developers/index.md)** から始めてください。
エージェントは **[../AGENTS.md](../AGENTS.md)** を最初に読み、その後 **[developers/for-ai.md](./developers/for-ai.md)** を router として使ってください。

文書の正本と各フォルダの役割は **[DOCS_OWNERSHIP.md](./DOCS_OWNERSHIP.md)** にまとめています。

### ベータ機能

Desktop の設定には、全体の利用規約同意とは別に機能単位の追加同意を求める「ベータ機能」タブがあります。
同意ログとベータ機能の処理結果は端末内で扱い、メッセージ本文や確認結果を Vyline の外部サービスへ送信しません。
LINE との通常の通信は発生します。これは法的助言ではありません。

ドキュメントの形式・更新日・廃止判断は **[DOCS_FORMAT.md](./DOCS_FORMAT.md)** に統一しています。
新規ドキュメントや大きめの改修では **[templates/](./templates/)** の薄いテンプレートを使ってください。

---

## API / デプロイ / 開発者ガイド

| ドキュメント                                            | 内容                                                     |
| ------------------------------------------------------- | -------------------------------------------------------- |
| [api/openapi.md](./api/openapi.md)                      | OpenAPI / Swagger ルートと仕様の管理方法                 |
| [api/media-batch.md](./api/media-batch.md)              | 複数メディア一括送信 API                                 |
| [deployment/docker.md](./deployment/docker.md)          | Docker / Docker Compose デプロイ                         |
| [developers/index.md](./developers/index.md)                             | 開発者ガイド（読む順序・人間向け入口）     |
| [developers/for-ai.md](./developers/for-ai.md)                           | AI エージェント向け指示書                 |
| [developers/plugin-system.md](./developers/plugin-system.md)              | プラグインシステム（ユーザーガイド）       |
| [user-guide/update.md](./user-guide/update.md)                            | アップデート方法                          |
| [user-guide/custom-client.md](./user-guide/custom-client.md)              | カスタムクライアントの作り方               |
| [user-guide/themes.md](./user-guide/themes.md)                            | テーマの作り方                            |
| [developer-guide/multi-account.md](./developer-guide/multi-account.md) | マルチアカウントデータ分離の現状と計画     |
| [setup-account-handoff-debug.md](./setup-account-handoff-debug.md) | Vyline Setup、設定引継ぎ、診断ログの仕様 |

---

## はじめに

| ドキュメント                         | 内容                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| [start-here.md](./start-here.md)     | **一般ユーザー向け入口**（Install / Update / Backup / Diagnostics） |
| [../AGENTS.md](../AGENTS.md)         | **エージェント向け全体ガイド**（検索ツール・linejs参照・最新修正） |
| [DOCS_OWNERSHIP.md](./DOCS_OWNERSHIP.md) | 文書分類・ownership・source-of-truth map                         |
| [onboarding.md](./onboarding.md)     | 初日チェックリスト（環境・コード地図・Desktop ツール）             |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 機能追加フロー（辞書 → Desktop → domain → BFF）                    |
| [development.md](./development.md)   | 開発コマンド・環境変数                                             |
| [development-worktrees.md](./development-worktrees.md) | **推奨: 1 task = 1 branch = 1 git worktree** の並行開発フロー |
| [performance.md](./performance.md)   | 起動時間・CPU・メモリ計測と Bun/Vite 最適化                       |
| [architecture.md](./architecture.md) | 層構造・データフロー                                               |
| [distribution.md](./distribution.md) | Windows exe / アップデーター / リリース手順                        |
| [selfhosting.md](./selfhosting.md)   | Docker セルフホスト・Cloudflare Access・データ永続化               |
| [security/threat-model.md](./security/threat-model.md) | 信頼境界・攻撃面・セキュリティ設計                         |
| [security/findings-2026-08-31.md](./security/findings-2026-08-31.md) | 2026-08-31 Security / CVE / Threat 監査結果        |
| [templates/](./templates/)           | 新規ドキュメント作成用の薄いテンプレート                           |
| [../CHANGELOG.md](../CHANGELOG.md)   | 変更履歴                                                           |

## 次の大きな機能

| ドキュメント                         | 内容                                          |
| ------------------------------------ | --------------------------------------------- |
| [plugin-api.md](./plugin-api.md)     | ローカルプラグイン API（Beta、権限とサンプル） |
| [tasks/STATUS.md](./tasks/STATUS.md) | Phase とオープンチャット統合の進捗 |

---

## プロトコル・LINE 連携

| ドキュメント                                       | 内容                               |
| -------------------------------------------------- | ---------------------------------- |
| [protocol/dictionary.md](./protocol/dictionary.md) | RPC 辞書・Desktop 検証表・API 早見 |
| [login-flow.md](./login-flow.md)                   | QR / Email E2EE ログインフロー     |
| [analysis/README.md](./analysis/README.md)         | 機能別解析メモ索引                 |
| [analysis/liff.md](./analysis/liff.md)             | LIFF token / share / sender helper |
| [analysis/note-album.md](./analysis/note-album.md) | Note/Album ChannelToken・CRUD・OBS  |
| [analysis/stickers.md](./analysis/stickers.md)     | スタンプ/絵文字 API 解析           |
| [analysis/line-emoji.md](./analysis/line-emoji.md) | LINE 絵文字 (sticon) 解析          |
| [analysis/stability-read-revoke-multi-account.md](./analysis/stability-read-revoke-multi-account.md) | 取消・既読者・複数アカウント・MID検索の安定化 |

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

---

## パッケージ README

| パス                                                                                       | 内容                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------- |
| [../Vyline/packages/protocol/README.md](../Vyline/packages/protocol/README.md)             | Vyline（identity / E2EE / domain） |

---

## 読む順（おすすめ）

```
AGENTS.md → onboarding → architecture → CONTRIBUTING → protocol/dictionary
  → protocol/src/dictionary/rpcMap.ts（検索ツール）
  → 担当機能の docs/analysis/<feature>.md
  → protocol/src/modules.map.ts（機能→ファイル地図）
```
