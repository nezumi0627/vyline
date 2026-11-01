import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Message } from "@vyline/types";
import * as z from "zod/v4";

// Keep application logs on stderr; stdout belongs exclusively to MCP JSON-RPC.
process.env.VYLINE_MCP = "1";

const [lineClient, lineService, chatStore, tokenStore, sqliteStore] = await Promise.all([
  import("./line/clientManager.js"),
  import("./service/lineService.js"),
  import("./storage/chatStore.js"),
  import("./storage/tokenStore.js"),
  import("./storage/sqlite.js"),
]);

const sessionInflight = new Map<string, Promise<void>>();
const connectedAccounts = new Set<string>();
let cleanupTask: Promise<void> | undefined;

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? String(item) : item), 2);
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: json(value) }] };
}

function failed() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "Vylineの要求に失敗しました。アカウント状態とVylineログを確認してください。",
      },
    ],
  };
}

async function run<T>(operation: () => Promise<T>) {
  try {
    return result(await operation());
  } catch (error) {
    console.error(
      "Vyline MCP tool failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return failed();
  }
}

async function requireAccount(accountId: string): Promise<void> {
  const accounts = await tokenStore.loadTokens();
  if (!Object.hasOwn(accounts, accountId)) throw new Error("saved account not found");
}

async function ensureSession(accountId: string): Promise<void> {
  await requireAccount(accountId);
  if (connectedAccounts.has(accountId) && lineClient.getAuthToken(accountId)) return;
  const existing = sessionInflight.get(accountId);
  if (existing) return existing;

  const task = (async () => {
    await lineClient.loginWithToken(accountId);
    connectedAccounts.add(accountId);
  })();
  sessionInflight.set(accountId, task);
  try {
    await task;
  } catch (error) {
    connectedAccounts.delete(accountId);
    throw error;
  } finally {
    sessionInflight.delete(accountId);
  }
}

function validMid(value: string): boolean {
  return /^[ucr][A-Za-z0-9_-]{8,127}$/i.test(value);
}

function safeProfile(profile: Awaited<ReturnType<typeof lineService.fetchProfile>>) {
  return {
    mid: profile.mid,
    userid: profile.userid,
    displayName: profile.displayName,
    statusMessage: profile.statusMessage,
    thumbnailUrl: profile.thumbnailUrl,
    backgroundUrl: profile.backgroundUrl,
    birthday: profile.birthday,
    userType: profile.userType,
    premium: profile.premium,
  };
}

function safeMessage(message: Message & { chatMid?: string }, fallbackChatMid: string) {
  return {
    id: message.id,
    chatMid: message.chatMid ?? fallbackChatMid,
    from: message.from,
    isMyMessage: message.isMyMessage,
    text: message.text,
    contentType: message.contentType,
    createdTime: message.createdTime,
    seen: message.seen,
    reactions: message.reactions,
    relatedMessageId: message.relatedMessageId,
    messageState: message.messageState,
  };
}

async function closeSessions(): Promise<void> {
  if (cleanupTask) return cleanupTask;
  cleanupTask = (async () => {
    await Promise.allSettled([...sessionInflight.values()]);
    const accounts = [...connectedAccounts];
    await Promise.all(
      accounts.map(async (accountId) => {
        const refreshedToken = lineClient.getAuthToken(accountId);
        try {
          if (refreshedToken) await tokenStore.saveToken(accountId, refreshedToken);
        } catch (error) {
          console.error("Vyline MCP token update failed for an account.");
        } finally {
          lineClient.removeClient(accountId);
        }
      }),
    );
    sqliteStore.closeSqlite();
  })();
  return cleanupTask;
}

function createServer(): McpServer {
  const server = new McpServer({ name: "vyline", version: "0.6.0-beta" });

  server.registerTool(
    "list_accounts",
    {
      description:
        "List locally saved Vyline accounts. Select an accountId explicitly for every other tool.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const accounts = await tokenStore.loadTokens();
        return Object.entries(accounts).map(([accountId, entry]) => ({
          accountId,
          displayName: entry.displayName ?? "",
          mid: entry.mid ?? "",
        }));
      }),
  );

  server.registerTool(
    "get_profile",
    {
      description:
        "Get the current user's LINE profile for a selected saved account. Connects to LINE if its session is not active.",
      inputSchema: { accountId: z.string().min(1).max(128) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ accountId }) =>
      run(async () => {
        await ensureSession(accountId);
        return safeProfile(await lineService.fetchProfile(accountId));
      }),
  );

  server.registerTool(
    "get_contact_profile",
    {
      description: "Get a LINE contact profile by MID for an explicitly selected saved account.",
      inputSchema: {
        accountId: z.string().min(1).max(128),
        mid: z
          .string()
          .min(9)
          .max(128)
          .regex(/^[ucr][A-Za-z0-9_-]+$/i),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ accountId, mid }) =>
      run(async () => {
        await ensureSession(accountId);
        const profile = await lineService.fetchContactProfile(accountId, mid);
        return profile ? safeProfile(profile) : null;
      }),
  );

  server.registerTool(
    "list_chats",
    {
      description:
        "Fetch the chat list from LINE for a selected account. This is read-only and makes a network request.",
      inputSchema: {
        accountId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ accountId, limit }) =>
      run(async () => {
        await ensureSession(accountId);
        const chats = await lineService.fetchChats(accountId, { force: true, light: true });
        return chats.slice(0, limit ?? 100).map((chat) => ({
          mid: chat.mid,
          name: chat.name,
          kind: chat.kind,
          hasMessages: chat.hasMessages,
          lastMessageTime: chat.lastMessageTime,
          unreadCount: chat.unreadCount,
          isOfficial: chat.isOfficial,
        }));
      }),
  );

  server.registerTool(
    "get_chat_history",
    {
      description:
        "Read cached messages from local SQLite, or refresh one selected chat from LINE. Raw contentMetadata and encryption keys are never returned.",
      inputSchema: {
        accountId: z.string().min(1).max(128),
        chatMid: z
          .string()
          .min(9)
          .max(128)
          .regex(/^[ucr][A-Za-z0-9_-]+$/i),
        limit: z.number().int().min(1).max(100).optional(),
        beforeMessageId: z
          .string()
          .regex(/^\d{1,40}$/)
          .optional(),
        refresh: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ accountId, chatMid, limit, beforeMessageId, refresh }) =>
      run(async () => {
        await requireAccount(accountId);
        if (!validMid(chatMid)) throw new Error("invalid chat MID");
        const pageLimit = limit ?? 30;
        const before = beforeMessageId
          ? await chatStore.findStoredMessageById(accountId, beforeMessageId)
          : null;
        if (beforeMessageId && before?.chatMid !== chatMid)
          throw new Error("cursor is not in this chat");
        const cursor = beforeMessageId
          ? {
              beforeMessageId,
              beforeDeliveredTime: before!.message.createdTime,
            }
          : undefined;
        const messages = refresh
          ? await (async () => {
              await ensureSession(accountId);
              return lineService.fetchMessages(accountId, chatMid, pageLimit, {
                force: true,
                ...cursor,
              });
            })()
          : await chatStore.getStoredMessages(accountId, chatMid, pageLimit, cursor);
        return messages.map((message) => safeMessage(message, chatMid));
      }),
  );

  server.registerTool(
    "get_read_receipts",
    {
      description:
        "Fetch read status for the latest locally cached outgoing messages in one chat. Network access is used.",
      inputSchema: {
        accountId: z.string().min(1).max(128),
        chatMid: z
          .string()
          .min(9)
          .max(128)
          .regex(/^[ucr][A-Za-z0-9_-]+$/i),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ accountId, chatMid, limit }) =>
      run(async () => {
        await requireAccount(accountId);
        if (!validMid(chatMid)) throw new Error("invalid chat MID");
        const local = await chatStore.getStoredMessages(accountId, chatMid, limit ?? 50);
        const outgoing = local.filter((message) => message.isMyMessage);
        if (outgoing.length === 0) return { messages: [], receipts: {} };
        await ensureSession(accountId);
        const receipts = await lineService.getReadReceiptsForChat(
          accountId,
          chatMid,
          outgoing.map((message) => message.id),
        );
        return { messages: outgoing.map((message) => safeMessage(message, chatMid)), ...receipts };
      }),
  );

  server.server.onclose = () => {
    void closeSessions();
  };
  return server;
}

const handle = serveStdio(createServer, {
  onerror: (error) => console.error("Vyline MCP transport error:", error.message),
});

process.once("SIGINT", () => {
  void handle.close().then(closeSessions);
});
process.once("SIGTERM", () => {
  void handle.close().then(closeSessions);
});
