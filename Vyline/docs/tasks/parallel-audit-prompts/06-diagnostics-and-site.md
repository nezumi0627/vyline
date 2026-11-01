# Chat F — Diagnostics / Issue UX / Vyline Web Page

あなたは2つの独立した成果物を担当します。先に diagnostics を完成・検証し、その後 Vyline の公開ページを設計してください。両者のコードや責務は混ぜない。

最初に `AGENTS.md` と diagnostics/logging 関連コード、既存サイト構成を調査する。必要な Skill は `observability-and-instrumentation`, `frontend-ui-engineering`, `design`, `common-web-visual-testing`, `ponytail`, `minimize-cursor-cost`。

# Part A — Debug Log / Issue Reporting UX

現状の UI:

- デバッグログ
- 共有前にサニタイズされた診断情報だけを出力
- ログをエクスポート
- GitHub Issue 作成画面へ貼り付けられる JSON
- ログ一覧 / 確認
- GitHubで問題を報告 / Issue作成
- ログ削除

しかしログが記録されていないケースがある。原因を追跡し、起動時から diagnostics logging を開始できるようにする。

## 要件

- 起動時に logging を開始できる
- UIから ON/OFF を変更できる
- 設定は適切に永続化する
- OFF 時に不要なログを書かない
- 起動直後の失敗も拾える範囲を明確化する
- secret/token/password/key/full MID/private message body 等を共有用ログへ出さない
- raw internal log と shareable diagnostic を区別する
- sanitizer を最終段だけでなく、危険データが永続化される箇所も確認する
- log rotation / size limit / retention を確認する
- account isolation を確認する

## 非プログラマ向け Issue UX

ユーザーに JSON の意味を理解させない。

Issue 作成時に可能なら以下を自動生成する。

- Vyline version
- OS / runtime の安全な範囲の情報
- 発生日時
- 有効な関連設定
- sanitized recent diagnostics
- reproduction input fields
- expected / actual

「自動添付」と書く場合、本当にどの情報が GitHub へ渡るかを送信前に確認できる画面を用意する。

GitHub URL に巨大 JSON を query で詰め込む設計は長さ制限も検証する。必要なら copy/export を fallback にする。

## Diagnostics 完了条件

clean start からログが記録され、ON/OFF、再起動後設定、sanitization、削除、export、Issue導線をテストできる。秘密情報が fixture を使ったテストで漏れないことを確認する。

# Part B — Vyline Page

Vyline のための高品質な公開ページを作る。テンプレートをAIに埋めさせたようなサイトは禁止。

参考:

- https://x.com/alextalksai/status/2093583622691283018?s=20
- https://beautifului.dev/
- https://beui.dev/
- https://rareui.com/
- https://transitions.dev/
- https://ui.shadcn.com/
- https://ui-skills.com/
- https://coss.com/ui
- https://designsystemchecklist.com/
- https://reui.io/components

必要なら X / design community の現在の Web design trend も調査する。ただし流行をそのまま全部盛りしない。

## Design direction

- 堅苦しくない
- ワクワクする
- モダンだが数か月で古く見える gimmick に依存しない
- Vyline 本体の UI と同じ design language
- 過剰な AI gradient / glow / floating blob を避ける
- 実際のプロダクト画面・機能を主役にする
- mobile first
- fast loading
- accessible

## ページ構成候補

- Hero: Vyline が何かを一文で理解できる
- product preview
- 主要機能
- privacy / local-first 相当の実態に沿った説明
- install/download CTA
- update / status
- GitHub / docs
- community / support
- FAQ

存在しない機能や安全性をマーケティング文句として断言しない。Chat D の evidence docs と整合させる。

## 実装前に

3案程度の visual direction をラフで比較し、既存ブランドと最も合う1案を選ぶ。画面を実ブラウザで desktop/mobile 確認する。

## Site 完了条件

Lighthouse/実ブラウザ確認を行い、mobile/desktop で破綻せず、主要CTAが分かり、Vylineの実機能と記述が一致する。不要な大容量依存や装飾animationを追加しない。
