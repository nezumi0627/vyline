# Design Principles

nezu-md の設計原則を、判断に使える粒度で定義する。

---

## Visual First

### Intent

読者がスクロール前に「これは何か」を把握できるようにする。

### Do

| Practice | Example |
| --- | --- |
| 冒頭に一文要約を置く | `Markdown design standard for readable, AI-friendly docs.` |
| 比較は表にする | Features / Benefits / Status |
| 流れは図にする | Mermaid flowchart / sequence |
| 状態は明示する | `Stable` / `Experimental` / `Deprecated` |

### Don't

| Anti-pattern | Why |
| --- | --- |
| 長文の導入だけで始める | 初見コストが高い |
| 装飾だけのバッジ列 | 意味が伝わらない |
| 見出しだけの空洞セクション | 信頼性を落とす |

---

## Information Hierarchy

読者の質問順に答える。

```text
What → Why → Capabilities → How → Structure → Future
```

この順序を崩すのは、文書種別が明確に別目的のときだけ許可する（例: ADR は Context → Decision が先）。

---

## Professional Quality

「書けた」ではなく「公開できる」を基準にする。

| Quality Bar | Meaning |
| --- | --- |
| Concrete | 主張が検証可能 |
| Complete | 必要セクションが埋まっている |
| Consistent | 用語と見出し階層が安定している |
| Concise | 余分な文がない |
| Correct | 手順と事実が実際と一致する |

---

## AI Friendly

人間向けの美しさと、機械向けの明確さを両立する。

| Signal | Why it helps AI |
| --- | --- |
| 固定セクション名 | 抽出位置が安定する |
| 表形式の事実 | キーバリュー化しやすい |
| 明示的な Status | 現在値と将来値を混同しない |
| 言語指定コード | 実行例と説明を分離できる |
| 曖昧語の排除 | 解釈分岐を減らせる |

推奨キーワード（英語見出しも可）:

`Purpose` `Features` `Architecture` `Components` `Dependencies` `Workflow` `Status` `Roadmap`

---

## Product Experience

ドキュメントを「説明文」ではなく「プロダクト面」として設計する。

| Layer | Role |
| --- | --- |
| Hero | 認知（名前と価値） |
| Features | 欲求（できること） |
| Quick Start | 行動（最初の成功） |
| Architecture | 信頼（仕組みの理解） |
| FAQ / Roadmap | 不安の除去と将来期待 |

参考体験は SaaS ランディング、Apple / Stripe / Vercel のドキュメント、高品質 OSS の README である。模倣対象はレイアウト思想であり、視覚トーンのコピーではない。
