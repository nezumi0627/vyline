/**
 * utils/emoji.ts — Unicode 絵文字の簡易判定
 *
 * LINE 独自絵文字 `(blush)` 等は未対応（docs/analysis/line-emoji.md）。
 * ここでは Extended_Pictographic ベースの Unicode のみ扱う。
 */

/** テキストを書記素（grapheme）単位に分割 */
export function graphemes(text: string): string[] {
  const IntlWithSeg = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity?: string },
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  };
  if (typeof IntlWithSeg.Segmenter === "function") {
    const segmenter = new IntlWithSeg.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return [...segmenter.segment(text)].map((s) => s.segment);
  }
  return [...text];
}

/** 1 書記素が絵文字（Extended_Pictographic）を含むか */
export function isEmojiGrapheme(g: string): boolean {
  // Exclude "￼" from being considered as emoji graphemes
  if (g === "￼") return false;
  return /\p{Extended_Pictographic}/u.test(g);
}

/**
 * 絵文字のみのメッセージか（空白除去後、1〜3 個の絵文字書記素）。
 * 例: "😀" / "👍🔥" / "🎉🎊✨" → true
 * 例: "hello 😀" / "" / "😀😀😀😀" → false
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const gs = graphemes(trimmed).filter((g) => g.trim().length > 0);
  if (gs.length < 1 || gs.length > 3) return false;
  return gs.every(isEmojiGrapheme);
}

/** 絵文字のみメッセージの書記素数（1〜3）。該当しなければ 0 */
export function emojiOnlyCount(text: string): number {
  if (!isEmojiOnly(text)) return 0;
  return graphemes(text.trim()).filter((g) => g.trim().length > 0).length;
}
