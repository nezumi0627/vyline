# VyTheme — テーマの作り方

最終更新: 2026-11-03

Vyline の外観は **CSS 変数のトークンセット（VyTheme）** で制御されます。
UI からカスタムテーマを作るか、コードでプリセットを追加できます。

## 方法 A: UI で作る（コード不要）

1. 設定の **NezuTheme** を開く
2. プリセットを選びます。`telegram-night` / `line-dark` / `soft-day` / `sakura-dusk` / `aurora` / `mono-ink` / `midnight-grape` があります
3. **カスタム**欄で色、吹き出しの角丸、トーク背景のパターンや画像を調整します。各値を変更するとカスタムテーマとして保存されます

主な項目:

| 項目 | 表示への反映 |
|---|---|
| `accent` / `accentContrast` | ボタンやリンクの色と、その上に載る文字色 |
| `bg` / `surface` / `surface2` / `sidebar` | 画面、パネル、サイドバーの背景 |
| `chatBg` / `chatImage` / `pattern` | トーク背景色、画像、パターンの表示 |
| `msgIn` / `msgOut` | 相手と自分の吹き出しの背景色 |
| `msgInText` / `msgOutText` | 吹き出し内の文字色 |
| `text` / `textDim` / `border` | 基本文字、補助文字、境界線 |
| `radius` | 吹き出しの角丸（rem） |

設定全体は 詳細・復元 > 設定インポート/エクスポート で JSON として
受け渡しできるため、テーマ込みで共有できます。

## 方法 B: コードでプリセットを追加する

`Vyline/packages/themes/src/index.ts` の `THEME_PRESETS` に追加します:

```ts
export const THEME_PRESETS: VyTheme[] = [
  // ...既存プリセット
  {
    id: "my-theme",
    name: "My Theme",
    accent: "#ff7ab6",
    accentContrast: "#14121a",
    bg: "#14121a",
    surface: "#1d1a26",
    surface2: "#282433",
    sidebar: "#1d1a26",
    msgIn: "#241f31",
    msgOut: "#4d2b52",
    msgInText: "#f2eef7",
    msgOutText: "#ffffff",
    text: "#f2eef7",
    textDim: "#a79bb5",
    border: "rgba(255,255,255,0.08)",
    chatBg: "#14121a",
    radius: 1.125,
    pattern: 1,
  },
];
```

## トークン → UI への反映

トークンは `Vyline/apps/desktop/src/components/theme-applier.tsx` が CSS 変数へ変換します:

| トークン | 主な CSS 変数 |
|---|---|
| accent | `--vy-accent` |
| bg / surface / surface2 / sidebar | `--vy-bg` / `--vy-surface*` / `--vy-sidebar` |
| msgIn / msgOut | `--vy-msg-in` / `--vy-msg-out`（+ `-text`） |
| text / textDim | `--vy-text` / `--vy-text-dim` |
| border / chatBg / chatImage / pattern | `--vy-border` / `--vy-chat-bg` / `--vy-chat-image` / `--vy-chat-pattern` |

独自の CSS からこれらの変数を参照すれば、テーマに追従するカスタム
スタイルを作れます。

## 配布

- プリセット追加は PR で歓迎します（`Vyline/packages/themes/src/index.ts` の `THEME_PRESETS` への追加と、VyTheme 画面での確認）
- 背景画像を使う場合は権利クリアな画像を使用してください
- 設定エクスポート JSON を共有する形でもテーマ配布が可能です
