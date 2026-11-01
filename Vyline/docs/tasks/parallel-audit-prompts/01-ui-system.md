# Chat A — UI System / UX 徹底棚卸し・コンポーネント化

あなたは Vyline の UI System 担当です。最初から実装を始めず、まず現行 Web App の UI を徹底スキャンし、見た目・寸法・状態・動き・再利用性を把握してください。その後、既存コードを壊さず UI の正本を整理・統合してください。

## 最初に読むもの

- `AGENTS.md`
- `apps/desktop/src/components/vy-ui.tsx`
- `apps/desktop/src/index.css`
- `apps/desktop/src/components/` 全体
- `apps/desktop/src/lib/store.ts` の UI 設定部分
- `docs/animation-modes.md`

必要な Skill: `design-system`, `frontend-ui-engineering`, `common-ui-design`, `common-web-visual-testing`, `ponytail`, `minimize-cursor-cost`。ブラウザ確認が必要なら browser testing 系 Skill を使う。

## 参考資料

必ず実際に確認して、丸写しではなく Vyline に合う原則だけ抽出する。

- https://developer.apple.com/jp/design/human-interface-guidelines/
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
- https://emilkowal.ski/ui/you-dont-need-animations

トレンドを追う場合も、「AI生成っぽいグラデーション・過剰glass・無意味なanimation」を追加することが目的ではない。自然で落ち着きがあり、触った瞬間に用途が分かる UI を優先する。

## Phase 1 — UI監査

画面をブラウザで実際に確認し、最低でも以下を棚卸しする。

- Button: primary / secondary / ghost / danger / icon
- Input / textarea / search
- Switch / checkbox / radio
- Slider
- Tabs / segmented control
- Menu / context menu / hamburger / dropdown
- Dialog / sheet / drawer / popover / tooltip
- Card / panel / list row
- Badge / avatar / status
- Chat bubble / composer / attachment controls
- Loading / empty / error / disabled / focus / hover / pressed 状態
- Sidebar / header / settings navigation
- animation / transition / reduced motion

各要素について、実測またはコード根拠から height、padding、radius、gap、font size、icon size、border、shadow、animation duration/easing を記録する。

似たUIが複数実装されていれば、同じものか、意図的差分かを判定する。単に見た目が似ているだけで統合しない。

## Phase 2 — Design Token と UI 正本

既存のテーマ変数を先に確認し、再利用できるものを使う。必要なものだけ以下のような意味ベース token に整理する。

- spacing
- radius
- typography
- control height
- border / surface / foreground / muted / accent / danger
- elevation
- motion duration / easing

「値を1箇所に集めるためだけ」の過剰な abstraction は禁止。

`vy-ui.tsx` が正本として適切なら拡張する。別の UI 基盤がすでに存在する場合は、最小の正本へ統合する。

## Phase 3 — 再利用コンポーネント

実利用箇所が複数あるものから順に共通化する。例:

- `Button`
- `IconButton`
- `Switch`
- `Slider`
- `TextField`
- `Select/Menu`
- `Dialog/Sheet`
- `Tabs`
- `SettingsRow`
- `EmptyState`

variant を無限に増やさない。1回しか使わない特殊UIは無理に共通化しない。

アクセシビリティとして keyboard、focus-visible、aria、reduced-motion、十分な hit target を確認する。

## Phase 4 — Motion

`docs/animation-modes.md` と現行実装を確認する。「動かす理由」がある animation だけ残す。

- 状態変化の理解を助ける
- 空間関係を示す
- 操作結果をフィードバックする

常時動く装飾、長い入場演出、操作を遅く感じさせる animation は削減候補。

## Phase 5 — UI Catalog

開発用 UI Catalog / showcase を作り、主要部品の全 state を1画面で確認できるようにする。Storybook のような大きな依存追加は、既存構成で必要性が証明できない限り導入しない。

最低限表示するもの:

- default / hover / focus / active / disabled
- light/dark または VyTheme 差分
- animation mode 差分
- long text / narrow viewport

## 成果物

- UI audit report
- token / component inventory
- 実装された共通UI
- UI Catalog
- before/after の視覚確認結果
- 未統合UI一覧と理由

## 禁止

- 参考サイトのコードやデザインの無断コピー
- 一括 rewrite
- 新UIライブラリの安易な追加
- 見た目だけを理由に挙動を変更
- 「モダンだから」で blur / gradient / animation を増やす

## 完了条件

UIの主要パターンが棚卸しされ、重複が減り、新しい画面を既存部品の組み合わせで作れる。見た目・keyboard操作・レスポンシブ・animation mode を実ブラウザで確認し、スクリーンショットまたは検証記録を残す。
