/**
 * chatStore.ts — public chat-store API.
 *
 * Pure record/merge helpers live in chatStoreCore; runtime persistence is SQLite.
 * Existing chatdb.json files are deliberately ignored (no migration) so a large
 * legacy JSON database cannot stall startup on low-power/self-hosted devices.
 */

export * from "./chatStoreCore.js";
export {
  warmAccountCache,
  upsertChats,
  upsertMessages,
  markStoredMessagesReadThrough,
  markMessageRevoked,
  restoreRevokedMessage,
  getMessageHistory,
  getMessages,
  findStoredMessageById,
  getStoredChats,
  getStoredMessages,
  getBootstrapPayload,
  getCacheMeta,
  saveBoxOrder,
  exportChatDb,
  importChatDb,
  mergeImportedChatDb,
  rebuildAccountChatDb,
  flushAccountChatDb,
  listChatsWithCounts,
  getChatDbLogicalStorageBytes,
} from "./chatStoreSqlite.js";
export { getStoredMessageRefs } from "./storageUsageRefs.js";
export type { BootstrapPayload } from "./chatStoreSqlite.js";
