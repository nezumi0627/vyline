# Theme API

最終更新: 2026-08-24

---

## 概要

Vyline のテーマシステムは CSS Variables ベース。runtime での切り替え・hot reload・プラグイン提供テーマに対応。

---

## CSS 変数一覧

```css
:root {
  /* アクセントカラー */
  --vy-accent-primary: #5865f2;
  --vy-accent-secondary: #4752c4;
  --vy-accent-hover: #6d78f5;

  /* 背景 */
  --vy-bg-primary: #101114;
  --vy-bg-secondary: #1b1d23;
  --vy-bg-tertiary: #232428;
  --vy-bg-hover: #2e3035;

  /* テキスト */
  --vy-text-primary: #ffffff;
  --vy-text-secondary: #b5bac1;
  --vy-text-muted: #80848e;
  --vy-text-link: #00b0f4;

  /* ボーダー */
  --vy-border-primary: #3f4147;
  --vy-border-secondary: #2e3035;

  /* メッセージ */
  --vy-message-radius: 16px;
  --vy-message-bg-self: #5865f2;
  --vy-message-bg-other: #2e3035;
  --vy-message-text-self: #ffffff;
  --vy-message-text-other: #ffffff;

  /* レイアウト */
  --vy-sidebar-width: 280px;
  --vy-header-height: 48px;
  --vy-input-height: 44px;

  /* フォント */
  --vy-font-family: "Inter", sans-serif;
  --vy-font-size-base: 14px;
  --vy-font-size-sm: 12px;
  --vy-font-size-lg: 16px;

  /* アニメーション */
  --vy-transition-fast: 100ms ease;
  --vy-transition-normal: 200ms ease;
  --vy-transition-slow: 300ms ease;

  /* 角丸 */
  --vy-radius-sm: 4px;
  --vy-radius-md: 8px;
  --vy-radius-lg: 16px;
  --vy-radius-full: 9999px;

  /* 影 */
  --vy-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --vy-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --vy-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
}
```

---

## テーマファイル構造

```
themes/
  dark.css          ← デフォルトダークテーマ
  light.css         ← ライトテーマ
  my-theme/
    theme.css       ← テーマ CSS
    manifest.json   ← テーマメタデータ
    preview.png     ← プレビュー画像 (任意)
```

### manifest.json

```json
{
  "name": "my-theme",
  "version": "1.0.0",
  "author": "your-name",
  "description": "テーマの説明",
  "mode": "dark",
  "entry": "theme.css"
}
```

---

## テーマの作成

```css
/* themes/my-theme/theme.css */
:root {
  --vy-accent-primary: #ff6b6b;
  --vy-bg-primary: #0d0d0d;
  --vy-bg-secondary: #1a1a1a;
  --vy-text-primary: #f0f0f0;
  --vy-font-family: "JetBrains Mono", monospace;
}
```

変数を上書きするだけでテーマが完成する。

---

## カスタム CSS

変数だけでは表現できない場合はカスタム CSS を追加できる。

```css
/* themes/my-theme/theme.css */
:root {
  --vy-accent-primary: #ff6b6b;
}

/* カスタムスタイル */
.vy-message-bubble {
  border: 1px solid var(--vy-border-primary);
  backdrop-filter: blur(8px);
}

.vy-sidebar {
  background-image: url("./bg.png");
  background-size: cover;
}
```

---

## Runtime テーマ切り替え

```typescript
// frontend
import { useThemeStore } from "@/stores/themeStore";

const { setTheme } = useThemeStore();

// テーマ切り替え
setTheme("dark");
setTheme("light");
setTheme("my-theme");
```

---

## プラグインからのテーマ変更

```typescript
// plugins/my-plugin/index.ts
export default {
  onLoad(api) {
    // CSS 変数を上書き
    api.theme.setVariable("--vy-accent-primary", "#ff6b6b");

    // カスタム CSS を注入
    const cleanup = api.theme.injectCSS(`
      .vy-message-bubble {
        border-radius: 4px;
      }
    `);

    // onUnload で cleanup() を呼ぶ
  },
};
```

---

## ダーク / ライトモード

```css
/* ライトモード上書き */
[data-theme="light"] {
  --vy-bg-primary: #ffffff;
  --vy-bg-secondary: #f2f3f5;
  --vy-text-primary: #060607;
  --vy-text-secondary: #4e5058;
  --vy-border-primary: #e3e5e8;
}
```

---

## 背景画像

```css
:root {
  --vy-chat-bg-image: url("./bg.jpg");
  --vy-chat-bg-size: cover;
  --vy-chat-bg-opacity: 0.3;
}
```
