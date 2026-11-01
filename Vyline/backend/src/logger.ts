import pino from "pino";

const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
const destination =
  process.env.VYLINE_MCP === "1"
    ? pino.destination(2)
    : isDev
      ? pino.transport({ target: "pino-pretty", options: { colorize: true } })
      : undefined;

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }, destination);

export function childLogger(subsystem: string) {
  return logger.child({ subsystem });
}
