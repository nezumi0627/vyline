import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safePathComponent, writeJsonAtomic } from "./safeFile.js";

const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
const writes = new Map<string, Promise<void>>();

function pathFor(accountId: string): string {
  return join(DATA_DIR, "accounts", safePathComponent(accountId), "chat-locks.json");
}

export async function loadLockedChats(accountId: string): Promise<string[]> {
  const path = pathFor(accountId);
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0)),
    ];
  } catch {
    return [];
  }
}

export async function setChatLocked(
  accountId: string,
  chatMid: string,
  locked: boolean,
): Promise<string[]> {
  const previous = writes.get(accountId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const current = new Set(await loadLockedChats(accountId));
    if (locked) current.add(chatMid);
    else current.delete(chatMid);
    await writeJsonAtomic(pathFor(accountId), [...current].sort());
  });
  writes.set(
    accountId,
    next.catch(() => undefined),
  );
  await next;
  return loadLockedChats(accountId);
}

export async function isChatLocked(accountId: string, chatMid: string): Promise<boolean> {
  return (await loadLockedChats(accountId)).includes(chatMid);
}
