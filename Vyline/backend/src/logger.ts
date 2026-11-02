import pino from "pino";
import { redactError, redactForDiagnostics, sanitizeStringValue } from "./service/redaction.js";

const isDev = process.env.NODE_ENV !== "production";
// Bun standalone executables cannot reliably resolve Pino's runtime transport target.
// Keep JSON logging as the safe default; pretty output is an explicit dev-only opt-in.
const usePretty = isDev && process.env.VYLINE_PRETTY_LOGS === "1";

function sanitizeLogObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      value instanceof Error ? redactError(value) : redactForDiagnostics(value, key),
    ]),
  );
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      log(object) {
        return sanitizeLogObject(object);
      },
    },
    hooks: {
      logMethod(args, method) {
        const sanitized = args.map((arg) =>
          typeof arg === "string"
            ? sanitizeStringValue(arg)
            : arg instanceof Error
              ? redactError(arg)
              : arg,
        );
        return method.apply(this, sanitized as Parameters<typeof method>);
      },
    },
  },
  usePretty ? pino.transport({ target: "pino-pretty", options: { colorize: true } }) : undefined,
);

export function childLogger(subsystem: string) {
  return logger.child({ subsystem });
}
