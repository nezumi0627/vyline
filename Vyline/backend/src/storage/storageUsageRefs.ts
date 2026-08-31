import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { accountFile } from "./accountDirs.js";

export interface StoredMessageRef {
  chatMid: string;
  id: string;
}

type MessageRefMap = Record<string, Record<string, { id: string }>>;
type LazyRefCarrier = MessageRefMap & {
  [LAZY_REFS]?: () => IterableIterator<StoredMessageRef>;
};

const LAZY_REFS = Symbol.for("@vyline/storage-usage-message-refs");

/**
 * Return the historical message-ref API shape without materializing every row.
 * Callers may still add enumerable refs (e.g. an incoming restore) to this object.
 * The stored SQLite rows remain behind a non-enumerable Symbol-backed iterator.
 */
export async function getStoredMessageRefs(accountId: string): Promise<MessageRefMap> {
  const path = accountFile(accountId, "chatdb.sqlite");
  const result: LazyRefCarrier = {};
  Object.defineProperty(result, LAZY_REFS, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function* iterateStoredRefs(): IterableIterator<StoredMessageRef> {
      if (!existsSync(path)) return;
      const db = new Database(path, { readonly: true, safeIntegers: false, strict: true });
      try {
        db.exec("PRAGMA cache_size = -1024");
        db.exec("PRAGMA mmap_size = 0");
        db.exec("PRAGMA temp_store = FILE");
        const rows = db
          .query("SELECT chat_mid, id FROM messages")
          .iterate() as IterableIterator<{ chat_mid: string; id: string }>;
        for (const row of rows) yield { chatMid: row.chat_mid, id: row.id };
      } finally {
        db.close();
      }
    },
  });
  return result;
}

/** Returns the lazy SQLite iterator attached by getStoredMessageRefs, if present. */
export function iterateStoredMessageRefs(
  refs: MessageRefMap,
): IterableIterator<StoredMessageRef> | null {
  const factory = (refs as LazyRefCarrier)[LAZY_REFS];
  return factory ? factory() : null;
}
