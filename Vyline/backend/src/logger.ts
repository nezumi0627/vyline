import pino from "pino";
import { redactError, redactForDiagnostics, sanitizeStringValue } from "./service/redaction.js";

const isDev = process.env.NODE_ENV !== "production";

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
  isDev ? pino.transport({ target: "pino-pretty", options: { colorize: true } }) : undefined,
);

export function childLogger(subsystem: string) {
  return logger.child({ subsystem });
}
