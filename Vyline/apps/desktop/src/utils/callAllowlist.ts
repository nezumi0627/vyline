/** 1:1 通話 UI 用（DM のみ。表示名 allowlist は廃止） */

export function canDirectCall(chatId: string | undefined | null): boolean {
  return Boolean(chatId?.startsWith("u"));
}

export function directCallHint(): string {
  return "1:1 通話は DM（u*）のみ対応しています";
}

export type CallUiState =
  | "idle"
  | "starting"
  | "acquiring"
  | "connecting"
  | "ringing"
  | "in-call"
  | "ending"
  | "ended"
  | "failed";

export interface ActiveCall {
  sessionId: string;
  to: string;
  kind: "voice" | "video";
  state: CallUiState;
  transport?: "planet" | "andromeda" | "unknown";
  error?: string;
}
