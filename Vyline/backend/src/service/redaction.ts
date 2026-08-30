import { createHash } from "node:crypto";

const SECRET_KEY = /(token|cookie|password|passwd|secret|session|private.?key|access.?key|auth)/i;
const PII_KEY =
  /(account.?id|mid|gid|email|phone|display.?name|message|content|text|url|ip|device.?id)/i;

export function anonymousId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function sanitizeStringValue(value: string): string {
  let out = value;
  // raw user/group/room MID — must be before other patterns
  out = out.replace(/\b[ucr][0-9a-f]{32}\b/gi, "[REDACTED_MID]");
  // credentials embedded in otherwise harmless error strings
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED_SECRET]");
  out = out.replace(
    /\b(token|cookie|password|passwd|secret|session(?:[_-]?id)?|private[_-]?key|access[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED_SECRET]",
  );
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_SECRET]");
  // email
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  // IPv4
  out = out.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[REDACTED_IP]");
  // local file paths
  out = out.replace(/[A-Z]:\\[^\s"']+/gi, "[REDACTED_PATH]");
  out = out.replace(/\/[^\s"']*\/(?:home|Users|data|tmp|var)[^\s"']*/gi, "[REDACTED_PATH]");
  // media / obs URLs
  out = out.replace(/https?:\/\/[^\s"']*obs[^\s"']*/gi, "[REDACTED_URL]");
  out = out.replace(/https?:\/\/[^\s"']*line[^\s"']*cdn[^\s"']*/gi, "[REDACTED_URL]");
  return out;
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
  if (typeof input === "string") {
    const sanitized = sanitizeStringValue(input);
    if (sanitized.length > 512) return `${sanitized.slice(0, 512)}…`;
    return sanitized;
  }
  return input;
}

export function redactError(error: unknown): { name: string; message: string; stack?: string } {
  const source = error instanceof Error ? error : new Error(String(error));
  const result: { name: string; message: string; stack?: string } = {
    name: source.name,
    message: sanitizeStringValue(source.message).slice(0, 512),
  };
  if (source.stack) result.stack = sanitizeStringValue(source.stack).slice(0, 4096);
  return result;
}
