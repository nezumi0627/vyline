/**
 * types/index.ts
 *
 * フロントエンド内で使う型。
 * @vyline/types (共有) を re-export しつつ、
 * フロント固有の UI 型もここに置く。
 */

export type { LineProfile, Chat, ChatKind, Message, MessageContentMeta } from "@vyline/types";

// ─── UI-only types ────────────────────────────

export interface MessageMenuState {
  x: number;
  y: number;
  message: import("@vyline/types").Message;
}
