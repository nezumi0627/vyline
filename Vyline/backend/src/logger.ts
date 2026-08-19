import pino from "pino";
import pinoPretty from "pino-pretty";

const isDev = process.env["NODE_ENV"] !== "production";

// pino.transport() はワーカースレッド越しに "pino-pretty" をファイルパスとして require
// するため、`bun build --compile` の単一実行ファイル（Electron 同梱バックエンド）内では
// 仮想 FS 上に実ファイルが無く `unable to determine transport target` で落ちる。
// ワーカーを経由しないプロセス内 pretty stream を直接渡すことで、通常実行・コンパイル
// 済みバイナリの両方で同じログ出力パスにする。
export const logger = pino(
  { level: process.env["LOG_LEVEL"] ?? "debug" },
  isDev ? pinoPretty({ colorize: true }) : undefined,
);

export function childLogger(subsystem: string) {
  return logger.child({ subsystem });
}
