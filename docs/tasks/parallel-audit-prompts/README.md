# Vyline 並走改善計画 — AI エージェント用進行書

このディレクトリは、Vyline 全体改善を複数の AI チャットで安全に並走させるための進行書です。

## 目的

「実装できたつもり」を避け、実コード・型・API・テスト・外部仕様の根拠から Vyline を整理する。

優先順位は以下です。

1. セキュリティ・プライバシー・データ保護
2. 既存機能互換
3. 実リポジトリ挙動とテスト結果
4. 重複削除・再利用・単純化
5. UI/UX とドキュメント品質
6. 新機能や見た目の追加

## 並走チャット

| Chat | 担当 | 主な対象 |
| --- | --- | --- |
| A | UI System / UX | UI棚卸し、コンポーネント化、animation、UI集 |
| B | Security | 脆弱性、CVE、認証、LAN、依存関係、秘密情報 |
| C | Refactor / Duplication | 全体最適化、重複統合、コード品質 |
| D | Evidence / API / Feature Docs | 「できた」を疑う、LINE API整合、機能別根拠docs |
| E | Docs / README / AI入口 | docs再編、テンプレート、README、人間/AI入口 |
| F | Diagnostics / Website | ログ・Issue報告UX、Vyline公式ページ |

## 共通ルール

各チャットは最初に `AGENTS.md` を読み、必要な Skill だけ使う。大規模作業では `ponytail`、`minimize-cursor-cost`、必要に応じて `caveman` を使う。

実装前に必ず調査と計画を作る。推測で変更しない。既存 helper / component / type / API がある場合は再利用を優先する。

LINE 関連の機能・APIは、名前が似ていることを根拠に実装済み扱いしない。`packages/protocol/src/dictionary/rpcMap.ts`、Thrift型、Desktop evidence、domain、backend、frontend の実経路を追う。

ユーザーの未コミット変更を壊さない。担当外の大規模整形・rename・移動は禁止。共有ファイルを触る必要が出た場合は、まず成果をレポート/提案ファイルへ出し、統合担当が後で反映できる形にする。

## 衝突回避

- A は主に `apps/desktop/src/components/`, `apps/desktop/src/index.css`, UI docs を担当。
- B は security report と安全修正を担当。UIの見た目変更はしない。
- C は広くコードを触れるが、A/B/D が同時に担当している領域の意味変更は避ける。
- D は API・型・プロトコル・機能根拠を正本として扱う。大規模UI変更はしない。
- E は docs 構造・README source を担当。コード変更は docs と整合させる最小限のみ。
- F は diagnostics/logging と Web page に限定する。

共有ファイル `package.json`, `README.src.md`, `README.en.src.md`, `CHANGELOG.md`, `docs/README.md` は競合しやすい。担当外チャットは直接変更せず、必要な変更案を自分のレポートへ記録する。

## 完了条件

各チャットは最後に以下を残す。

- 調査結果
- 実施した変更
- 根拠
- 実行した検証
- 未確認事項
- 他チャットへ渡す事項

「完了」「対応済み」は、根拠と検証が揃った項目だけに使う。
