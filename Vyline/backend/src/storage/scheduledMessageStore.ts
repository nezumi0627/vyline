/**
 * scheduledMessageStore.ts — メッセージの予約送信（LEINs FunctionLIST 「メッセージの予約送信」）
 *
 * アカウント単位で「まだ送信していない予約メッセージ」のリストを永続化する。
 * 実際の送信判定・実行は service/scheduledMessageService.ts の定期チェッカーが行う。
 */

import { VylineStorage } from "./vylineStorage.js";

export interface ScheduledMessage {
  id: string;
  chatMid: string;
  text: string;
  /** 送信予定時刻 (epoch ms) */
  sendAt: number;
  createdAt: number;
  /** 直近の送信試行が失敗した場合のエラーメッセージ（再試行はしない） */
  lastError?: string;
}

type ScheduledMessageDb = {
  version: 1;
  items: ScheduledMessage[];
};

function emptyDb(): ScheduledMessageDb {
  return { version: 1, items: [] };
}

const storage = new VylineStorage<ScheduledMessageDb>("scheduled-messages", emptyDb);

export async function listScheduledMessages(accountId: string): Promise<ScheduledMessage[]> {
  const db = await storage.load(accountId);
  return [...db.items].sort((a, b) => a.sendAt - b.sendAt);
}

export async function addScheduledMessage(
  accountId: string,
  chatMid: string,
  text: string,
  sendAt: number,
): Promise<ScheduledMessage> {
  const item: ScheduledMessage = {
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    chatMid,
    text,
    sendAt,
    createdAt: Date.now(),
  };
  await storage.mutate(accountId, (db) => {
    db.items.push(item);
  });
  return item;
}

export async function removeScheduledMessage(accountId: string, id: string): Promise<boolean> {
  let removed = false;
  await storage.mutate(accountId, (db) => {
    const before = db.items.length;
    db.items = db.items.filter((i) => i.id !== id);
    removed = db.items.length !== before;
  });
  return removed;
}

export async function markScheduledMessageFailed(
  accountId: string,
  id: string,
  error: string,
): Promise<void> {
  await storage.mutate(accountId, (db) => {
    const item = db.items.find((i) => i.id === id);
    if (item) item.lastError = error;
  });
}


