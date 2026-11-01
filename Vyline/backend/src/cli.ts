import { getAuthToken, loginWithToken, removeClient } from "./line/clientManager.js";
import {
  fetchChats,
  fetchContactProfile,
  fetchMessages,
  fetchProfile,
  getReadReceiptsForChat,
  markAsRead,
} from "./service/lineService.js";
import { closeSqlite } from "./storage/sqlite.js";
import { findStoredMessageById, getStoredMessages } from "./storage/chatStore.js";
import { loadTokens, saveToken } from "./storage/tokenStore.js";
import { safeCliMessage } from "./cliOutput.js";
import { parseCliArgs, type CliOptions } from "./cliOptions.js";

const usage = `Vyline CLI (GUIは起動しません)

使い方:
  bun run cli -- accounts
  bun run cli -- profile --account <accountId>
  bun run cli -- contact --account <accountId> --mid <userMid>
  bun run cli -- chats --account <accountId>
  bun run cli -- history --account <accountId> --chat <chatMid> [--limit 50] [--before <messageId>]
  bun run cli -- receipts --account <accountId> --chat <chatMid> [--limit 100]
  bun run cli -- read --account <accountId> --chat <chatMid> [--last <messageId>]

history はローカルSQLiteを読みます。--refresh を付けると指定チャットの履歴をLINEから同期します。
アカウントが1件だけなら --account は省略できます。`;

function optionString(options: CliOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function boundedLimit(options: CliOptions, fallback: number): number {
  const raw = optionString(options, "limit");
  if (raw === undefined) return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("--limit は1〜500の整数を指定してください");
  }
  return limit;
}

function requireMid(options: CliOptions, key: string): string {
  const value = optionString(options, key);
  if (!value || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`--${key} に有効なMIDを指定してください`);
  }
  return value;
}

function printJson(value: unknown): void {
  console.log(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? String(item) : item), 2),
  );
}

async function closeAccountSession(accountId: string): Promise<void> {
  const refreshedToken = getAuthToken(accountId);
  try {
    if (refreshedToken) await saveToken(accountId, refreshedToken);
  } finally {
    removeClient(accountId);
    closeSqlite();
  }
}

async function main(argv: string[]): Promise<void> {
  const { command, options } = parseCliArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }

  const tokens = await loadTokens();
  const saved = Object.entries(tokens).map(([accountId, token]) => ({
    accountId,
    displayName: token.displayName,
  }));
  if (command === "accounts") {
    printJson(saved.map(({ accountId, displayName }) => ({ accountId, displayName })));
    return;
  }
  if (!new Set(["profile", "contact", "chats", "history", "receipts", "read"]).has(command)) {
    throw new Error(`不明なコマンド: ${command}\n\n${usage}`);
  }

  const requestedAccount = optionString(options, "account");
  const account = requestedAccount
    ? saved.find((item) => item.accountId === requestedAccount)
    : saved.length === 1
      ? saved[0]
      : undefined;
  if (!account) {
    throw new Error(
      requestedAccount
        ? `保存済みアカウントがありません: ${requestedAccount}`
        : "アカウントが複数あります。--account <accountId> を指定してください",
    );
  }

  if (command === "history") {
    const chatMid = requireMid(options, "chat");
    const beforeId = optionString(options, "before");
    const beforeMessage = beforeId
      ? await findStoredMessageById(account.accountId, beforeId)
      : null;
    if (beforeId && beforeMessage?.chatMid !== chatMid) {
      throw new Error("--before のメッセージがこのチャットのローカル履歴にありません");
    }
    const limit = boundedLimit(options, 50);
    if (options.refresh) await loginWithToken(account.accountId, { background: false });
    try {
      const messages = options.refresh
        ? await fetchMessages(account.accountId, chatMid, limit, {
            force: true,
            ...(beforeId
              ? {
                  beforeMessageId: beforeId,
                  beforeDeliveredTime: beforeMessage!.message.createdTime,
                }
              : {}),
          })
        : await getStoredMessages(account.accountId, chatMid, limit, {
            ...(beforeId
              ? {
                  beforeMessageId: beforeId,
                  beforeDeliveredTime: beforeMessage!.message.createdTime,
                }
              : {}),
          });
      printJson(messages.map((message) => safeCliMessage(message, chatMid)));
    } finally {
      if (options.refresh) await closeAccountSession(account.accountId);
      else closeSqlite();
    }
    return;
  }

  await loginWithToken(account.accountId, { background: false });
  try {
    switch (command) {
      case "profile":
        printJson(await fetchProfile(account.accountId));
        break;
      case "contact":
        printJson(await fetchContactProfile(account.accountId, requireMid(options, "mid")));
        break;
      case "chats":
        printJson(await fetchChats(account.accountId, { force: true, light: true }));
        break;
      case "receipts": {
        const chatMid = requireMid(options, "chat");
        const messages = (
          await getStoredMessages(account.accountId, chatMid, boundedLimit(options, 100))
        ).filter((message) => message.isMyMessage);
        const result = messages.length
          ? await getReadReceiptsForChat(
              account.accountId,
              chatMid,
              messages.map((m) => m.id),
            )
          : { receipts: {} };
        printJson({
          messages: messages.map((message) => safeCliMessage(message, chatMid)),
          ...result,
        });
        break;
      }
      case "read": {
        const chatMid = requireMid(options, "chat");
        const last = optionString(options, "last");
        if (last && !/^\d{1,40}$/.test(last))
          throw new Error("--last は数値のmessageIdを指定してください");
        await markAsRead(account.accountId, chatMid, last);
        printJson({ ok: true, chatMid, ...(last ? { lastMessageId: last } : {}) });
        break;
      }
      default:
        throw new Error(`不明なコマンド: ${command}\n\n${usage}`);
    }
  } finally {
    await closeAccountSession(account.accountId);
  }
}

void main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
  closeSqlite();
});
