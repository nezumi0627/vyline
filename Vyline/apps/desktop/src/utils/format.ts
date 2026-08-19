/**
 * utils/format.ts — 表示用フォーマット
 */

import type { MessageContentMeta } from "../types/index.js";

/** Unix ミリ秒を「今日なら HH:MM、それ以外は M/D HH:MM」に変換 */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STICKER_TYPES = new Set(["STICKER", "7", "STICKER_IMAGE"]);
const SYSTEM_TYPES = new Set(["CHATEVENT", "SERVICE", "INFO"]);

export function isStickerContent(contentType: string): boolean {
  return STICKER_TYPES.has(contentType) || contentType.toUpperCase().includes("STICKER");
}

export function isCallContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return (
    u === "CALL" ||
    u === "6" ||
    u === "GROUPCALL" ||
    (u.includes("CALL") && !u.includes("CALLBACK"))
  );
}

export function isImageContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "IMAGE" || u === "1";
}

export function isVideoContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "VIDEO" || u === "2";
}

export function isAudioContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "AUDIO" || u === "3";
}

export function isFileContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "FILE" || u === "14";
}

export function isContactContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "CONTACT" || u === "13";
}

export function isLocationContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  return u === "LOCATION" || u === "15";
}

export function isSystemLikeContent(contentType: string): boolean {
  const u = contentType.toUpperCase();
  if (
    u === "VIDEO" ||
    u === "AUDIO" ||
    u === "IMAGE" ||
    u === "FILE" ||
    u === "CONTACT" ||
    u === "FLEX" ||
    u === "RICH" ||
    u === "CALL" ||
    u === "GROUPCALL" ||
    u === "1" ||
    u === "2" ||
    u === "3" ||
    u === "6" ||
    u === "13" ||
    u === "14" ||
    u === "17" ||
    u === "22"
  ) {
    return false;
  }
  return SYSTEM_TYPES.has(contentType) || u.includes("CHATEVENT") || u === "SERVICE";
}

export function systemEventLabel(contentType: string, meta?: MessageContentMeta | null): string {
  const u = contentType.toUpperCase();
  if (meta?.eventType) return meta.eventType;
  if (u.includes("VIDEO") && u.includes("CALL")) return "ビデオ通話";
  if (u.includes("GROUP")) return "グループ通話イベント";
  if (u.includes("CALL") || contentType === "6") return "通話イベント";
  if (u.includes("EVENT") || u === "SERVICE") return "チャットイベント";
  return contentTypeLabel(contentType);
}

/** 1 grapheme が絵文字（ZWJ シーケンス・国旗・キーキャップ含む）か */
const EMOJI_GRAPHEME_RE =
  /^(?:(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[\d#*]\uFE0F?\u20E3)$/u;

/**
 * 絵文字のみメッセージか（空白除去後 1〜3 grapheme、かつ絵文字構成のみ）。
 * Telegram Desktop の「大きな絵文字」表示用。
 */
export function isEmojiOnlyText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  let segments: string[];
  try {
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
      segments = [...segmenter.segment(trimmed)].map((s) => s.segment);
    } else {
      segments = [...trimmed];
    }
  } catch {
    segments = [...trimmed];
  }

  if (segments.length < 1 || segments.length > 3) return false;
  return segments.every((g) => EMOJI_GRAPHEME_RE.test(g));
}

/** contentType を人間が読める文字列に変換 */
export function contentTypeLabel(contentType: string): string {
  switch (String(contentType)) {
    case "UNSENT":
    case "UNSEND":
      return "取り消し";
    case "NONE":
    case "0":
      return "(空メッセージ)";
    case "E2EE_UNAVAILABLE":
      return "メッセージを表示できません";
    case "IMAGE":
    case "1":
      return "写真";
    case "VIDEO":
    case "2":
      return "動画";
    case "AUDIO":
    case "3":
      return "音声";
    case "STICKER":
    case "7":
      return "スタンプ";
    case "CALL":
    case "6":
      return "通話";
    case "CONTACT":
    case "13":
      return "連絡先";
    case "FILE":
    case "14":
      return "ファイル";
    case "LOCATION":
    case "15":
      return "位置情報";
    case "RICH":
    case "17":
      return "リッチメッセージ";
    case "FLEX":
    case "22":
      return "Flexメッセージ";
    default:
      return `(${contentType})`;
  }
}

/**
 * 送信取り消し判定。
 * - contentType / meta の明示フラグ
 * - または空 NONE + chunks 無し + メディア meta 無し（サーバが空にした取り消し）
 */
export function isUnsentMessage(
  contentType: string,
  text: string | null | undefined,
  meta?: MessageContentMeta | null,
  hasChunks = false,
): boolean {
  const u = String(contentType).toUpperCase();
  if (u === "UNSENT" || u === "UNSEND") return true;
  if (meta?.UNSENT || meta?.UNSEND) return true;
  if (
    String(meta?.REPLACE ?? "")
      .toUpperCase()
      .includes("UNSEND")
  )
    return true;
  if (hasChunks) return false;
  if (text?.trim()) return false;
  if (u !== "NONE" && u !== "0") return false;
  if (meta?.STKID || meta?.OID || meta?.DOWNLOAD_URL || meta?.SID) return false;
  // 取り消し後にサーバが空 NONE だけ残すケース
  return true;
}

/** チャット一覧用の短いプレビュー文言 */
export function messagePreviewText(
  text: string | null | undefined,
  contentType: string | number | undefined,
  meta?: MessageContentMeta | null,
): string {
  const alt = meta?.ALT_TEXT?.trim();
  if (alt) {
    return alt.length > 60 ? `${alt.slice(0, 60)}…` : alt;
  }
  const trimmed = (text ?? "").trim();
  if (trimmed) {
    return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
  }
  return contentTypeLabel(String(contentType ?? "NONE"));
}
