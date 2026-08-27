import { createHash } from "node:crypto";

const SECRET_KEY = /(token|cookie|password|passwd|secret|private.?key|access.?key|auth)/i;
const PII_KEY =
  /(mid|gid|email|phone|display.?name|user.?name|message|content|text|body|url|ip|path|media|device.?id)/i;

export function anonymousId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function redactForDiagnostics(input: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED_SECRET]";
  if (PII_KEY.test(key)) return "[REDACTED_PII]";
  if (Array.isArray(input)) return input.slice(0, 100).map((value) => redactForDiagnostics(value));
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 200)
        .map(([childKey, value]) => [childKey, redactForDiagnostics(value, childKey)]),
    );
  }
  if (typeof input === "string" && input.length > 512) return `${input.slice(0, 512)}…`;
  return input;
}

export function redactError(error: unknown): { name: string; message: string; stack?: string } {
  const source = error instanceof Error ? error : new Error(String(error));
  const result: { name: string; message: string; stack?: string } = {
    name: source.name,
    message: String(redactForDiagnostics(source.message, "message")),
  };
  if (source.stack) result.stack = source.stack.replace(/https?:\/\/\S+/g, "[REDACTED_URL]");
  return result;
}
