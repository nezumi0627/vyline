# VyTheme — テーマの作り方

最終更新: 2026-08-24

Vyline の外観は **CSS 変数のトークンセット（VyTheme）** で制御されます。
UI からカスタムテーマを作るか、コードでプリセットを追加できます。

## 方法 A: UI で作る（コード不要）

1. 設定 > **NezuTheme** を開く
2. プリセット（telegram-night / line-dark / soft-day）を選ぶか「custom」で編集
3. トークンを調整:
   - `accent` — アクセントカラー（リンク・ボタン）
   - `bg` / `surface` / `surface2` / `sidebar` — 背景レイヤー
   - `msgIn` / `msgOut` — 受信/送信バブルの背景
   - `text` / `textDim` — 文字色
   - `radius` — バブルの角丸（rem）
   - 背景画像の設定も可能

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

トークンは `theme-applier.tsx` が CSS 変数へ変換します:

| トークン | 主な CSS 変数 |
|---|---|
| accent | `--vy-accent` |
| bg / surface / surface2 / sidebar | `--vy-bg` / `--vy-surface*` / `--vy-sidebar` |
| msgIn / msgOut | `--vy-msg-in` / `--vy-msg-out`（+ `-text`） |
| text / textDim | `--vy-text` / `--vy-text-dim` |

独自の CSS からこれらの変数を参照すれば、テーマに追従するカスタム
スタイルを作れます。

## 配布

- プリセット追加は PR で歓迎します（`packages/themes/src/index.ts` の `THEME_PRESETS` への追加 + 動作確認）
- 背景画像を使う場合は権利クリアな画像を使用してください
- 設定エクスポート JSON を共有する形でもテーマ配布が可能です
