# nezu-md Specification

> **Version**: 1.0.0  
> **Status**: Stable  
> **Language**: Japanese / English (examples)  
> **Scope**: Markdown documents for OSS, products, and AI-assisted workflows

---

## Purpose

**nezu-md** は、Markdown の「見た目の好み」を個人に委ねないためのデザイン規格である。

誰が書いても、一定以上の品質・可読性・保守性・美しさを満たすドキュメントを作れるようにする。

| Goal | Description |
| --- | --- |
| Human Readable | 初見でも構造が掴める |
| GitHub Beautiful | GitHub 上で製品サイトのように見える |
| AI Friendly | エージェントと IDE が解析しやすい |
| Maintainable | 長期運用でも崩れにくい |
| Portable | OSS / 商用のどちらでも使える |

---

## Non-Goals

nezu-md は次を目指さない。

| Non-Goal | Reason |
| --- | --- |
| 独自 Markdown 方言の発明 | 互換性を壊すため |
| 装飾の最大化 | 意味のない装飾を禁止するため |
| すべての文書を同一レイアウトに強制 | 文書種別ごとに最適な骨格があるため |
| スタイルガイドの代替 | 文体規範は別レイヤで扱えるため |

---

## Design Principles

### 1. Visual First

最初に見た瞬間に内容が伝わる構造にする。文章の壁を作らない。

積極的に使うもの:

- テーブル
- カード相当の見出しブロック
- ステータス表示
- バッジ
- 区切り線
- リスト
- ダイアグラム（Mermaid 推奨）
- アイコン（絵文字は最小限、意味がある場合のみ）
- スクリーンショット領域

### 2. Information Hierarchy

情報は次の優先順位で配置する。

| Order | Question | Typical Section |
| ---: | --- | --- |
| 1 | 何なのか | Hero / Summary |
| 2 | なぜ存在するのか | Why / Problem |
| 3 | 何ができるのか | Features |
| 4 | どう使うのか | Quick Start / Installation |
| 5 | どう構成されているのか | Architecture / Structure |
| 6 | 今後どうなるのか | Roadmap |

### 3. Professional Quality

大規模 OSS レベルの品質を目標とする。

禁止事項:

- 内容の薄い見出し
- 説明不足
- 一行だけのセクション
- 意味のない装飾
- 曖昧な表現
- 読みにくい長文の壁

### 4. AI Friendly

AI エージェントや IDE が解析しやすい構造にする。

可能な限り次を明示する。

| Field | Meaning |
| --- | --- |
| Purpose | 何のための文書 / プロジェクトか |
| Features | 何ができるか |
| Architecture | どう組み立てられているか |
| Components | 構成要素は何か |
| Dependencies | 何に依存するか |
| Workflow | どう動くか / どう使うか |
| Status | 現在の状態 |
| Roadmap | 今後どうなるか |

### 5. Product Experience

ドキュメントは単なる読み物ではなく、アプリや製品サイトのような体験を提供する。

参考にする体験:

- Modern SaaS Landing Page
- Apple Documentation
- Stripe Documentation
- Vercel Documentation
- GitHub Premium OSS Projects

---

## Document Types

| Type | Use When | Required Skeleton |
| --- | --- | --- |
| README | リポジトリの入口 | Hero → Summary → Features → Quick Start → Architecture → FAQ → License |
| SPEC | 規格・仕様の定義 | Purpose → Scope → Rules → Examples → Compatibility |
| FEATURE | 機能説明 | Overview → Behavior → API / Usage → Edge Cases |
| GUIDE | 手順書 | Goal → Prerequisites → Steps → Verification |
| ADR | 意思決定記録 | Context → Decision → Consequences |

---

## Layout Requirements

README 系ドキュメントは、可能な限り次を含む。

| Section | Required | Notes |
| --- | :---: | --- |
| Hero Section | Yes | 名前、一文要約、バッジ、主要 CTA |
| Summary | Yes | 何かを 3〜6 行で把握できる |
| Key Features | Yes | 表または短いブロックで |
| Screenshots Section | Recommended | 画像が無い場合はプレースホルダを置く |
| Quick Start | Yes | 最短経路を示す |
| Installation | Recommended | Quick Start と分離してよい |
| Configuration | Optional | 設定がある場合は必須 |
| Architecture | Recommended | 図または表で示す |
| Directory Structure | Recommended | ツリーで示す |
| Workflow | Optional | 手順や状態遷移がある場合 |
| FAQ | Recommended | 誤解しやすい点を先回りする |
| Roadmap | Recommended | 現状と将来を分ける |
| Contributing | Recommended | OSS の場合は推奨 |
| License | Yes | ライセンス名とリンク |

必要に応じてセクションを追加してよい。順序の原則（Information Hierarchy）は崩さない。

---

## Formatting Rules

### Headings

- `H1` は文書に 1 つ
- `H2` で主要セクションを分ける
- `H3` 以下は必要最小限
- 見出しだけで内容が推測できる文言にする

### Tables

- 比較、対応表、ステータス、チェック項目は表を優先する
- 列名は具体的にする（`Item` / `Value` のような曖昧列を避ける）

### Code Blocks

- 言語指定を必須とする
- コマンド例はコピーして動く最小形にする
- 長い出力は要点だけ示す

### Lists

- 手順は番号付きリスト
- 並列な事実は箇条書き
- 1 項目が 2 文を超えるなら表や小見出しへ移す

### Diagrams

- 構造・流れ・状態遷移は Mermaid を推奨する
- 図だけで完結させず、直前または直後に一文で意図を書く

### Tone

- 断定できることは断定する
- 「など」「いろいろ」で逃げない
- 未確定は Status / Roadmap に隔離する

---

## Compliance Levels

| Level | Name | Criteria |
| --- | --- | --- |
| L0 | Draft | 骨子のみ。公開非推奨 |
| L1 | Structured | Hierarchy と主要セクションがある |
| L2 | Visual | 表・図・バッジ等で Visual First を満たす |
| L3 | Product | 製品サイト相当の完成度。公開推奨 |
| L4 | Reference | 仕様・例・チェックリストまで揃う |

本リポジトリの README は **L3** 以上を目標とする。

---

## Validation Checklist

公開前に次を確認する。

- [ ] Hero だけで「何のプロジェクトか」が分かる
- [ ] Summary だけで「誰のための何の価値か」が分かる
- [ ] Features が具体的で検証可能である
- [ ] Quick Start が最短経路になっている
- [ ] Architecture / Structure が存在する（該当する場合）
- [ ] FAQ が想定質問に答えている
- [ ] 曖昧語（いろいろ、適切に、など）が残っていない
- [ ] 一行だけの空洞セクションが無い
- [ ] コードブロックに言語指定がある
- [ ] License が明示されている

詳細は [`docs/CHECKLIST.md`](./CHECKLIST.md) を参照する。

---

## Compatibility

| Environment | Support |
| --- | --- |
| GitHub Flavored Markdown | Primary target |
| GitHub README preview | Required |
| CommonMark | Baseline |
| Other Markdown renderers | Best effort |

GitHub で崩れる記法は採用しない。

---

## Versioning

| Part | Rule |
| --- | --- |
| MAJOR | 互換を破るルール変更 |
| MINOR | セクション追加、推奨事項の追加 |
| PATCH | 文言修正、例の追加、誤記修正 |

---

## Related Documents

| Document | Role |
| --- | --- |
| [`docs/PRINCIPLES.md`](./PRINCIPLES.md) | 設計原則の解説 |
| [`docs/CHECKLIST.md`](./CHECKLIST.md) | 公開前チェックリスト |
| [`templates/README.template.md`](../templates/README.template.md) | README テンプレート |
| [`examples/minimal-readme.md`](../examples/minimal-readme.md) | 最小構成の例 |
| [`skills/nezu-md/SKILL.md`](../skills/nezu-md/SKILL.md) | AI 向け実行手順 |
