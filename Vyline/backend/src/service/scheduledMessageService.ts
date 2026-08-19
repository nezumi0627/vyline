/**
 * service/scheduledMessageService.ts — 予約送信メッセージの定期チェック・実送信
 *
 * backend 起動時に一度だけ setInterval を開始し、期限が来た予約メッセージを
 * sendMessage（lineService）で実送信する。循環 import を避けるため、
 * sendMessage は呼び出し側（index.ts 起動時）から関数として注入する。
 */
import { childLogger } from "../logger.js";
import {
  listScheduledMessages,
  removeScheduledMessage,
  markScheduledMessageFailed,
} from "../storage/scheduledMessageStore.js";

const log = childLogger("scheduledMessage");

const CHECK_INTERVAL_MS = Number(process.env["VYLINE_SCHEDULED_CHECK_MS"] ?? 20_000);

export type ScheduledMessageSender = (
  accountId: string,
  chatMid: string,
  text: string,
) => Promise<unknown>;

let started = false;

export function startScheduledMessageChecker(
  listAccountIds: () => string[],
  send: ScheduledMessageSender,
): void {
  if (started) return;
  started = true;

  const tick = async () => {
    const now = Date.now();
    for (const accountId of listAccountIds()) {
      try {
        const items = await listScheduledMessages(accountId);
        for (const item of items) {
          if (item.sendAt > now) continue;
          if (item.lastError) continue; // 送信失敗済みは再試行しない（ユーザーが手動で消す想定）
          try {
            await send(accountId, item.chatMid, item.text);
            await removeScheduledMessage(accountId, item.id);
            log.info({ accountId, chatMid: item.chatMid, id: item.id }, "scheduled message sent");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await markScheduledMessageFailed(accountId, item.id, msg);
            log.warn({ accountId, id: item.id, err: msg }, "scheduled message send failed");
          }
        }
      } catch (err) {
        log.debug({ accountId, err }, "scheduled message check failed for account");
      }
    }
  };

  setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);

  log.info({ intervalMs: CHECK_INTERVAL_MS }, "scheduled message checker started");
}
