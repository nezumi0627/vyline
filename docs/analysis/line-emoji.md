# LINE 絵文字（Unicode / 独自）メモ

最終更新: 2026-08-24
状態: Unicode のみ暫定対応。独自絵文字は将来作業。

---

## 現状（Vyline）

- `Vyline/apps/desktop/src/utils/emoji.ts` で Unicode 絵文字のみ判定
- `isEmojiOnly(text)`: 空白除去後、1〜3 個の Extended_Pictographic 書記素なら true
- `MessageItem`: 絵文字のみなら大きめ表示（`text-4xl` / `text-5xl`）、バブル装飾は控えめ

よく使う Unicode は OS / フォントのグリフに任せる（マップ不要）。

---

## 将来作業: LINE 独自絵文字

LINE クライアントは `(blush)` のような **テキスト置換型の独自絵文字** を持つ。

| 例                       | 意味（参考）  | 現状                            |
| ------------------------ | ------------- | ------------------------------- |
| `(blush)`                | 照れ          | 未マップ — プレーンテキスト表示 |
| `(smile)` / `(laugh)` 等 | 顔文字系      | 同上                            |
| sticker / package 系     | Shop スタンプ | 別経路（`stickers.md`）         |

### 必要な調査

1. Desktop / Web の置換テーブル（キー文字列 → 画像 URL or sprite）
2. 送受信時の保存形式（本文に `(blush)` のままか、別 contentType か）
3. 公式・サードパーティの公開マップ有無

実装方針（案）: Unicode 判定とは分離し、`(name)` トークンを画像スパンに置換するレイヤを後から足す。

---

## 関連

- スタンプ: [stickers.md](./stickers.md)
- UI: `MessageItem.tsx` / `utils/emoji.ts`
