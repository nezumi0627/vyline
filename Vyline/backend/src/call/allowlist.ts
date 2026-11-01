/** 通話先の種別を検証する。実送信テストは AGENTS.md の指定先だけ。 */

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

export function isGroupCallTarget(mid: string): boolean {
  return /^c[0-9a-f]{32}$/.test(mid);
}

export function callAllowlistHint(): string {
  return "1:1 通話は DM（u*）のみ対応しています。";
}
