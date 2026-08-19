/**
 * Talk Push で受け取ったイベントをフロント poll 用にバッファする。
 */

import type { Message } from "@vyline/types";

export type TalkPollEventPayload =
  | { kind: "message"; chatMid: string; message: Message }
  | { kind: "revoke"; chatMid: string; messageId: string }
  | { kind: "read"; chatMid: string }
  | { kind: "reaction"; chatMid: string; messageId: string }
  | { kind: "call:incoming"; chatMid: string; callerMid: string; callType: "audio" | "video" }
  | { kind: "call:end"; chatMid: string; durationSec?: number }
  | { kind: "call:cancel"; chatMid: string; callerMid: string }
  | {
      kind: "membership";
      chatMid: string;
      event: "invited" | "joined" | "left" | "kicked";
      targetMid?: string;
    }
  | { kind: "chat:update"; chatMid: string }
  | { kind: "announce"; chatMid: string; text: string };

export type TalkPollEvent = TalkPollEventPayload & { seq: number };

type AccountBuffer = {
  seq: number;
  events: TalkPollEvent[];
};

const buffers = new Map<string, AccountBuffer>();
const MAX_EVENTS = 400;

export function pushTalkEvent(accountId: string, payload: TalkPollEventPayload): number {
  const buf = buffers.get(accountId) ?? { seq: 0, events: [] };
  buf.seq += 1;
  buf.events.push({ ...payload, seq: buf.seq } as TalkPollEvent);
  if (buf.events.length > MAX_EVENTS) {
    buf.events.splice(0, buf.events.length - MAX_EVENTS);
  }
  buffers.set(accountId, buf);
  return buf.seq;
}

export function drainTalkEvents(
  accountId: string,
  afterSeq: number,
): { cursor: number; events: TalkPollEvent[]; reset: boolean; seq: number } {
  const buf = buffers.get(accountId);
  const seq = buf?.seq ?? 0;
  // 再起動で seq が巻き戻る / MAX_EVENTS を超えて追い出された場合は再同期が必要
  const reset = afterSeq > 0 && (!buf || buf.seq < afterSeq || afterSeq < buf.seq - MAX_EVENTS);
  if (!buf || reset) {
    return { cursor: reset ? seq : afterSeq, events: [], reset, seq };
  }
  const events = buf.events.filter((e) => e.seq > afterSeq);
  const cursor = events.length > 0 ? events[events.length - 1]!.seq : afterSeq;
  return { cursor, events, reset: false, seq };
}

export function clearTalkEvents(accountId: string): void {
  buffers.delete(accountId);
}
