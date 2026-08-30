# Documentation Ownership / Source of Truth

最終更新: 2026-08-31

Vyline の文書は「現在仕様」「調査記録」「作業計画」を混ぜない。重複した説明がある場合は、下表の正本を更新し、他の文書は必要最小限の要約とリンクに留める。

## 正本マップ

| 領域 | 正本 | 補足 |
| --- | --- | --- |
| ユーザー向け入口 | `README.src.md` / `README.en.src.md`, `docs/start-here.md` | README 生成物は直接編集しない |
| 機能の検証状態 | `docs/feature-capabilities.md` | `verified / partial / unverified / unsupported` の定義もここ |
| アーキテクチャ | `docs/architecture.md` | 実コードと食い違う場合はコードを再確認して更新 |
| 開発手順 | `docs/developers/index.md`, `docs/development.md`, `docs/CONTRIBUTING.md` | 人間向け |
| AI 作業ルーティング | `AGENTS.md`, `docs/developers/for-ai.md` | `AGENTS.md` が必須ルール、`for-ai.md` は短い router |
| API 仕様 | `openapi.yaml`, `docs/api/openapi.md` | BFF 実装との整合を必ず確認 |
| LINE RPC 対応 | `Vyline/packages/protocol/src/dictionary/rpcMap.ts`, `docs/protocol/dictionary.md`, `docs/api-rpc-mapping.md` | RPC 名・path・consumer chain の根拠 |
| Security | `docs/security/threat-model.md`, `docs/security/findings-2026-08-31.md` | 個別の過去調査は analysis へ |
| Performance | `docs/performance.md` | ベンチマーク条件と結果を併記 |
| 配布 / 更新 | `docs/distribution.md`, `docs/user-guide/update.md` | 配布者向けと利用者向けを分離 |
| Self-host | `docs/selfhosting.md`, `docs/deployment/docker.md` | 運用と Docker 手順 |
| 調査履歴 | `docs/analysis/` | 現在仕様の正本にはしない |
| 進捗 / 計画 | `docs/tasks/STATUS.md`, `docs/tasks/PHASES.md`, `docs/tasks/` | 実装済み断言の根拠にはしない |
| セッション記録 | `docs/sessions/`, `docs/reports/` | 歴史記録。現在仕様と区別する |
| 新規文書の形式 | `docs/DOCS_FORMAT.md`, `docs/templates/` | 既存文書の機械的な全面変換はしない |

## フォルダの役割

- `user-guide/`: 一般利用者の具体的な操作。
- `developers/`, `developer-guide/`: 開発者向け導線と実装ガイド。
- `api/`, `protocol/`: 公開 API と LINE protocol/RPC。
- `security/`: 現在の threat model と監査結果。
- `deployment/`: 配備手順。
- `tools/`: 解析・開発ツール。
- `analysis/`: 調査過程と証拠。現在仕様と混同しない。
- `tasks/`: 未完了事項・受け入れ条件。
- `reports/`, `sessions/`: 時点付きの履歴。
- `templates/`: 新規文書・大改修だけに使う薄い雛形。

## 更新時のルール

1. まず該当領域の正本を確認する。
2. 実装状態を説明する場合は `feature-capabilities.md` の Evidence と整合させる。
3. README は日英 source を同時に編集して `bun run docs:readme` で生成する。
4. 歴史的な analysis を現在仕様へ昇格させる場合は、実コードまたは実行結果で再確認する。
5. 文書を移動・削除するより、既存リンクを保ったまま索引と正本を明確にすることを優先する。
