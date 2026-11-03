# VyTheme API

最終更新: 2026-11-03

## 概要

Vyline のテーマは `@vyline/themes` が定義する `VyTheme` オブジェクトです。CSS custom properties を直接編集する旧仕様ではありません。ユーザー向けの設定手順は[テーマガイド](../Vyline/docs/user-guide/themes.md)を参照してください。

## 型

正本は [`Vyline/packages/themes/src/index.ts`](../Vyline/packages/themes/src/index.ts) です。

```ts
export type VyTheme = {
  id: string;
  name: string;
  accent: string;
  accentContrast: string;
  bg: string;
  surface: string;
  surface2: string;
  sidebar: string;
  text: string;
  textDim: string;
  border: string;
  msgIn: string;
  msgOut: string;
  msgInText: string;
  msgOutText: string;
  radius: number;
  chatBg: string;
  chatImage?: string;
  pattern: 0 | 1;
};
```

`THEME_PRESETS` がアプリ同梱プリセットです。新規プリセットは `Vyline/packages/themes/src/index.ts` の定義とテストを更新し、利用側のトークン適用を確認してください。テーマの拡張・適用方法は [`Vyline/packages/themes/README.md`](../Vyline/packages/themes/README.md) を参照してください。

## 変更時の注意

- `VyTheme` の必須フィールドを増やす場合、全プリセットと利用側を同じ変更で更新する。
- テーマ値を CSS 変数名として直接設定する旧コード例は使用しない。
- カスタムテーマの共有とバックアップは、現行アプリの設定画面で提供される形式に従う。
