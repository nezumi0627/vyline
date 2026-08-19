import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino(
  { level: process.env.LOG_LEVEL ?? "info" },
  isDev ? pino.transport({ target: "pino-pretty", options: { colorize: true } }) : undefined,
);

export function childLogger(subsystem: string) {
  return logger.child({ subsystem });
}
