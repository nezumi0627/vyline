# AI 生成 UI の均質化と、Vyline の入力欄デザイン調査

調査日: 2026-10-30  
対象: メッセージ入力欄。日常的に触る頻度が高く、入力・添付・絵文字・録音・送信の状態変化を一続きで評価できるため選定。

## 方法と限界

AI 生成 UI、創造性の多様性、HCI の実験・レビュー、および実務的なユーザビリティ指針から50件を選び、公開要旨・本文・出版社の説明を確認した。全文にアクセスできない論文は要旨の範囲で扱う。異なるタスク・参加者・生成モデルの結果を Vyline の画面へそのまま一般化しない。以下は体系的レビューではなく、設計判断を支えるスコーピング調査である。

## 研究・記事 50 件

### 生成 UI、創造性、均質化

1. [How well can generative AI design and evaluate user interfaces?](https://publications.ergonomics.org.uk/publications/how-well-can-generative-ai-design-and-evaluate-user-interfaces) — UI 生成と評価を人間と比較。見た目の評価と実用上の品質は分けて考える。
2. [Usable but Conventional: An Empirical Study on the UX of AI-Generated Interface Prototypes](https://arxiv.org/abs/2605.15124) — 92人の評価では実用性と独創性の印象が同じ軸ではなかった。
3. [Integrating Generative AI in the UX Design Process: An Empirical Perspective](https://research.tudelft.nl/en/publications/integrating-generative-ai-in-the-ux-design-process-an-empirical-p/) — デザイナーと利用者の調査。AI 利用が自動的に UX を高めるわけではない。
4. [User Experience Design Professionals’ Perceptions of Generative AI](https://ir.cwi.nl/pub/34508/) — UX 実務者は反復作業の支援を期待しつつ、信頼性と人間の判断を重視。
5. [Interaction Design with Generative AI: An Empirical Study of Emerging Strategies](https://arxiv.org/abs/2411.02662) — デザイン工程で生成案の選別・評価・反復が必要。
6. [Synthetic Heuristic Evaluation: A Comparison between AI- and Human-Powered Usability Evaluation](https://arxiv.org/abs/2507.02306) — AI 評価は問題発見の補助になるが、利用者評価の代替ではない。
7. [A Formative Study to Explore the Design of Generative UI Tools](https://arxiv.org/abs/2501.13145) — 37人の UX 専門家から、生成 UI ツールと実務の接続課題を調査。
8. [SimUser: Generating Usability Feedback by Simulating Various Users](https://doi.org/10.1145/3613904.3642481) — シミュレーション評価の精度は利用者群・評価項目に依存。
9. [Interrogating Design Homogenization in Web Vibe Coding](https://www.microsoft.com/en-us/research/publication/interrogating-design-homogenization-in-web-vibe-coding/) — 生成の摩擦を減らしすぎると既定の見た目へ収束しやすい点を調査。
10. [Does generative AI make us think alike?](https://www.tandfonline.com/doi/full/10.1080/0144929X.2026.2726451) — 19研究のメタ分析。均質化は一律ではなく、条件に左右される。
11. [Large language models are homogeneously creative](https://academic.oup.com/pnasnexus/article/5/3/pgag042/8529001) — 複数の創造課題でモデル出力の多様性を検討。
12. [Generative AI enhances individual creativity but reduces the collective diversity of novel content](https://doi.org/10.1126/sciadv.adn5290) — 個人の創造性支援と集団全体の多様性に異なる影響を報告。
13. [An empirical investigation of the impact of ChatGPT on creativity](https://www.nature.com/articles/s41562-024-01953-1) — 生成支援による個人成果と成果間の類似を比較。
14. [ChatGPT decreases idea diversity in brainstorming](https://www.nature.com/articles/s41562-025-02173-x) — ブレインストーミングにおけるアイデア多様性を検討。
15. [Partnering with Generative AI: human-led and model-led ideation](https://doi.org/10.1145/3772318.3791185) — 人間主導の問いとモデル主導の提案で発想の広がりが異なる。
16. [Quantifying Visual Complexity in Generative AI-Designed User Interfaces](https://www.mdpi.com/2079-9292/15/15/3458) — 生成 UI の視覚的複雑さを定量化する試み。
17. [When Algorithms Design: A Comparative Study of AI- and Human-Created Interfaces](https://ieeexplore.ieee.org/abstract/document/11323819) — AI と人間の UI 設計を比較する研究。
18. [Refining UI/UX with Minimalist Design and AI](https://www.sciencedirect.com/science/article/pii/S1877050925026717) — AI 生成を人間が洗練する工程を扱う。
19. [A user-guided generative image-based model interface](https://www.jstage.jst.go.jp/article/jsd/9/1/9_1_11/_article/-char/en) — 利用者の指示を生成 UI に取り込む設計を検討。
20. [Prototyping with Prompts: Emerging Approaches and Challenges](https://doi.org/10.1145/3706598.3713166) — チームの協調設計でプロンプトによる試作が生む課題を調査。
21. [Concerns and Challenges of AI Tools in the UI/UX Design Process](https://doi.org/10.1145/3613905.3650878) — UI/UX 工程における AI 利用の懸念を整理。
22. [AI-Driven Design Thinking: A Comparative Study](https://dit.rsu.ac.th/incit2024/en/download/Proceeding_book_INCIT24.pdf) — AI 支援を含むデザイン思考の比較事例。
23. [Generative AI in User Experience Design and Research](https://doi.org/10.1145/3643834.3660729) — 24人の UX 実務者インタビュー。組織方針とチームでの利用実態を調査。
24. [Why Slop Matters](https://doi.org/10.1145/3786777) — 低品質な大量生成物を「slop」と呼ぶ社会・技術上の論点。
25. [Autonomous language-image generation loops converge to generic visual motifs](https://www.sciencedirect.com/science/article/pii/S2666389925002995) — 反復生成が視覚モチーフを収束させる条件を分析。
26. [Homogenization Effects of Large Language Models on Human Creative Ideation](https://arxiv.org/abs/2402.01536) — 36人の創造的発想で生成支援と多様性を検討。
27. [AI Suggestions Homogenize Writing Toward Western Styles](https://arxiv.org/abs/2409.11360) — 提案が文章表現・文化的ニュアンスへ与える偏りを分析。
28. [Patterns of Creativity: How User Input Shapes AI-Generated Visual Diversity](https://arxiv.org/abs/2410.06768) — 指示の与え方と生成画像の多様性の関係を検討。
29. [Stable diffusion models reveal a persisting human and AI gap in visual creativity](https://arxiv.org/abs/2511.16814) — 人間とモデルの視覚的創造性の差を比較。
30. [Human diversity fuels collective creativity that large language models cannot simulate or sustain](https://arxiv.org/abs/2607.26899) — 集団の多様性と LLM の創造性を比較。
31. [Generative AI makes creative output more homogeneous](https://pure.au.dk/portal/en/publications/generative-ai-makes-creative-output-more-homogeneous/) — 生成 AI と成果の均質化を扱うメタ分析記録。
32. [Exploring creativity in human–AI co-creation](https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2025.1672735/pdf) — デザイン経験による人間と AI の共創の差を比較。
33. [AI-generated faces influence gender stereotypes and racial homogenization](https://pubmed.ncbi.nlm.nih.gov/40281283/) — 生成顔画像が属性表象へ与える影響を報告。
34. [Interactive Discovery and Exploration of Visual Bias in Generative Text-to-Image Models](https://onlinelibrary.wiley.com/doi/10.1111/cgf.70135) — 画像生成モデルの視覚的偏りを探索する研究。
35. [Intersectional analysis of visual generative AI](https://link.springer.com/content/pdf/10.1007/s00146-025-02207-y.pdf) — 属性の交差から視覚生成 AI の表象を検討。
36. [AI’s Role in Design Workflows Today](https://hs.designlab.com/hubfs/downloads/AI%20in%20UX%20and%20Product%20Design%20Survey%20Report%202026.pdf) — デザイン実務者の利用状況を把握する業界調査。
37. [AI Design Slop: Why AI-Generated UI Looks Generic](https://smoothui.dev/blog/ai-design-slop) — 実務記事。既定パターンへ寄る UI の見分け方を論じる。
38. [The New Skeuomorphism: How AI Makes Bad Design Look Good Enough](https://builtin.com/articles/ai-design-slop-era) — もっともらしい外観が設計上の弱さを隠すリスクを論じる。
39. [Why Does AI Art Look Like That?](https://www.theatlantic.com/technology/archive/2024/08/why-does-all-ai-art-look-same/679488/) — 生成画像の似通いを文化的・技術的に解説。
40. [Everything looks the same. Now what?](https://www.creativebloq.com/ai/everything-looks-the-same-now-what) — デザイン表現が均質化する懸念への実務的論考。

### 使いやすさ、状態、入力操作

41. [10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/) — 状態の可視化、一貫性、エラー予防などの基本指針。
42. [The Aesthetic-Usability Effect](https://www.nngroup.com/articles/aesthetic-usability-effect/) — 見た目の良さが使いやすさの知覚へ影響するため、両者を別々に評価。
43. [5 Principles of Visual Design in UX](https://www.nngroup.com/articles/principles-visual-design/) — 階層・バランス・コントラスト等で視覚を整理。
44. [Visual Hierarchy in UX](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) — 重要度に沿って要素の視覚的優先順位を示す。
45. [Microinteractions in User Experience](https://www.nngroup.com/articles/microinteractions/) — 小さな操作への明確なフィードバックを設計。
46. [Button States: Communicate Interaction](https://www.nngroup.com/articles/button-states-communicate-interaction/) — hover・focus・pressed・disabled の状態を見分けやすくする。
47. [Touch Targets on Touchscreens](https://www.nngroup.com/articles/touch-target-size/) — 操作対象の大きさと間隔が誤タップに影響。
48. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons/) — ボタンの目的・ラベル・状態を明確にする Apple の指針。
49. [Focus Appearance (WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) — キーボードフォーカスの視認性要件。
50. [Target Size Minimum (WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) — ポインター操作対象のサイズと例外を定義。

## Vyline への判断

- 「AI っぽさ」を独特な装飾で覆わない。既存の暗色テーマとチャットの文脈を使い、入力欄・添付・送信の役割を素直に見せる。
- 触り心地は大きな演出より、押せる領域、明確な hover/focus/pressed、入力中・録音中・送信可能状態の伝達で作る。
- リッチさは機能の発見性と状態の分かりやすさに割り当てる。影、グラデーション、アニメーションを重ねない。
- 生成案は静的モックとして比較し、実装では既存の送信・メンション・添付・録音ロジックを維持する。

## 比較の読み方

2案を同じ幅・色・チャット文脈で表示する。ブラインド案は「事前調査なし」、調査後案は状態フィードバック・キーボード説明・押せるサイズを意図する。エージェント各1案の比較なので、見えた差はこの二つの出力についての記述に留め、調査知識が原因だとは結論しない。
