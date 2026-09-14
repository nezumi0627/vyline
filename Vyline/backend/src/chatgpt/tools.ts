import { z } from "zod";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { parseCallMeta } from "@vyline/types";
import { getClient } from "../line/clientManager.js";
import { listSavedSessions } from "../storage/tokenStore.js";
import * as line from "../service/lineService.js";
import { queryPluginMessages } from "../storage/chatStoreSqlite.js";
import { compareMessagesNewestFirst } from "../storage/chatStoreCore.js";
import { type ApiToken, tokenAllowsAccount } from "../storage/apiTokenStore.js";
import { lineRouter } from "../api/line.js";
import { accountSettingsRouter } from "../api/accountSettings.js";
import { authRouter } from "../api/auth.js";
import { accountId, mid, id, text, count, time, routeTools, routeRequest } from "./catalog.js";
import { uploadSource, fetchUpload, readBounded, readMediaSlice } from "./uploads.js";

const MAX_RESULT_BYTES = 4 * 1024 * 1024;
type Definition = {
  schema: z.ZodObject;
  tool: Tool;
  execute: (input: unknown, token: ApiToken) => Promise<unknown>;
};
const definitions = new Map<string, Definition>();
function define<S extends z.ZodRawShape>(
  name: string,
  description: string,
  fields: S,
  write: boolean,
  run: (args: z.output<z.ZodObject<S>>, token: ApiToken) => Promise<unknown>,
) {
  const schema = z.strictObject(fields);
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-7",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema === accountId) {
        // Unicode property escapes are not portable across JSON Schema validators.
        // Keep the full Unicode check in Zod at execution time, including nested IDs.
        Reflect.deleteProperty(jsonSchema, "pattern");
        jsonSchema.description =
          "Exact account ID from list_accounts. Unicode letters/numbers, underscores and hyphens.";
      }
    },
  });
  definitions.set(name, {
    schema,
    tool: {
      name,
      description,
      inputSchema: jsonSchema as Tool["inputSchema"],
      annotations: {
        readOnlyHint: !write,
        destructiveHint: write,
        idempotentHint: !write,
        openWorldHint: true,
      },
    },
    execute: (input, token) => run(schema.parse(input), token),
  });
}

export async function lineRequest(request: Request): Promise<unknown> {
  const response = await lineRouter.fetch(request);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Expected JSON response");
  }
  const data = JSON.parse(
    (await readBounded(response, MAX_RESULT_BYTES)).toString("utf8"),
  ) as Record<string, unknown>;
  if (!response.ok || data.ok === false || data.timedOut === true) {
    return {
      ok: false,
      status: response.status,
      code: data.code ?? "VYLINE_OPERATION_FAILED",
      error: data.timedOut
        ? "Upstream timed out; this is not an empty history."
        : "Vyline could not complete the operation. Check account login and operation requirements.",
    };
  }
  return data;
}

for (const entry of routeTools) {
  define(entry.name, entry.description, entry.schema.shape, entry.write, async (args, token) =>
    entry.serverAdmin && !token.scopes.includes("admin")
      ? { ok: false, code: "SERVER_ADMIN_SCOPE_REQUIRED" }
      : lineRequest(routeRequest(entry, args)),
  );
}

define(
  "list_accounts",
  "操作可能なアカウントID・自身の名前・MID・ログイン状態。最初に呼び、以降すべての操作で選択したaccountIdを明示する。別アカウントの同名友人を混同しない。",
  {},
  false,
  async (_, token) => {
    const saved = await listSavedSessions();
    return {
      scopes: token.scopes,
      limits: {
        historyPage: 100,
        uploadBytes: 8 * 1024 * 1024,
        downloadChunkBytes: 2 * 1024 * 1024,
      },
      uploadHosts: (process.env.VYLINE_CHATGPT_UPLOAD_HOSTS ?? "files.oaiusercontent.com")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
      accounts: token.accountIds.map((accountId) => {
        const client = getClient(accountId);
        const profile = client?.base.profile;
        const session = saved.find((s) => s.accountId === accountId);
        return {
          accountId,
          loggedIn: Boolean(client),
          mid: profile?.mid ?? session?.mid ?? null,
          displayName: profile?.displayName ?? session?.displayName ?? null,
        };
      }),
    };
  },
);

const pageFields = {
  limit: count.default(50),
  offset: z.number().int().min(0).max(100000).default(0),
};
define(
  "list_friends",
  "指定アカウントの友人一覧・名前検索。query省略で全友人。曖昧な名前では候補を返し、送信先を勝手に選ばない。nextOffsetで続き。",
  { accountId, query: text.optional(), ...pageFields },
  false,
  async (a) => {
    const friends = (await line.fetchFriends(a.accountId))
      .map(({ mid, displayName, thumbnailUrl, statusMessage }) => ({
        mid,
        displayName,
        thumbnailUrl,
        statusMessage,
      }))
      .filter(
        (f) =>
          !a.query ||
          f.displayName.toLocaleLowerCase().includes(a.query.toLocaleLowerCase()) ||
          f.mid === a.query,
      )
      .sort((a, b) => a.mid.localeCompare(b.mid));
    return {
      friends: friends.slice(a.offset, a.offset + a.limit),
      total: friends.length,
      nextOffset: a.offset + a.limit < friends.length ? a.offset + a.limit : null,
    };
  },
);
define(
  "list_chats",
  "トーク一覧・名前検索・未読数。unreadOnlyで未読トーク。未読数不明をゼロ扱いしない。",
  {
    accountId,
    query: text.optional(),
    unreadOnly: z.boolean().default(false),
    refresh: z.boolean().default(true),
    ...pageFields,
  },
  false,
  async (a) => {
    const chats = await line.fetchChats(a.accountId, { refresh: a.refresh });
    const filtered = chats.filter(
      (c) =>
        (!a.query ||
          c.name.toLocaleLowerCase().includes(a.query.toLocaleLowerCase()) ||
          c.mid === a.query) &&
        (!a.unreadOnly || (c.unreadCount ?? 0) > 0),
    );
    return {
      chats: filtered.slice(a.offset, a.offset + a.limit),
      total: filtered.length,
      unknownUnreadCount: chats.filter((c) => c.unreadCount === undefined).length,
      nextOffset: a.offset + a.limit < filtered.length ? a.offset + a.limit : null,
      source: "Vyline chat cache; refresh may fall back to cached data",
    };
  },
);

const cursorSchema = z.strictObject({ scope: z.string(), time, chatMid: mid, id });
function decodeCursor(cursor: string | undefined, scope: string) {
  if (!cursor) return undefined;
  const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  if (value.scope !== scope) throw new Error("Cursor does not belong to this account/query");
  return value;
}
function encodeCursor(scope: string, last: { createdTime: number; id: string }, chatMid: string) {
  return Buffer.from(
    JSON.stringify({ scope, time: last.createdTime, chatMid, id: last.id }),
  ).toString("base64url");
}
define(
  "get_messages",
  "指定した友人・トークの直近15件を既定で取得。limitは1〜100、さらに古い履歴はnextCursorを繰り返す。既読は送信しない。refresh=trueでLINEへ照会、falseで保存履歴のみ。",
  {
    accountId,
    chatMid: mid,
    limit: count.default(15),
    cursor: z.string().max(4096).optional(),
    refresh: z.boolean().default(true),
  },
  false,
  async (a) => {
    const scope = JSON.stringify([a.accountId, a.chatMid, a.refresh]);
    const before = decodeCursor(a.cursor, scope);
    const fetched = await line.fetchMessages(a.accountId, a.chatMid, a.limit, {
      ...(before ? { beforeMessageId: before.id, beforeDeliveredTime: before.time } : {}),
      force: a.refresh,
      localOnly: !a.refresh,
    });
    const messages = [...fetched].sort(compareMessagesNewestFirst);
    const last = messages.at(-1);
    return {
      chatMid: a.chatMid,
      messages,
      nextCursor: messages.length >= a.limit && last ? encodeCursor(scope, last, a.chatMid) : null,
      source: a.refresh ? "LINE history request" : "local_history",
      fetchedAt: Date.now(),
    };
  },
);
const searchFields = {
  accountId,
  chatMid: mid.optional(),
  fromTime: time.optional(),
  toTime: time.optional(),
  query: text.optional(),
  limit: count.default(50),
  cursor: z.string().max(4096).optional(),
};
for (const callsOnly of [false, true]) {
  define(
    callsOnly ? "get_missed_calls" : "search_messages",
    callsOnly
      ? "指定アカウントの保存済み通話履歴から不在着信を確認。chatMid・日時で絞れる。nextCursorがあれば結果が空でも続きがある。全LINE履歴の完全性は保証しない。"
      : "指定アカウントの保存履歴を本文・日時範囲（epochミリ秒、両端含む）で検索。nextCursorで指定範囲を最後まで取得。未保存のLINE履歴はget_messagesで取得する。",
    searchFields,
    false,
    async (a) => {
      if (a.fromTime !== undefined && a.toTime !== undefined && a.fromTime > a.toTime)
        throw new Error("Invalid time range");
      const scope = JSON.stringify([
        a.accountId,
        a.chatMid,
        a.fromTime,
        a.toTime,
        a.query,
        callsOnly,
      ]);
      const before = decodeCursor(a.cursor, scope);
      const rows = await queryPluginMessages(a.accountId, {
        ...a,
        callsOnly,
        before,
        limit: a.limit + 1,
      });
      const scanned = rows.slice(0, a.limit);
      const messages = callsOnly
        ? scanned.filter(
            (m) =>
              !m.isMyMessage &&
              parseCallMeta(m.contentType, m.contentMetadata ?? null, false).outcome === "missed",
          )
        : scanned;
      const last = scanned.at(-1);
      return {
        messages: messages.map((m) => ({
          ...m,
          ...(callsOnly
            ? { call: parseCallMeta(m.contentType, m.contentMetadata ?? null, m.isMyMessage) }
            : {}),
        })),
        nextCursor: rows.length > a.limit && last ? encodeCursor(scope, last, last.chatMid) : null,
        source: "local_history",
        scannedCount: scanned.length,
        completeLineHistory: false,
      };
    },
  );
}

define(
  "download_media",
  "受信・送信メッセージの画像・動画・音声・ファイルを取得。画像はChatGPTへ画像として返す。大容量はoffsetとlengthで分割。",
  {
    accountId,
    chatMid: mid,
    messageId: id,
    preview: z.boolean().default(true),
    offset: time.default(0),
    length: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024)
      .default(2 * 1024 * 1024),
  },
  false,
  async (a) => {
    const url = `http://vyline.internal/${encodeURIComponent(a.accountId)}/media/${a.chatMid}/${a.messageId}?preview=${a.preview ? "1" : "0"}`;
    const response = await lineRouter.fetch(
      new Request(url, { headers: { Range: `bytes=${a.offset}-${a.offset + a.length - 1}` } }),
    );
    if (!response.ok) throw new Error("Media unavailable");
    const mimeType = (response.headers.get("content-type") ?? "application/octet-stream").split(
      ";",
    )[0]!;
    const { bytes, total, more } = await readMediaSlice(response, a.offset, a.length);
    if (mimeType.startsWith("image/") && a.offset === 0 && !more) {
      return {
        content: [{ type: "image", mimeType, data: bytes.toString("base64") }],
        structuredContent: {
          accountId: a.accountId,
          chatMid: a.chatMid,
          messageId: a.messageId,
          bytes: bytes.length,
          mimeType,
        },
      } satisfies CallToolResult;
    }
    return {
      dataBase64: bytes.toString("base64"),
      mimeType,
      offset: a.offset,
      totalBytes: total,
      nextOffset: more ? a.offset + bytes.length : null,
    };
  },
);

const uploads = [
  ["send_image", "画像を指定トークへ送信", "/send-media"],
  ["send_media", "画像・動画・音声・ファイルを指定トークへ送信", "/send-media"],
  ["update_profile_image", "自身のプロフィール画像を変更", "/profile/image"],
  ["update_profile_background", "自身のプロフィール背景を変更", "/profile/background"],
  ["update_group_picture", "グループの画像を変更", "/chats/:chatMid/picture"],
  ["upload_note_media", "ノート用メディアをアップロード", "/notes/media/:type"],
  ["upload_note_comment_image", "ノートコメント用画像をアップロード", "/notes/comment-image"],
  ["upload_album_media", "アルバム用写真をアップロード", "/albums/:albumId/media"],
  [
    "upload_media_batch_item",
    "一括送信用アイテムをアップロード",
    "/send-media-batch/:uploadId/items/:index",
  ],
  [
    "upload_android_backup_chunk",
    "Androidバックアップの分割データをアップロード",
    "/restore/android-backup/chunked/:uploadId/chunks/:index",
  ],
  ["append_recording_chunk", "通話記録の分割データを追記", "/recordings/:id/chunks"],
] as const;
for (const [name, description, path] of uploads) {
  const isMessage = path === "/send-media";
  define(
    name,
    `${description}。sourceに実ファイルのbase64または許可されたHTTPSダウンロードURLを指定。URL/ファイルを推測しない。${name === "append_recording_chunk" ? "最大512KiB。" : name === "upload_android_backup_chunk" ? "start_android_backup_uploadが返すchunkSizeに従う。" : "最大8MiB。"}`,
    {
      accountId,
      source: uploadSource,
      mimeType: z.enum([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "audio/webm",
        "audio/mpeg",
        "audio/mp4",
        "application/pdf",
        "application/octet-stream",
      ]),
      filename: z
        .string()
        .max(128)
        .regex(/^[^/\\\r\n]+$/)
        .default("upload"),
      ...(isMessage || path.includes(":chatMid") ? { chatMid: mid } : {}),
      ...(path.includes(":albumId") ? { albumId: id, chatId: mid } : {}),
      ...(path.includes(":type") ? { type: z.enum(["image", "video"]) } : {}),
      ...(path.includes(":uploadId") ? { uploadId: id, index: z.number().int().min(0) } : {}),
      ...(name === "append_recording_chunk" ? { id, offset: time } : {}),
      ...(isMessage ? { durationMs: time.optional() } : {}),
    },
    true,
    async (a) => {
      if (
        (name === "send_image" ||
          name.includes("picture") ||
          name.includes("profile") ||
          name.includes("comment_image")) &&
        !a.mimeType.startsWith("image/")
      )
        throw new Error("Image required");
      const bytes = await fetchUpload(a.source);
      const target = path.replace(/:([A-Za-z]+)/g, (_, key: string) =>
        encodeURIComponent(String((a as Record<string, unknown>)[key])),
      );
      const url = new URL(`/${encodeURIComponent(a.accountId)}${target}`, "http://vyline.internal");
      if (a.chatId) url.searchParams.set("chatId", String(a.chatId));
      const headers = new Headers({
        "content-type": a.mimeType,
        "X-Vyline-Media-Filename": encodeURIComponent(a.filename),
      });
      headers.set(
        "X-Vyline-Media-Type",
        a.mimeType.startsWith("image/")
          ? "image"
          : a.mimeType.startsWith("video/")
            ? "video"
            : a.mimeType.startsWith("audio/")
              ? "audio"
              : "file",
      );
      if (isMessage) {
        headers.set("X-Vyline-Chat-Mid", String(a.chatMid));
        headers.set(
          "X-Vyline-Media-Type",
          a.mimeType.startsWith("image/")
            ? "image"
            : a.mimeType.startsWith("video/")
              ? "video"
              : a.mimeType.startsWith("audio/")
                ? "audio"
                : "file",
        );
        if (a.durationMs !== undefined)
          headers.set("X-Vyline-Media-Duration", String(a.durationMs));
      }
      if (name === "append_recording_chunk") headers.set("x-recording-offset", String(a.offset));
      return lineRequest(
        new Request(url, {
          method: name === "append_recording_chunk" ? "PUT" : "POST",
          headers,
          body: new Uint8Array(bytes),
        }),
      );
    },
  );
}
for (const kind of ["recording", "album"] as const) {
  define(
    `download_${kind}_media`,
    "指定アカウントの記録・アルバムのバイナリを取得。offset/lengthとnextOffsetで分割取得。",
    {
      accountId,
      ...(kind === "recording"
        ? { recordingId: id }
        : {
            albumId: id,
            oid: id,
            chatId: mid,
            mediaType: z.enum(["image", "video"]).default("image"),
          }),
      offset: time.default(0),
      length: z
        .number()
        .int()
        .min(1)
        .max(2 * 1024 * 1024)
        .default(2 * 1024 * 1024),
    },
    false,
    async (a) => {
      const path =
        "recordingId" in a
          ? `/recordings/${a.recordingId}/file`
          : `/albums/${a.albumId}/media/${a.oid}?chatId=${a.chatId}&mediaType=${a.mediaType}`;
      const response = await lineRouter.fetch(
        new Request(`http://vyline.internal/${encodeURIComponent(a.accountId)}${path}`, {
          headers: { Range: `bytes=${a.offset}-${a.offset + a.length - 1}` },
        }),
      );
      if (!response.ok) throw new Error("Media unavailable");
      const { bytes, more, total } = await readMediaSlice(response, a.offset, a.length);
      return {
        dataBase64: bytes.toString("base64"),
        mimeType: response.headers.get("content-type"),
        offset: a.offset,
        totalBytes: total,
        nextOffset: more ? a.offset + bytes.length : null,
      };
    },
  );
}

const authTools = [
  ["start_qr_login", "QRログインを開始。LINE端末での認証が必要。", "POST", "/login/qr"],
  ["get_qr_login", "QRログインのURL・PIN・状態。", "GET", "/login/qr"],
  ["start_content_login", "ノート・アルバム用QRログインを開始。", "POST", "/content/qr"],
  ["get_content_login", "コンテンツ用QRログインのURL・PIN・状態。", "GET", "/content/qr"],
  ["restore_session", "保存済み認証から指定アカウントのセッションを復元。", "POST", "/restore"],
  [
    "start_email_login",
    "指定アカウントをメールで認証。LINE端末のPIN確認が必要な場合がある。",
    "POST",
    "/login/email",
  ],
  ["get_email_login", "メール認証の状態とPIN。", "GET", "/login/email"],
  [
    "delete_saved_session",
    "指定アカウントの保存済み認証を削除。logout=trueなら稼働中セッションも終了。",
    "DELETE",
    "/sessions",
  ],
  ["logout_account", "指定アカウントをログアウトし認証を削除。", "DELETE", "/accounts"],
] as const;
for (const [name, description, method, path] of authTools) {
  define(
    name,
    description,
    {
      accountId,
      ...(name === "start_email_login" ? { email: z.email(), password: text } : {}),
      ...(name === "delete_saved_session" ? { logout: z.boolean().default(false) } : {}),
    },
    method !== "GET",
    async (a) => {
      const suffix =
        method === "GET" || method === "DELETE" ? `/${encodeURIComponent(a.accountId)}` : "";
      const url = new URL(`${path}${suffix}`, "http://vyline.internal");
      if (name === "delete_saved_session") url.searchParams.set("logout", a.logout ? "1" : "0");
      const response = await authRouter.fetch(
        new Request(url, {
          method,
          ...(method === "POST"
            ? { headers: { "content-type": "application/json" }, body: JSON.stringify(a) }
            : {}),
        }),
      );
      return response.json();
    },
  );
}
for (const write of [false, true]) {
  define(
    write ? "update_account_settings" : "get_account_settings",
    write
      ? "指定アカウントのVyline設定を更新。get_account_settingsで現行スキーマを確認して指定。"
      : "指定アカウントのVyline設定を取得。",
    { accountId, ...(write ? { settings: z.record(z.string(), z.unknown()) } : {}) },
    write,
    async (a) => {
      const ownMid =
        getClient(a.accountId)?.base.profile?.mid ??
        (await listSavedSessions()).find((s) => s.accountId === a.accountId)?.mid;
      if (!ownMid) throw new Error("Account profile unavailable");
      const response = await accountSettingsRouter.request(
        `/${ownMid}`,
        write
          ? {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(a.settings),
            }
          : undefined,
      );
      return response.json();
    },
  );
}

// Metadata can contain E2EE key material even on otherwise harmless message reads.
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return typeof value === "bigint" ? String(value) : value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/token|secret|password|passphrase|keymaterial|privatekey|sharedsecret|authorization|cookie|^route$|^raw$|^chunks$/i.test(
            key,
          ),
      )
      .map(([key, item]) => [key, sanitize(item)]),
  );
}
export function listTools(token: ApiToken): Tool[] {
  return [...definitions.values()]
    .filter((d) => token.scopes.includes(d.tool.annotations?.readOnlyHint ? "read" : "write"))
    .map((d) => d.tool);
}
export async function executeTool(
  token: ApiToken,
  name: string,
  input: unknown,
): Promise<CallToolResult> {
  const definition = definitions.get(name);
  if (!definition) return result({ ok: false, code: "UNKNOWN_TOOL" }, true);
  const write = !definition.tool.annotations?.readOnlyHint;
  let selected: string | undefined;
  try {
    if (!token.scopes.includes(write ? "write" : "read"))
      return result({ ok: false, code: "SCOPE_DENIED" }, true);
    const parsed = definition.schema.parse(input);
    selected = parsed.accountId as string | undefined;
    if (name !== "list_accounts") {
      if (!selected || !tokenAllowsAccount(token, selected))
        return result({ ok: false, code: "ACCOUNT_DENIED" }, true);
    }
    const value = await definition.execute(parsed, token);
    if (
      name === "download_media" &&
      value &&
      typeof value === "object" &&
      "content" in value &&
      "structuredContent" in value
    )
      return value as CallToolResult;
    const safe = sanitize(value);
    const failed = !!safe && typeof safe === "object" && "ok" in safe && safe.ok === false;
    return result({ accountId: selected ?? null, data: safe }, failed);
  } catch (error) {
    return result(
      {
        ok: false,
        accountId: selected ?? null,
        code: error instanceof z.ZodError ? "INVALID_ARGUMENTS" : "OPERATION_FAILED",
        ...(error instanceof z.ZodError
          ? { fields: error.issues.map((i) => ({ path: i.path, message: i.message })) }
          : {}),
        ...(write
          ? {
              warning:
                "If execution was interrupted, the write may have completed. Check the resulting state before retrying.",
            }
          : {}),
      },
      true,
    );
  }
}
function result(data: Record<string, unknown>, isError = false): CallToolResult {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > MAX_RESULT_BYTES)
    return {
      isError: true,
      content: [
        { type: "text", text: "Result too large. Narrow the query or request a smaller page." },
      ],
    };
  return { isError, content: [{ type: "text", text: serialized }], structuredContent: data };
}
