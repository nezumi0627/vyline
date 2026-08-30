# VyTheme — テーマの作り方

最終更新: 2026-08-24

Vyline の外観は **CSS 変数のトークンセット（VyTheme）** で制御されます。
UI からカスタムテーマを作るか、コードでプリセットを追加できます。

## 方法 A: UI で作る（コード不要）

1. 設定 > **NezuTheme** を開く
2. プリセット（telegram-night / line-dark / soft-day）を選ぶか「custom」で編集
3. トークンを調整:
   - `accent` — アクセントカラー（リンク・ボタン）
   - `surface0/1/2` — 背景 3 段階（アプリ/パネル/カード）
   - `msgIn` / `msgOut` — 受信/送信バブルの背景
   - `textPrimary` / `textSecondary` — 文字色
   - `messageRadiusPx` — バブルの角丸
   - 背景画像の設定も可能

設定全体は 詳細・復元 > 設定インポート/エクスポート で JSON として
受け渡しできるため、テーマ込みで共有できます。

## 方法 B: コードでプリセットを追加する

`Vyline/apps/desktop/src/stores/themeStore.ts` の `PRESETS` に追加します:

```ts
const PRESETS: Record<Exclude<VyThemeId, "custom">, VyThemeTokens> = {
  // ...既存プリセット
  "my-theme": {
    accent: "#ff7ab6",
    surface0: "#14121a",
    surface1: "#1d1a26",
    surface2: "#282433",
    msgIn: "#241f31",
    msgOut: "#4d2b52",
    textPrimary: "#f2eef7",
    textSecondary: "#a79bb5",
    chatBgImage: null,        // または背景画像 URL
    messageRadiusPx: 18,
  },
};
```

型（`VyThemeId`）に ID を追加するのを忘れないでください:

```ts
export type VyThemeId = "telegram-night" | "line-dark" | "soft-day" | "my-theme" | "custom";
```

## トークン → UI への反映

トークンは `theme-applier.tsx` が CSS 変数へ変換します:

| トークン | 主な CSS 変数 |
|---|---|
| accent | `--vy-accent` |
| surface0-2 | `--vy-bg-*` / `--vy-surface` |
| msgIn / msgOut | `--vy-msg-in` / `--vy-msg-out`（+ `-text`） |
| textPrimary / Secondary | `--vy-text-*` |

独自の CSS からこれらの変数を参照すれば、テーマに追従するカスタム
スタイルを作れます。

## 配布

- プリセット追加は PR で歓迎します（`themeStore.ts` の PRESETS への追加 + 動作確認）
- 背景画像を使う場合は権利クリアな画像を使用してください
- 設定エクスポート JSON を共有する形でもテーマ配布が可能です
