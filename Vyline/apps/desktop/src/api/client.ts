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
  EditResponse,
  EditNoticeResponse,
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
  Message,
} from "@vyline/types";

// re-export for convenience
export type { LineProfile } from "@vyline/types";

export interface Announcement {
  announcementSeq: string;
  text: string;
  link: string;
  creatorMid: string;
  createdTime: number;
}

const BASE = "/api";

/** バックエンド未起動時は TypeError(ECONNREFUSED) が飛ぶ → 静かに失敗 */
function isBackendDown(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (String(err).includes("fetch") ||
      String(err).includes("ECONNREFUSED") ||
      String(err).includes("NetworkError"))
  );
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    throw new Error(`backend に接続できません（:3001 が起動しているか確認）: ${String(err)}`);
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

    loginToken: (params: { accountId: string; authToken: string }) =>
      request<LoginResult>("POST", "/auth/login/token", params),

    getToken: (accountId: string) =>
      request<{ ok: boolean; token?: string; error?: string }>(
        "GET",
        `/auth/token/${encodeURIComponent(accountId)}`,
      ),

    restore: (accountId: string) => request<LoginResult>("POST", "/auth/restore", { accountId }),

    switch_: (accountId: string) =>
      request<{ ok: boolean; accountId: string; restored?: boolean; error?: string }>(
        "POST",
        `/auth/switch/${encodeURIComponent(accountId)}`,
      ),

    accounts: () => request<AccountsResponse>("GET", "/auth/accounts"),

    sessions: () => request<SessionsResponse>("GET", "/auth/sessions"),

    deleteSession: (accountId: string, opts?: { logout?: boolean }) =>
      request<{ ok: boolean }>(
        "DELETE",
        `/auth/sessions/${encodeURIComponent(accountId)}${opts?.logout ? "?logout=1" : ""}`,
      ),

    deleteAccount: (accountId: string) =>
      request<{ ok: boolean }>("DELETE", `/auth/accounts/${accountId}`),
  },

  line: {
    getProfile: (accountId: string) =>
      request<ProfileResponse>("GET", `/line/${accountId}/getProfile`),

    bootstrap: (accountId: string) =>
      request<BootstrapResponse>("GET", `/line/${accountId}/bootstrap`),

    getMessageBoxes: (
      accountId: string,
      opts?: { light?: boolean; refresh?: boolean; force?: boolean },
    ) => {
      const q = new URLSearchParams();
      if (opts?.light) q.set("light", "1");
      if (opts?.refresh) q.set("refresh", "1");
      if (opts?.force) q.set("force", "1");
      const qs = q.toString();
      return request<ChatsResponse>(
        "GET",
        `/line/${accountId}/getMessageBoxes${qs ? `?${qs}` : ""}`,
      );
    },

    getPreviousMessagesV2WithRequest: (
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
        `/line/${accountId}/getPreviousMessagesV2WithRequest/${encodeURIComponent(chatMid)}?${q}`,
      );
    },

    /** チャット履歴を JSON / TXT でダウンロード（復号済み） */
    exportChat: async (accountId: string, chatMid: string, format: "json" | "txt" = "json") => {
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

    sendMessage: (
      accountId: string,
      chatMid: string,
      text: string,
      opts?: {
        relatedMessageId?: string;
        contentMetadata?: Record<string, string>;
        mute?: boolean;
      },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/sendMessage`, {
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

    sendMediaBatch: (
      accountId: string,
      chatMid: string,
      items: Array<{
        dataBase64: string;
        mimeType?: string;
        filename?: string;
        mediaType?: string;
      }>,
    ) =>
      request<{ ok: boolean; count?: number; error?: string }>(
        "POST",
        `/line/${accountId}/send-media-batch`,
        {
          chatMid,
          items,
        },
      ),

    sendSticker: (
      accountId: string,
      chatMid: string,
      opts: { packageId: string; stickerId: string; isPremium?: boolean },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send-sticker`, {
        chatMid,
        ...opts,
      }),

    canCreateCombinationSticker: (accountId: string, packageIds: string[]) =>
      request<{ ok: boolean; canCreate: boolean; usablePackageIds: string[]; error?: string }>(
        "POST",
        `/line/${accountId}/canCreateCombinationSticker`,
        { packageIds },
      ),

    isStickerAvailableForCombinationSticker: (accountId: string, packageId: string) =>
      request<{ ok: boolean; availableForCombinationSticker: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/isStickerAvailableForCombinationSticker`,
        { packageId },
      ),

    createCombinationSticker: (
      accountId: string,
      items: Array<{
        packageId: string;
        stickerId: string;
      }>,
      opts?: { idOfPreviousVersionOfCombinationSticker?: string },
    ) =>
      request<{ ok: boolean; id: string; error?: string }>(
        "POST",
        `/line/${accountId}/createCombinationSticker`,
        opts?.idOfPreviousVersionOfCombinationSticker
          ? {
              items,
              idOfPreviousVersionOfCombinationSticker: opts.idOfPreviousVersionOfCombinationSticker,
            }
          : { items },
      ),

    sendCombinationSticker: (
      accountId: string,
      chatMid: string,
      items: Array<{
        packageId: string;
        stickerId: string;
        x?: number;
        y?: number;
        size?: number;
      }>,
      opts?: { idOfPreviousVersionOfCombinationSticker?: string },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send-combination-sticker`, {
        chatMid,
        items,
        ...(opts?.idOfPreviousVersionOfCombinationSticker
          ? {
              idOfPreviousVersionOfCombinationSticker: opts.idOfPreviousVersionOfCombinationSticker,
            }
          : {}),
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

    getOwnedStickers: (accountId: string) =>
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

    unsendMessage: (accountId: string, messageId: string) =>
      request<UnsendResponse>("POST", `/line/${accountId}/unsendMessage`, { messageId }),

    restoreRevokedMessage: (accountId: string, chatMid: string, messageId: string) =>
      request<{ ok: true; text?: string | null; contentType?: string }>(
        "POST",
        `/line/${accountId}/restore?chatMid=${encodeURIComponent(chatMid)}`,
        { messageId },
      ),

    editMessage: (accountId: string, chatMid: string, messageId: string, text: string) =>
      request<EditResponse>("POST", `/line/${accountId}/edit`, { chatMid, messageId, text }),

    getEditNotice: (accountId: string, chatMid: string) =>
      request<EditNoticeResponse>("GET", `/line/${accountId}/edit-notice/${chatMid}`),

    getMessageHistory: (accountId: string, chatMid: string, messageId: string) =>
      request<{ ok: true; history: Message["history"] }>(
        "GET",
        `/line/${accountId}/messages/${encodeURIComponent(chatMid)}/${encodeURIComponent(messageId)}/history`,
      ),

    /** 相手ユーザーのプロフィール取得 (アイコン URL 用) */
    getContact: (accountId: string, targetMid: string) =>
      request<ProfileResponse>("GET", `/line/${accountId}/contact/${targetMid}`),

    /** Vyline プロフィール/グループキャッシュ */
    getVylineCache: (accountId: string) =>
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
      }>("GET", `/line/${accountId}/vyline/cache`),

    getVylineStorageInfo: (accountId: string) =>
      request<{
        ok: boolean;
        driveLetter?: string;
        disk?: { totalBytes: number; freeBytes: number; usedBytes: number };
        vylineTotal: number;
        cacheSize: number;
        savedMediaSize: number;
        cache: {
          cdn: number;
          icons: number;
        };
        savedMedia: {
          image: number;
          video: number;
          audio: number;
          file: number;
        };
        error?: string;
      }>("GET", `/line/${accountId}/vyline/storage`),

    clearCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache`,
      ),

    clearCdnCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache/cdn`,
      ),

    clearIconCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache/icons`,
      ),

    clearSavedMedia: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/saved-media`,
      ),

    clearSavedMediaByType: (accountId: string, type: string) =>
      request<{ ok: boolean; removed?: number; type?: string; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/saved-media/${type}`,
      ),

    warmCache: (accountId: string, mids: string[]) =>
      request<{ ok: boolean; profiles?: Record<string, unknown>; count?: number; error?: string }>(
        "POST",
        `/line/${accountId}/vyline/warm`,
        { mids },
      ),

    getChatMembers: (accountId: string, chatMid: string) =>
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

    updateChat: (accountId: string, chatMid: string, name: string) =>
      request<{ ok: boolean; error?: string }>(
        "PATCH",
        `/line/${accountId}/updateChat/${encodeURIComponent(chatMid)}`,
        { name },
      ),

    updateChatPicture: async (
      accountId: string,
      chatMid: string,
      bytes: ArrayBuffer,
      mime = "image/jpeg",
    ) => {
      const res = await fetch(
        `${BASE}/line/${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatMid)}/picture`,
        {
          method: "POST",
          headers: { "Content-Type": mime },
          body: bytes,
        },
      );
      const text = await res.text();
      const data = JSON.parse(text || "{}") as {
        ok: boolean;
        objId?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `updateChatPicture failed (${res.status})`);
      return data;
    },

    downloadMediaByE2EE: async (
      accountId: string,
      chatMid: string,
      messageId: string,
      preview = true,
    ): Promise<Blob> => {
      const res = await fetch(
        `${BASE}/line/${encodeURIComponent(accountId)}/media/${encodeURIComponent(chatMid)}/${encodeURIComponent(messageId)}?preview=${preview ? "1" : "0"}`,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `downloadMediaByE2EE failed (${res.status})`);
      }
      return await res.blob();
    },

    notes: {
      getNotes: (accountId: string, homeId: string) =>
        request<unknown>("GET", `/line/${accountId}/notes?homeId=${encodeURIComponent(homeId)}`),
      createNote: (accountId: string, homeId: string, text: string) =>
        request<unknown>("POST", `/line/${accountId}/notes`, { homeId, text }),
      getNoteDetail: (accountId: string, homeId: string, postId: string) =>
        request<unknown>(
          "GET",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}?homeId=${encodeURIComponent(homeId)}`,
        ),
      deleteNote: (accountId: string, homeId: string, postId: string) =>
        request<unknown>(
          "DELETE",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}?homeId=${encodeURIComponent(homeId)}`,
        ),
      shareNote: (accountId: string, homeId: string, postId: string, chatMid: string) =>
        request<unknown>("POST", `/line/${accountId}/notes/${encodeURIComponent(postId)}/share`, {
          homeId,
          chatMid,
        }),
    },

    plugins: {
      listPlugins: (accountId: string) =>
        request<{
          plugins: Array<{
            id: string;
            name?: string;
            version?: string;
            enabled: boolean;
            [key: string]: unknown;
          }>;
          runtimePending: boolean;
        }>("GET", `/line/${accountId}/plugins`),
      controlPlugin: (accountId: string, pluginId: string, action: "enable" | "disable") =>
        request<{ ok: boolean; pluginId: string; enabled: boolean; error?: string }>(
          "POST",
          `/line/${accountId}/plugins/${encodeURIComponent(pluginId)}/${action}`,
        ),
    },

    getCommonGroupIds: (accountId: string, targetMid: string, excludeChatId?: string) =>
      request<{
        ok: boolean;
        groups?: Array<{
          chatMid: string;
          name: string;
          thumbnailUrl?: string;
          memberMids: string[];
        }>;
        error?: string;
      }>(
        "GET",
        `/line/${accountId}/common-groups/${encodeURIComponent(targetMid)}${
          excludeChatId ? `?exclude=${encodeURIComponent(excludeChatId)}` : ""
        }`,
      ),

    updateProfileAttributes: (
      accountId: string,
      body: {
        displayName?: string;
        statusMessage?: string;
        phoneticName?: string;
        musicProfile?: string;
      },
    ) => request<ProfileResponse>("PATCH", `/line/${accountId}/updateProfileAttributes`, body),

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
        return JSON.parse(text || "{}") as {
          ok: boolean;
          objId?: string;
          backgroundUrl?: string;
          error?: string;
        };
      }),

    updateContactSetting: (accountId: string, mid: string, displayNameOverride: string | null) =>
      request<{ ok: boolean; error?: string }>(
        "PATCH",
        `/line/${accountId}/updateContactSetting/${encodeURIComponent(mid)}`,
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
        `/line/${accountId}/blockContact/${encodeURIComponent(mid)}`,
      ),

    unblockContact: (accountId: string, mid: string) =>
      request<{ ok: boolean; error?: string }>(
        "DELETE",
        `/line/${accountId}/unblockContact/${encodeURIComponent(mid)}`,
      ),

    getBlockedContactIds: (accountId: string) =>
      request<{ ok: boolean; mids?: string[]; error?: string }>(
        "GET",
        `/line/${accountId}/getBlockedContactIds`,
      ),

    createChat: (accountId: string, name: string, memberMids: string[]) =>
      request<{
        ok: boolean;
        chat?: { chatMid: string; name: string };
        error?: string;
        code?: string;
        createGroupBanned?: boolean;
      }>("POST", `/line/${accountId}/createChat`, { name, memberMids }),

    getFeatureLocks: (accountId: string) =>
      request<{
        ok: boolean;
        locks?: {
          createGroupBanned: boolean;
          createGroupBannedAt: string | null;
          createGroupBannedReason: string | null;
        };
      }>("GET", `/line/${accountId}/feature-locks`),

    releaseCreateGroupBan: (accountId: string) =>
      request<{
        ok: boolean;
        locks?: {
          createGroupBanned: boolean;
          createGroupBannedAt: string | null;
          createGroupBannedReason: string | null;
        };
      }>("DELETE", `/line/${accountId}/feature-locks/create-group-ban`),

    inviteIntoChat: (accountId: string, chatMid: string, memberMids: string[]) =>
      request<{ ok: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/inviteIntoChat/${encodeURIComponent(chatMid)}`,
        { memberMids },
      ),

    getProxySettings: (accountId: string) =>
      request<{ ok: boolean; proxy?: { enabled: boolean; url: string } }>(
        "GET",
        `/line/${accountId}/proxy`,
      ),

    setProxySettings: (accountId: string, enabled: boolean, url: string) =>
      request<{ ok: boolean; proxy?: { enabled: boolean; url: string }; error?: string }>(
        "PUT",
        `/line/${accountId}/proxy`,
        { enabled, url },
      ),

    reactToMessage: (
      accountId: string,
      messageId: string,
      reaction: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG" | "UNDO",
    ) =>
      request<{ ok: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/messages/${encodeURIComponent(messageId)}/react`,
        { reaction },
      ),

    reindexMessages: (accountId: string) =>
      request<{ ok: boolean; chats?: number; messages?: number; error?: string }>(
        "POST",
        `/line/${accountId}/index`,
      ),

    setNotificationsEnabled: (accountId: string, enable: boolean) =>
      request<{ ok: boolean; masterEnable?: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/setNotificationsEnabled`,
        { enable },
      ),

    /** 既読にする */
    sendChatChecked: (accountId: string, chatMid: string, lastMessageId?: string) =>
      request<{ ok: boolean }>("POST", `/line/${accountId}/sendChatChecked`, {
        chatMid,
        lastMessageId,
      }),

    /** 自分の送信メッセージの既読状態（軽量） */
    getMessageReadRange: (accountId: string, chatMid: string, messageIds: string[]) =>
      request<ReadReceiptsResponse>(
        "GET",
        `/line/${accountId}/getMessageReadRange/${encodeURIComponent(chatMid)}?ids=${messageIds.map(encodeURIComponent).join(",")}`,
      ),

    /** Talk Push バッファから新着取得 */
    fetchOperations: (accountId: string, cursor = 0) =>
      request<EventsPollResponse>(
        "GET",
        `/line/${accountId}/fetchOperations?cursor=${encodeURIComponent(String(cursor))}`,
      ),

    /** after より新しいメッセージ（fallback） */
    getMessageDelta: (accountId: string, chatMid: string, afterMessageId: string, limit = 25) =>
      request<MessagesDeltaResponse>(
        "GET",
        `/line/${accountId}/messages/${encodeURIComponent(chatMid)}/delta?after=${encodeURIComponent(afterMessageId)}&limit=${limit}`,
      ),

    /** Desktop E2EE 鍵などから復元 */
    restoreFromDesktop: (accountId: string) =>
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

    getRestoreStatus: (accountId: string) =>
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

    /** iOS 暗号化バックアップのデバイス一覧を取得 */
    listIosBackups: (accountId: string) =>
      request<{
        ok: boolean;
        devices?: Array<{
          udid: string;
          name: string;
          iOSVersion: string;
          deviceType: string;
          encrypted: boolean;
          passcodeSet: boolean;
        }>;
        error?: string;
      }>("GET", `/line/${accountId}/ios-backups`),

    /** iOS 暗号化バックアップからの履歴復元を開始 */
    startIosBackupRestore: (accountId: string, udid: string, password: string) =>
      request<{
        ok: boolean;
        sessionId?: string;
        error?: string;
      }>("POST", `/line/${accountId}/restore/ios-backup`, { udid, password }),

    /** iOS バックアップ復元セッションのステータス取得 */
    getIosBackupSession: (accountId: string, sessionId: string) =>
      request<{
        ok: boolean;
        session?: {
          id: string;
          status: "pending" | "running" | "completed" | "failed";
          progress: {
            stage: string;
            current: number;
            total: number;
            message: string;
            file?: string;
          } | null;
          result: {
            extracted: { lineFiles: number; databases: number };
            parsed: { chats: number; totalMessages: number };
          } | null;
          error: string | null;
          startedAt: number;
          completedAt: number | null;
        } | null;
        error?: string;
      }>("GET", `/line/${accountId}/restore/ios-backup/${encodeURIComponent(sessionId)}`),

    /** VylineBackup: チャット一覧 + メッセージ件数（選択 UI 用） */
    listBackupChats: (accountId: string) =>
      request<{
        ok: boolean;
        data?: Array<{ mid: string; name: string; messageCount: number }>;
        error?: string;
      }>("GET", `/line/${accountId}/backup/chats`),

    createBackup: (accountId: string, opts: { chatMids?: string[]; includeMedia?: boolean }) =>
      request<{
        ok: boolean;
        summary?: {
          id: string;
          createdAt: string;
          accountId: string;
          chatCount: number;
          messageCount: number;
          mediaCount: number;
          includeMedia: boolean;
          sizeBytes: number;
        };
        error?: string;
      }>("POST", `/line/${accountId}/backup/create`, opts),

    listBackups: (accountId: string) =>
      request<{
        ok: boolean;
        data?: Array<{
          id: string;
          createdAt: string;
          accountId: string;
          chatCount: number;
          messageCount: number;
          mediaCount: number;
          includeMedia: boolean;
          sizeBytes: number;
        }>;
        error?: string;
      }>("GET", `/line/${accountId}/backup/list`),

    restoreBackup: (
      accountId: string,
      opts: { backupId: string; chatMids?: string[]; includeMedia?: boolean },
    ) =>
      request<{
        ok: boolean;
        restoredChats?: number;
        restoredMessages?: number;
        restoredMedia?: number;
        error?: string;
      }>("POST", `/line/${accountId}/backup/restore`, opts),

    deleteBackup: (accountId: string, backupId: string) =>
      request<{ ok: boolean; error?: string }>(
        "DELETE",
        `/line/${accountId}/backup/${encodeURIComponent(backupId)}`,
      ),

    /** チャット内容・アナウンスのタイミング付き詳細ログ（メディア対応） */
    getDebugLog: (accountId: string, limit?: number) =>
      request<{
        ok: boolean;
        data?: Array<{
          ts: string;
          tsMillis: number;
          accountId: string;
          kind: "message" | "announcement";
          direction: "in" | "out";
          chatMid: string;
          chatName?: string;
          senderMid: string;
          senderName?: string;
          contentType: string;
          text?: string | null;
          media?: {
            contentType: string;
            mediaId?: string;
            attachmentName?: string;
            durationMillis?: number;
            fileSize?: number;
            stickerId?: string;
            packageId?: string;
          };
          locKey?: string;
        }>;
        error?: string;
      }>("GET", `/line/${accountId}/log${limit ? `?limit=${limit}` : ""}`),

    call: (accountId: string, to: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
      request<CallRouteResponse>("POST", `/line/${accountId}/call`, {
        to,
        callType,
        kind: "direct",
      }),

    acquireCallRoute: (accountId: string, to: string, callType: CallType = "AUDIO") =>
      request<CallStartResponse>("POST", `/line/${accountId}/call/start`, { to, callType }),

    endCall: (accountId: string, sessionId: string) =>
      request<{ ok: boolean; error?: string }>("POST", `/line/${accountId}/call/end`, {
        sessionId,
      }),

    getCallStatus: (accountId: string, sessionId: string) =>
      request<CallStatusResponse>(
        "GET",
        `/line/${accountId}/call/status?sessionId=${encodeURIComponent(sessionId)}`,
      ),

    getActiveCall: (accountId: string) =>
      request<CallActiveResponse>("GET", `/line/${accountId}/call/active`),

    groupCall: (accountId: string, chatMid: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
      request<CallRouteResponse>("POST", `/line/${accountId}/call`, {
        chatMid,
        callType,
        kind: "group",
      }),

    getGroupCallStatus: (accountId: string, chatMid: string) =>
      request<{
        ok: boolean;
        online?: boolean;
        chatMid?: string;
        hostMid?: string;
        memberMids?: string[];
        mediaType?: string;
        error?: string;
      }>("GET", `/line/${accountId}/call/group-status?chatMid=${encodeURIComponent(chatMid)}`),

    // ── LIFF 機能 ──
    liff: {
      warmLiff: (accountId: string, app: "ladder" | "schedule" | "poll", chatMid: string) =>
        request<{ ok: boolean }>("POST", `/line/${accountId}/liff/warm`, { app, chatMid }),
    },
    ladder: {
      getLadderMembers: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/ladder/members/${encodeURIComponent(chatMid)}`,
        ),
      generateLadder: (
        accountId: string,
        chatMid: string,
        memberIds: string[],
        options: string[],
      ) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/ladder/generate`, {
          chatMid,
          memberIds,
          options,
        }),
      getLadderResult: (accountId: string, chatMid: string, hash: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/ladder/result/${encodeURIComponent(chatMid)}/${hash}`,
        ),
      sendLadderMessage: (accountId: string, chatMid: string, hash: string) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/ladder/message`, {
          chatMid,
          hash,
        }),
    },

    schedule: {
      createScheduleEvent: (
        accountId: string,
        chatMid: string,
        data: { name: string; description?: string; candidates: number[]; pictureId?: number },
      ) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/schedule/events`, {
          chatMid,
          ...data,
        }),
      answerScheduleEvent: (
        accountId: string,
        chatMid: string,
        eventId: string,
        answers: { candidate: number; status: string }[],
        comment?: string,
      ) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/schedule/events/${eventId}/answer`,
          { chatMid, answers, comment },
        ),
      shareScheduleEvent: (
        accountId: string,
        chatMid: string,
        eventId: string,
        groupEncIds: string[],
        comment?: string,
      ) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/schedule/events/${eventId}/share`,
          { chatMid, groupEncIds, comment },
        ),
      getScheduleEvent: (accountId: string, chatMid: string, eventId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/events/${eventId}/${encodeURIComponent(chatMid)}`,
        ),
      getGroupScheduleEvents: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/groups/${encodeURIComponent(chatMid)}`,
        ),
      getScheduleGroup: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/group/${encodeURIComponent(chatMid)}`,
        ),
      getFriendScheduleEvents: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/friends/${encodeURIComponent(chatMid)}`,
        ),
    },

    poll: {
      createPoll: (
        accountId: string,
        chatMid: string,
        data: {
          title: string;
          multiple?: boolean;
          anonymous?: boolean;
          closeDate?: number;
          choiceList: { text: string }[];
        },
      ) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/poll/create`, {
          chatMid,
          ...data,
        }),
      votePoll: (accountId: string, chatMid: string, questionId: string, choiceIds: string[]) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/poll/${questionId}/vote`,
          {
            chatMid,
            choiceIds,
          },
        ),
      getPoll: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/${questionId}/${encodeURIComponent(chatMid)}`,
        ),
      closePoll: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/${questionId}/close/${encodeURIComponent(chatMid)}`,
        ),
      announcePoll: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/poll/${questionId}/announce`,
          {
            chatMid,
          },
        ),
      getPollList: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/list/${encodeURIComponent(chatMid)}`,
        ),
      removePoll: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/${questionId}/remove/${encodeURIComponent(chatMid)}`,
        ),
      remindPoll: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/poll/${questionId}/remind`,
          { chatMid },
        ),
    },

    announce: {
      getChatRoomAnnouncements: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: Announcement[] }>(
          "GET",
          `/line/${accountId}/getChatRoomAnnouncements/${encodeURIComponent(chatMid)}`,
        ),
      createChatRoomAnnouncement: (
        accountId: string,
        chatMid: string,
        text: string,
        messageId?: string,
      ) =>
        request<{ ok: boolean; data: { announcementSeq: string } }>(
          "POST",
          `/line/${accountId}/createChatRoomAnnouncement`,
          { chatMid, text, messageId },
        ),
      removeChatRoomAnnouncement: (accountId: string, chatMid: string, seq: string) =>
        request<{ ok: boolean; data: unknown }>(
          "DELETE",
          `/line/${accountId}/removeChatRoomAnnouncement/${encodeURIComponent(chatMid)}/${seq}`,
        ),
    },
  },
  debug: {
    health: () => request<{ ok: boolean; uptime: number }>("GET", "/debug/health"),

    tokens: () => request<{ ok: boolean; tokens: Record<string, unknown> }>("GET", "/debug/tokens"),
  },
};
