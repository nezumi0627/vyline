/**
 * api/client.ts
 *
 * backend への HTTP クライアント。
 * Vite の proxy 経由で /api/* → http://localhost:3001/* に転送される。
 * 型は @vyline/types から import する。
 */

import type {
  ProfileResponse,
  ChatsResponse,
  BootstrapResponse,
  MessagesResponse,
  MessagesDeltaResponse,
  EventsPollResponse,
  ReadReceiptsResponse,
  SendResponse,
  UnsendResponse,
  AccountsResponse,
  SessionsResponse,
  LoginResult,
  QrPollResponse,
  EmailPollResponse,
  CallRouteResponse,
  CallStartResponse,
  CallStatusResponse,
  CallActiveResponse,
  CallType,
} from "@vyline/types";

// re-export for convenience
export type { LineProfile } from "@vyline/types";

const BASE = "/api";

/** バックエンド未起動時は TypeError(ECONNREFUSED) が飛ぶ → 静かに失敗 */
function isBackendDown(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (String(err).includes("fetch") || String(err).includes("ECONNREFUSED") || String(err).includes("NetworkError"))
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (isBackendDown(err)) {
      throw new Error("BACKEND_DOWN");
    }
    throw new Error(
      `backend に接続できません（:3001 が起動しているか確認）: ${String(err)}`,
    );
  }

  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? "サーバーが空の応答を返しました"
        : `サーバーエラー HTTP ${res.status}（backend のログを確認）`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`サーバー応答の解析に失敗しました: ${text.slice(0, 120)}`);
  }
}

// ─── api ──────────────────────────────────────

export const api = {
  auth: {
    loginEmail: (params: { accountId: string; email: string; password: string }) =>
      request<LoginResult>("POST", "/auth/login/email", params),

    loginEmailPoll: (accountId: string) =>
      request<EmailPollResponse>("GET", `/auth/login/email/${accountId}`),

    loginQrStart: (accountId: string) =>
      request<LoginResult>("POST", "/auth/login/qr", { accountId }),

    loginQrPoll: (accountId: string) =>
      request<QrPollResponse>("GET", `/auth/login/qr/${accountId}`),

    restore: (accountId: string) =>
      request<LoginResult>("POST", "/auth/restore", { accountId }),

    accounts: () =>
      request<AccountsResponse>("GET", "/auth/accounts"),

    sessions: () =>
      request<SessionsResponse>("GET", "/auth/sessions"),

    deleteSession: (accountId: string, opts?: { logout?: boolean }) =>
      request<{ ok: boolean }>(
        "DELETE",
        `/auth/sessions/${encodeURIComponent(accountId)}${opts?.logout ? "?logout=1" : ""}`,
      ),

    deleteAccount: (accountId: string) =>
      request<{ ok: boolean }>("DELETE", `/auth/accounts/${accountId}`),
  },

  line: {
    profile: (accountId: string) =>
      request<ProfileResponse>("GET", `/line/${accountId}/profile`),

    bootstrap: (accountId: string) =>
      request<BootstrapResponse>("GET", `/line/${accountId}/bootstrap`),

    chats: (accountId: string, opts?: { light?: boolean; refresh?: boolean; force?: boolean }) => {
      const q = new URLSearchParams();
      if (opts?.light) q.set("light", "1");
      if (opts?.refresh) q.set("refresh", "1");
      if (opts?.force) q.set("force", "1");
      const qs = q.toString();
      return request<ChatsResponse>(
        "GET",
        `/line/${accountId}/chats${qs ? `?${qs}` : ""}`,
      );
    },

    messages: (
      accountId: string,
      chatMid: string,
      limit = 30,
      opts?: {
        beforeMessageId?: string;
        beforeDeliveredTime?: number;
        force?: boolean;
        local?: boolean;
      },
    ) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (opts?.beforeMessageId) q.set("beforeMessageId", opts.beforeMessageId);
      if (opts?.beforeDeliveredTime != null) {
        q.set("beforeDeliveredTime", String(opts.beforeDeliveredTime));
      }
      if (opts?.force) q.set("force", "1");
      if (opts?.local) q.set("local", "1");
      return request<MessagesResponse>(
        "GET",
        `/line/${accountId}/messages/${encodeURIComponent(chatMid)}?${q}`,
      );
    },

    /** チャット履歴を JSON / TXT でダウンロード（復号済み） */
    exportMessages: async (
      accountId: string,
      chatMid: string,
      format: "json" | "txt" = "json",
    ) => {
      const res = await fetch(
        `${BASE}/line/${accountId}/export/${encodeURIComponent(chatMid)}?format=${format}`,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `vyline-export.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },

    send: (
      accountId: string,
      chatMid: string,
      text: string,
      opts?: { relatedMessageId?: string; contentMetadata?: Record<string, string> },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send`, {
        chatMid,
        text,
        ...opts,
      }),

    sendMedia: (
      accountId: string,
      chatMid: string,
      dataBase64: string,
      opts?: { mimeType?: string; filename?: string; mediaType?: string },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send-media`, {
        chatMid,
        dataBase64,
        ...opts,
      }),

    sendSticker: (
      accountId: string,
      chatMid: string,
      opts: { packageId: string; stickerId: string; isPremium?: boolean },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send-sticker`, {
        chatMid,
        ...opts,
      }),

    sendEmoji: (
      accountId: string,
      chatMid: string,
      opts: { packageId: string; sticonId: string },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send-emoji`, {
        chatMid,
        ...opts,
      }),

    stickers: (accountId: string) =>
      request<{
        ok: boolean;
        error?: string;
        premium?: {
          active: boolean;
          planType?: string | number;
          validUntil?: number;
          onFreeTrial?: boolean;
          willExpire?: boolean;
        };
        stickerPacks?: Array<{
          packageId: string;
          name: string;
          type: "sticker" | "emoji";
          tabUrl: string;
          items: Array<{ id: string; url: string; alt?: string; animated?: boolean }>;
        }>;
        emojiPacks?: Array<{
          packageId: string;
          name: string;
          type: "sticker" | "emoji";
          tabUrl: string;
          items: Array<{ id: string; url: string; alt?: string; animated?: boolean }>;
        }>;
      }>("GET", `/line/${accountId}/stickers`),

    unsend: (accountId: string, messageId: string) =>
      request<UnsendResponse>("POST", `/line/${accountId}/unsend`, { messageId }),

    /** 相手ユーザーのプロフィール取得 (アイコン URL 用) */
    contactProfile: (accountId: string, targetMid: string) =>
      request<ProfileResponse>("GET", `/line/${accountId}/contact/${targetMid}`),

    /** Nezu プロフィール/グループキャッシュ */
    nezuCache: (accountId: string) =>
      request<{
        ok: boolean;
        profiles?: Record<
          string,
          {
            mid: string;
            displayName: string;
            thumbnailUrl?: string;
            statusMessage?: string;
            musicProfile?: string;
            birthday?: string;
            backgroundUrl?: string;
            updatedAt: number;
          }
        >;
        groups?: Record<string, unknown>;
        error?: string;
      }>("GET", `/line/${accountId}/nezu/cache`),

    nezuWarm: (accountId: string, mids: string[]) =>
      request<{ ok: boolean; count?: number; error?: string }>(
        "POST",
        `/line/${accountId}/nezu/warm`,
        { mids },
      ),

    chatMembers: (accountId: string, chatMid: string) =>
      request<{
        ok: boolean;
        chatMid?: string;
        name?: string;
        thumbnailUrl?: string;
        members?: Array<{
          mid: string;
          displayName: string;
          thumbnailUrl?: string;
          statusMessage?: string;
        }>;
        fromCache?: boolean;
        error?: string;
      }>("GET", `/line/${accountId}/chats/${encodeURIComponent(chatMid)}/members`),

    updateProfile: (
      accountId: string,
      body: {
        displayName?: string;
        statusMessage?: string;
        phoneticName?: string;
        musicProfile?: string;
        birthday?: { year?: string; day: string; yearEnabled?: boolean; dayEnabled?: boolean };
      },
    ) => request<ProfileResponse>("PATCH", `/line/${accountId}/profile`, body),

    updateProfileImage: (accountId: string, bytes: ArrayBuffer, mime = "image/jpeg") =>
      fetch(`${BASE}/line/${encodeURIComponent(accountId)}/profile/image`, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: bytes,
      }).then(async (res) => {
        const text = await res.text();
        return JSON.parse(text || "{}") as ProfileResponse & { objId?: string };
      }),

    updateProfileBackground: (accountId: string, bytes: ArrayBuffer, mime = "image/jpeg") =>
      fetch(`${BASE}/line/${encodeURIComponent(accountId)}/profile/background`, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: bytes,
      }).then(async (res) => {
        const text = await res.text();
        return JSON.parse(text || "{}") as { ok: boolean; objId?: string; error?: string };
      }),

    renameContact: (accountId: string, mid: string, displayNameOverride: string | null) =>
      request<{ ok: boolean; error?: string }>(
        "PATCH",
        `/line/${accountId}/contacts/${encodeURIComponent(mid)}`,
        { displayNameOverride },
      ),

    leaveChat: (accountId: string, chatMid: string) =>
      request<{ ok: boolean; error?: string; alreadyLeft?: boolean }>(
        "POST",
        `/line/${accountId}/chats/${encodeURIComponent(chatMid)}/leave`,
      ),

    blockContact: (accountId: string, mid: string) =>
      request<{ ok: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/contacts/${encodeURIComponent(mid)}/block`,
      ),

    unblockContact: (accountId: string, mid: string) =>
      request<{ ok: boolean; error?: string }>(
        "DELETE",
        `/line/${accountId}/contacts/${encodeURIComponent(mid)}/block`,
      ),

    blockedContacts: (accountId: string) =>
      request<{ ok: boolean; mids?: string[]; error?: string }>(
        "GET",
        `/line/${accountId}/blocked`,
      ),

    createGroup: (accountId: string, name: string, memberMids: string[]) =>
      request<{
        ok: boolean;
        chat?: { chatMid: string; name: string };
        error?: string;
        code?: string;
        createGroupBanned?: boolean;
      }>("POST", `/line/${accountId}/chats/create-group`, { name, memberMids }),

    featureLocks: (accountId: string) =>
      request<{
        ok: boolean;
        locks?: {
          createGroupBanned: boolean;
          createGroupBannedAt: string | null;
          createGroupBannedReason: string | null;
        };
      }>("GET", `/line/${accountId}/feature-locks`),

    clearCreateGroupBan: (accountId: string) =>
      request<{
        ok: boolean;
        locks?: {
          createGroupBanned: boolean;
          createGroupBannedAt: string | null;
          createGroupBannedReason: string | null;
        };
      }>("DELETE", `/line/${accountId}/feature-locks/create-group-ban`),

    inviteToGroup: (accountId: string, chatMid: string, memberMids: string[]) =>
      request<{ ok: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/chats/${encodeURIComponent(chatMid)}/invite`,
        { memberMids },
      ),

    getProxy: (accountId: string) =>
      request<{ ok: boolean; proxy?: { enabled: boolean; url: string } }>(
        "GET",
        `/line/${accountId}/proxy`,
      ),

    setProxy: (accountId: string, enabled: boolean, url: string) =>
      request<{ ok: boolean; proxy?: { enabled: boolean; url: string }; error?: string }>(
        "PUT",
        `/line/${accountId}/proxy`,
        { enabled, url },
      ),

    react: (
      accountId: string,
      messageId: string,
      reaction: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG" | "UNDO",
    ) =>
      request<{ ok: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/messages/${encodeURIComponent(messageId)}/react`,
        { reaction },
      ),

    runIndex: (accountId: string) =>
      request<{ ok: boolean; chats?: number; messages?: number; error?: string }>(
        "POST",
        `/line/${accountId}/index`,
      ),

    /** 既読にする */
    markAsRead: (accountId: string, chatMid: string, lastMessageId?: string) =>
      request<{ ok: boolean }>("POST", `/line/${accountId}/read`, {
        chatMid,
        lastMessageId,
      }),

    /** 自分の送信メッセージの既読状態（軽量） */
    readReceipts: (accountId: string, chatMid: string, messageIds: string[]) =>
      request<ReadReceiptsResponse>(
        "GET",
        `/line/${accountId}/read-receipts/${encodeURIComponent(chatMid)}?ids=${messageIds.map(encodeURIComponent).join(",")}`,
      ),

    /** Talk Push バッファから新着取得 */
    pollEvents: (accountId: string, cursor = 0) =>
      request<EventsPollResponse>(
        "GET",
        `/line/${accountId}/events/poll?cursor=${encodeURIComponent(String(cursor))}`,
      ),

    /** after より新しいメッセージ（fallback） */
    messagesDelta: (accountId: string, chatMid: string, afterMessageId: string, limit = 25) =>
      request<MessagesDeltaResponse>(
        "GET",
        `/line/${accountId}/messages/${encodeURIComponent(chatMid)}/delta?after=${encodeURIComponent(afterMessageId)}&limit=${limit}`,
      ),

    /** Desktop E2EE 鍵などから復元 */
    restoreDesktop: (accountId: string) =>
      request<{
        ok: boolean;
        error?: string;
        imported?: number;
        skipped?: number;
        keyIds?: number[];
        seededPublicKeys?: number;
        hint?: string;
        identity?: { ok?: boolean; reason?: string; matchedKeyIds?: number[] };
      }>("POST", `/line/${accountId}/restore/desktop`),

    restoreStatus: (accountId: string) =>
      request<{
        ok: boolean;
        mid?: string | null;
        desktopInstalled?: boolean;
        desktopVersion?: string | null;
        keysFile?: string | null;
        keysFileExists?: boolean;
        dumpKeyCount?: number;
        dumpExtractedAt?: string | null;
        serverKeyCount?: number;
        localMatchedServerKeys?: number;
        error?: string;
      }>("GET", `/line/${accountId}/restore/status`),

    call: (accountId: string, to: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
      request<CallRouteResponse>("POST", `/line/${accountId}/call`, { to, callType, kind: "direct" }),

    callStart: (accountId: string, to: string, callType: CallType = "AUDIO") =>
      request<CallStartResponse>("POST", `/line/${accountId}/call/start`, { to, callType }),

    callEnd: (accountId: string, sessionId: string) =>
      request<{ ok: boolean; error?: string }>("POST", `/line/${accountId}/call/end`, { sessionId }),

    callStatus: (accountId: string, sessionId: string) =>
      request<CallStatusResponse>("GET", `/line/${accountId}/call/status?sessionId=${encodeURIComponent(sessionId)}`),

    callActive: (accountId: string) =>
      request<CallActiveResponse>("GET", `/line/${accountId}/call/active`),

    groupCall: (accountId: string, chatMid: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
      request<CallRouteResponse>("POST", `/line/${accountId}/call`, { chatMid, callType, kind: "group" }),
  },

  debug: {
    health: () =>
      request<{ ok: boolean; uptime: number }>("GET", "/debug/health"),

    tokens: () =>
      request<{ ok: boolean; tokens: Record<string, unknown> }>(
        "GET",
        "/debug/tokens",
      ),
  },
};
