# Vylineブログの記事を書く

記事はこのフォルダーのMarkdownファイルで管理します。公開記事はビルド時に一覧と個別ページへ変換され、トップメニューの「ブログ」から読めます。

## 新しい記事を追加する

1. `_template.md` をコピーし、`yyyy-mm-dd-short-title.md` のような小文字とハイフンだけの名前を付けます。
2. 先頭のメタデータを埋めて、その下にMarkdownで本文を書きます。
3. 下書きの間は `published: false` にします。公開するときだけ `true` に変えます。
4. `bun run docs:site` で生成し、`bun run docs:site:preview` で表示を確認します。
5. 変更を `main` に取り込むと、GitHub Pagesへ自動で反映されます。

## メタデータ

```yaml
---
title: "記事のタイトル"
summary: "一覧に表示する短い紹介文。"
date: "2026-11-03"
category: "開発ノート"
tags: ["開発", "使い方"]
published: false
---
```

- `title`: 記事タイトル
- `summary`: 一覧や検索結果に表示する紹介文
- `date`: `YYYY-MM-DD` 形式の日付。新しい記事が先に並びます
- `category`: 「リリース」「開発ノート」などの記事種別
- `tags`: 記事に付ける短いタグ
- `published`: `true` の記事だけが公開ページへ出ます

記事のURLにはファイル名が使われます。公開後はファイル名を変えないでください。本文は見出し、リンク、引用、箇条書き、表、コードブロックを使えます。
