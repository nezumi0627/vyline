/** 1:1 通話の対象制限（DM のみ。表示名 allowlist は廃止） */

export class CallNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallNotAllowedError";
  }
}

/** mid が 1:1 通話可能か（u* の DM のみ） */
export function isAllowedCallTarget(toMid: string): boolean {
  return toMid.startsWith("u");
}

export function callAllowlistHint(): string {
  return "1:1 通話は DM（u*）のみ対応しています。";
}
