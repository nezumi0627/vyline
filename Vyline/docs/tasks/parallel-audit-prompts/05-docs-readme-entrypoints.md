# Chat E — Docs再編 / README刷新 / 人間とAIの入口

あなたは Vyline の情報設計担当です。既存 docs を削って作り直すのではなく、内容を読み、重複・古さ・対象読者を判定してから整理してください。

最初に `AGENTS.md`, `docs/README.md`, `docs/DOCS_FORMAT.md`, `docs/templates/`, `README.src.md`, `README.en.src.md` を読む。必要な Skill は `common-documentation`, `japanese-tech-writing`, `documentation-and-adrs`, `ponytail`, `minimize-cursor-cost`。

## 目的

入口を2つに分ける。

### 人間向け入口

プログラマではない人でも以下が迷わない構成にする。

- Vylineとは何か
- 何ができるか / できないか
- 対応環境
- インストール
- 初回起動
- 更新
- バックアップ
- トラブル時の診断ログ
- よくある質問
- 安全上・利用上の注意
- 開発者向け情報への入口

README の既存の個性や「暖かな太陽の〜」のような文章は、Vylineらしさとして残す。企業マニュアルのように冷たくしない。

### AI向け入口

AI agent が最初に巨大 docs 全部を読まなくても作業できる入口を作る。

- architecture map
- source of truth
- feature implementation flow
- RPC_DICTIONARY の使い方
- forbidden / sensitive areas
- test commands
- docs routing
- common gotchas

既存 `AGENTS.md` と重複させすぎない。AI入口は index/router として機能させる。

## Docs再編

全ファイルを inventory し、以下へ分類する。

- user guide
- developer guide
- architecture
- protocol/API
- security/privacy
- operations/distribution
- tools
- analysis/research
- tasks/plans
- reports
- archive candidate

既存リンクを壊さないことを優先し、必要なら段階的 migration と redirect 相当の案内を残す。

## 重複整理

同じ内容が複数docsにある場合、正本を1つ決め、他は短いリンクへ寄せる。歴史的解析メモと現行仕様を混ぜない。

テンプレートは実際に必要な種類だけ整備する。既存 docs 全てをテンプレートへ機械変換しない。

## README

README変更は `README.src.md` と `README.en.src.md` の両方へ情報量を揃えて反映し、生成コマンドで `README.md` / `README.en.md` を更新する。

READMEは特に installation を短く分かりやすくする。開発者向け clone/setup と一般利用者向け install を混ぜない。

## 成果物

- docs inventory / ownership map
- 新しい docs index
- 必要な folder 整理
- template 整備
- 人間向け README
- AI向け入口
- 重複統合一覧
- broken link check

## 完了条件

初見ユーザーが README から導入でき、開発者/AIは数クリックで必要な正本へ到達できる。日本語と英語の README の主要情報が一致し、docs 内リンク切れがない。
