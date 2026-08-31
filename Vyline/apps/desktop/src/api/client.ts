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
  AccountSettings,
  BackupStorageUsage,
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

export interface AgentIHistoryItem {
  role: "user" | "assistant";
  text: string;
}

export interface BinaryMediaUploadItem {
  body: Blob;
  mimeType?: string;
  filename?: string;
  mediaType?: "image" | "video" | "audio" | "file" | "gif";
}

const BASE = "/api";
const SUBDEVICE_INSTALLATION_ID_KEY = "vyline:subdevice-installation-id";
const INSTALLATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSubdeviceInstallationId(): string | null {
  if (typeof localStorage === "undefined" || typeof crypto?.getRandomValues !== "function")
    return null;
  const existing = localStorage.getItem(SUBDEVICE_INSTALLATION_ID_KEY);
  if (existing && INSTALLATION_ID_RE.test(existing)) return existing;
  // randomUUID is unavailable on plain HTTP LAN origins. getRandomValues is
  // still cryptographically secure there; generate the same UUID v4 format.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const created = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  localStorage.setItem(SUBDEVICE_INSTALLATION_ID_KEY, created);
  return created;
}

/** バックエンド未起動時は TypeError(ECONNREFUSED) が飛ぶ → 静かに失敗 */
function isBackendDown(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    (String(err).includes("fetch") ||
      String(err).includes("ECONNREFUSED") ||
      String(err).includes("NetworkError"))
  );
}

function responseExcerpt(text: string, maxLength = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function responseLabel(res: Response): string {
  const contentType = res.headers.get("content-type")?.split(";", 1)[0]?.trim();
  return `HTTP ${res.status}${contentType ? ` / ${contentType}` : ""}`;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? `サーバーが空の応答を返しました（${responseLabel(res)}）`
        : `サーバーエラー（${responseLabel(res)}）。backend / reverse proxy のログを確認してください`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `サーバーがJSONではない応答を返しました（${responseLabel(res)}）: ${responseExcerpt(text)}`,
    );
  }
}

async function readHttpError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      const message = typeof parsed.error === "string" ? parsed.error : parsed.message;
      if (typeof message === "string" && message.trim()) return message;
    } catch {
      const excerpt = responseExcerpt(text);
      if (excerpt) return `${fallback}（${responseLabel(res)}）: ${excerpt}`;
    }
  }
  return `${fallback}（${responseLabel(res)}）`;
}

async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sessionToken =
    typeof localStorage !== "undefined" ? localStorage.getItem("vyline:subdevice-session") : null;
  const installationId = getSubdeviceInstallationId();
  const headers = new Headers(init.headers);
  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  if (installationId && !headers.has("X-Vyline-Installation-Id")) {
    headers.set("X-Vyline-Installation-Id", installationId);
  }

  try {
    return await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (err) {
    if (isBackendDown(err)) throw new Error("BACKEND_DOWN");
    throw new Error(`backend に接続できません（backend が起動しているか確認）: ${String(err)}`);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: HeadersInit,
): Promise<T> {
  const hasBody = body !== undefined;
  const headers = new Headers(extraHeaders);
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await backendFetch(path, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse<T>(res);
}

async function uploadBinary<T>(path: string, body: Blob, extraHeaders?: HeadersInit): Promise<T> {
  const headers = new Headers(extraHeaders);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  const res = await backendFetch(path, { method: "POST", headers, body });
  if (res.status === 413) {
    throw new Error(
      "リバースプロキシがアップロードchunkを拒否しました（HTTP 413）。Nginx の client_max_body_size が 512 KiB 未満になっていないか確認してください。",
    );
  }
  return parseJsonResponse<T>(res);
}

function binaryMediaHeaders(
  body: Blob,
  metadata: Omit<BinaryMediaUploadItem, "body">,
  chatMid?: string,
): Headers {
  const headers = new Headers({
    "Content-Type": metadata.mimeType || body.type || "application/octet-stream",
  });
  if (chatMid) headers.set("X-Vyline-Chat-Mid", chatMid);
  if (metadata.filename) {
    headers.set("X-Vyline-Media-Filename", encodeURIComponent(metadata.filename));
  }
  if (metadata.mediaType) headers.set("X-Vyline-Media-Type", metadata.mediaType);
  return headers;
}

async function uploadMediaBinary<T>(
  path: string,
  item: BinaryMediaUploadItem,
  chatMid?: string,
): Promise<T> {
  const res = await backendFetch(path, {
    method: "POST",
    headers: binaryMediaHeaders(item.body, item, chatMid),
    body: item.body,
  });
  return parseJsonResponse<T>(res);
}

async function uploadAndroidBackupChunked(
  accountId: string,
  file: File,
  includeMedia: boolean,
  onProgress?: (uploadedBytes: number, totalBytes: number) => void,
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
  const basePath = `/line/${accountId}/restore/android-backup/chunked`;
  const init = await request<{
    ok: boolean;
    uploadId?: string;
    chunkSize?: number;
    error?: string;
  }>("POST", basePath, {
    sourceName: file.name || "naver_line",
    includeMedia,
    expectedBytes: file.size,
  });
  if (!init.ok || !init.uploadId) {
    throw new Error(init.error ?? "Androidバックアップの分割アップロードを開始できませんでした");
  }

  const chunkSize = Math.min(768 * 1024, Math.max(64 * 1024, Number(init.chunkSize ?? 512 * 1024)));
  try {
    let index = 0;
    for (let offset = 0; offset < file.size; offset += chunkSize, index += 1) {
      const end = Math.min(file.size, offset + chunkSize);
      const chunk = file.slice(offset, end);
      let lastError: unknown = null;
      let uploaded = false;
      for (let attempt = 1; attempt <= 3 && !uploaded; attempt += 1) {
        try {
          const response = await uploadBinary<{
            ok: boolean;
            receivedBytes?: number;
            expectedBytes?: number;
            error?: string;
          }>(`${basePath}/${encodeURIComponent(init.uploadId)}/chunks/${index}`, chunk);
          if (!response.ok) {
            throw new Error(response.error ?? `chunk ${index} の送信に失敗しました`);
          }
          onProgress?.(response.receivedBytes ?? end, file.size);
          uploaded = true;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
          }
        }
      }
      if (!uploaded) {
        throw lastError instanceof Error
          ? lastError
          : new Error(`chunk ${index} の送信に失敗しました`);
      }
    }

    return await request<{ ok: boolean; sessionId?: string; error?: string }>(
      "POST",
      `${basePath}/${encodeURIComponent(init.uploadId)}/complete`,
    );
  } finally {
    // Completion removes the upload session; failures release temporary space.
    await request("DELETE", `${basePath}/${encodeURIComponent(init.uploadId)}`).catch(
      () => undefined,
    );
  }
}

async function requestBlob<T>(method: string, path: string, blob: Blob): Promise<T> {
  const headers = new Headers({
    "Content-Type": blob.type || "application/octet-stream",
  });
  const res = await backendFetch(path, { method, headers, body: blob });
  if (!res.ok) {
    throw new Error(await readHttpError(res, `HTTP ${res.status}`));
  }
  return parseJsonResponse<T>(res);
}

// ─── api ──────────────────────────────────────

export const api = {
  subdevices: {
    createPairing: (accountId: string, origin?: string) =>
      request<{
        ok: boolean;
        token?: string;
        expiresAt?: number;
        pairingUrl?: string;
        lanAccessRequired?: boolean;
        error?: string;
      }>("POST", "/auth/subdevices/pairing", { accountId, origin }),
    list: () =>
      request<{
        ok: boolean;
        devices?: Array<{
          id: string;
          accountId: string;
          name: string;
          platform: "ios" | "android" | "web" | "unknown";
          createdAt: string;
          lastSeenAt: string | null;
          blocked: boolean;
        }>;
      }>("GET", "/auth/subdevices"),
    remove: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/auth/subdevices/${encodeURIComponent(id)}`),
    block: (id: string) =>
      request<{ ok: boolean }>("POST", `/auth/subdevices/${encodeURIComponent(id)}/block`),
    unblock: (id: string) =>
      request<{ ok: boolean }>("DELETE", `/auth/subdevices/${encodeURIComponent(id)}/block`),
    pairingInfo: (token: string) =>
      request<{ ok: boolean; expiresAt?: number }>(
        "GET",
        `/auth/subdevices/pairing/${encodeURIComponent(token)}`,
      ),
    complete: (token: string, name: string, platform: "ios" | "android" | "web" | "unknown") =>
      request<{
        ok: boolean;
        sessionToken?: string;
        device?: { accountId: string };
        error?: string;
      }>("POST", `/auth/subdevices/pairing/${encodeURIComponent(token)}/complete`, {
        name,
        platform,
      }),
    heartbeat: (sessionToken: string) =>
      request<{ ok: boolean; device?: { accountId: string } }>(
        "POST",
        "/auth/subdevices/heartbeat",
        undefined,
        {
          Authorization: `Bearer ${sessionToken}`,
        },
      ),
  },
  agentI: {
    chat: (accountId: string, prompt: string, history?: AgentIHistoryItem[]) =>
      request<{ ok: boolean; text?: string; error?: string }>(
        "POST",
        `/beta/agent-i/${encodeURIComponent(accountId)}/chat`,
        { prompt, history },
      ),
    reset: (accountId: string) =>
      request<{ ok: boolean }>("DELETE", `/beta/agent-i/${encodeURIComponent(accountId)}/session`),
  },
  auth: {
    loginEmail: (params: { accountId: string; email: string; password: string }) =>
      request<LoginResult>("POST", "/auth/login/email", params),

    loginEmailPoll: (accountId: string) =>
      request<EmailPollResponse>("GET", `/auth/login/email/${encodeURIComponent(accountId)}`),

    loginQrStart: (accountId: string) =>
      request<LoginResult>("POST", "/auth/login/qr", { accountId }),

    loginQrPoll: (accountId: string) =>
      request<QrPollResponse>("GET", `/auth/login/qr/${encodeURIComponent(accountId)}`),

    contentQrStart: (accountId: string) =>
      request<LoginResult>("POST", "/auth/content/qr", { accountId }),

    contentQrPoll: (accountId: string) =>
      request<QrPollResponse>("GET", `/auth/content/qr/${encodeURIComponent(accountId)}`),

    loginToken: (params: {
      accountId: string;
      authToken: string;
      deviceMode?: "IOS" | "IOSIPAD" | "ANDROIDSECONDARY" | "DESKTOPWIN" | "DESKTOPMAC";
    }) => request<LoginResult>("POST", "/auth/login/token", params),

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
      request<{ ok: boolean }>("DELETE", `/auth/accounts/${encodeURIComponent(accountId)}`),
  },

  line: {
    profile: (accountId: string) => request<ProfileResponse>("GET", `/line/${accountId}/profile`),

    bootstrap: (accountId: string) =>
      request<BootstrapResponse>("GET", `/line/${accountId}/bootstrap`),

    chats: (accountId: string, opts?: { light?: boolean; refresh?: boolean; force?: boolean }) => {
      const q = new URLSearchParams();
      if (opts?.light) q.set("light", "1");
      if (opts?.refresh) q.set("refresh", "1");
      if (opts?.force) q.set("force", "1");
      const qs = q.toString();
      return request<ChatsResponse>("GET", `/line/${accountId}/chats${qs ? `?${qs}` : ""}`);
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
    exportMessages: async (accountId: string, chatMid: string, format: "json" | "txt" = "json") => {
      const res = await backendFetch(
        `/line/${accountId}/export/${encodeURIComponent(chatMid)}?format=${format}`,
      );
      if (!res.ok) throw new Error(await readHttpError(res, "export failed"));
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
      opts?: {
        relatedMessageId?: string;
        contentMetadata?: Record<string, string>;
        mute?: boolean;
      },
    ) =>
      request<SendResponse>("POST", `/line/${accountId}/send`, {
        chatMid,
        text,
        ...opts,
      }),

    sendMedia: (
      accountId: string,
      chatMid: string,
      body: Blob,
      opts?: {
        mimeType?: string;
        filename?: string;
        mediaType?: BinaryMediaUploadItem["mediaType"];
      },
    ) =>
      uploadMediaBinary<SendResponse>(
        `/line/${accountId}/send-media`,
        {
          body,
          ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
          ...(opts?.filename ? { filename: opts.filename } : {}),
          ...(opts?.mediaType ? { mediaType: opts.mediaType } : {}),
        },
        chatMid,
      ),

    sendMediaBatch: async (
      accountId: string,
      chatMid: string,
      items: Iterable<BinaryMediaUploadItem> | AsyncIterable<BinaryMediaUploadItem>,
      itemCount: number,
    ) => {
      const start = await request<{
        ok: boolean;
        uploadId?: string;
        maxItemBytes?: number;
        error?: string;
      }>("POST", `/line/${accountId}/send-media-batch/start`, {
        chatMid,
        itemCount,
      });
      if (!start.ok || !start.uploadId) {
        return { ok: false, error: start.error ?? "一括送信を開始できませんでした" };
      }
      const uploadId = start.uploadId;
      try {
        let index = 0;
        for await (const item of items) {
          if (index >= itemCount) {
            return { ok: false, error: "送信項目数が開始時の件数を超えています" };
          }
          const uploaded = await uploadMediaBinary<{
            ok: boolean;
            receivedBytes?: number;
            receivedItems?: number;
            expectedItems?: number;
            error?: string;
          }>(
            `/line/${accountId}/send-media-batch/${encodeURIComponent(uploadId)}/items/${index}`,
            item,
          );
          if (!uploaded.ok) {
            return { ok: false, error: uploaded.error ?? `${index + 1}件目の送信に失敗しました` };
          }
          index++;
        }
        if (index !== itemCount) {
          return { ok: false, error: `送信項目数が一致しません（${index}/${itemCount}）` };
        }
        return await request<{ ok: boolean; count?: number; error?: string }>(
          "POST",
          `/line/${accountId}/send-media-batch/${encodeURIComponent(uploadId)}/complete`,
        );
      } finally {
        await request(
          "DELETE",
          `/line/${accountId}/send-media-batch/${encodeURIComponent(uploadId)}`,
        ).catch(() => undefined);
      }
    },

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
        `/line/${accountId}/combination-stickers/can-create`,
        { packageIds },
      ),

    isStickerAvailableForCombinationSticker: (accountId: string, packageId: string) =>
      request<{ ok: boolean; availableForCombinationSticker: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/combination-stickers/available`,
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
        `/line/${accountId}/combination-stickers`,
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

    restoreRevokedMessage: (accountId: string, chatMid: string, messageId: string) =>
      request<{ ok: true; text?: string | null; contentType?: string }>(
        "POST",
        `/line/${accountId}/restore?chatMid=${encodeURIComponent(chatMid)}`,
        { messageId },
      ),

    editMessage: (accountId: string, chatMid: string, messageId: string, text: string) =>
      request<EditResponse>("POST", `/line/${accountId}/edit`, { chatMid, messageId, text }),

    editNotice: (accountId: string, chatMid: string) =>
      request<EditNoticeResponse>("GET", `/line/${accountId}/edit-notice/${chatMid}`),

    messageHistory: (accountId: string, chatMid: string, messageId: string) =>
      request<{ ok: true; history: Message["history"] }>(
        "GET",
        `/line/${accountId}/messages/${encodeURIComponent(chatMid)}/${encodeURIComponent(messageId)}/history`,
      ),

    /** 相手ユーザーのプロフィール取得 (アイコン URL 用) */
    contactProfile: (accountId: string, targetMid: string) =>
      request<ProfileResponse>("GET", `/line/${accountId}/contact/${targetMid}`),

    /** Vyline プロフィール/グループキャッシュ */
    vylineCache: (accountId: string) =>
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

    vylineStorage: (accountId: string) =>
      request<{
        ok: boolean;
        driveLetter?: string;
        dataPath?: string;
        storagePath?: string;
        dataSize?: number;
        storageSize?: number;
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

    clearVylineCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache`,
      ),

    clearVylineCdnCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache/cdn`,
      ),

    clearVylineIconCache: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/cache/icons`,
      ),

    clearVylineSavedMedia: (accountId: string) =>
      request<{ ok: boolean; removed?: number; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/saved-media`,
      ),

    clearVylineSavedMediaType: (accountId: string, type: string) =>
      request<{ ok: boolean; removed?: number; type?: string; error?: string }>(
        "DELETE",
        `/line/${accountId}/vyline/saved-media/${type}`,
      ),

    vylineWarm: (accountId: string, mids: string[]) =>
      request<{ ok: boolean; profiles?: Record<string, unknown>; count?: number; error?: string }>(
        "POST",
        `/line/${accountId}/vyline/warm`,
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

    commonGroups: (accountId: string, targetMid: string, excludeChatId?: string) =>
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

    updateProfile: (
      accountId: string,
      body: {
        displayName?: string;
        statusMessage?: string;
        phoneticName?: string;
        musicProfile?: string;
      },
    ) => request<ProfileResponse>("PATCH", `/line/${accountId}/profile`, body),

    updateProfileImage: async (accountId: string, image: Blob, mime = "image/jpeg") => {
      const res = await backendFetch(`/line/${encodeURIComponent(accountId)}/profile/image`, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: image,
      });
      return parseJsonResponse<ProfileResponse & { objId?: string }>(res);
    },

    updateProfileBackground: async (accountId: string, image: Blob, mime = "image/jpeg") => {
      const res = await backendFetch(`/line/${encodeURIComponent(accountId)}/profile/background`, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: image,
      });
      return parseJsonResponse<{
        ok: boolean;
        objId?: string;
        backgroundUrl?: string;
        error?: string;
      }>(res);
    },

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

    getChatLocks: (accountId: string) =>
      request<{ ok: boolean; chatMids?: string[]; error?: string }>(
        "GET",
        `/line/${accountId}/chat-locks`,
      ),

    setChatLocked: (accountId: string, chatMid: string, locked: boolean) =>
      request<{ ok: boolean; locked?: boolean; chatMids?: string[]; error?: string }>(
        "PUT",
        `/line/${accountId}/chat-locks/${encodeURIComponent(chatMid)}`,
        { locked },
      ),

    plugins: (accountId: string) =>
      request<{
        plugins: Array<{
          id: string;
          name: string;
          version: string;
          description?: string;
          permissions?: string[];
          loadable: boolean;
          enabled: boolean;
          active: boolean;
        }>;
      }>("GET", `/line/${accountId}/plugins`),

    setPluginEnabled: (accountId: string, pluginId: string, enabled: boolean) =>
      request<{ ok: boolean; enabled?: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/plugins/${encodeURIComponent(pluginId)}/${enabled ? "enable" : "disable"}`,
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

    verifyFriendBlockStatus: (accountId: string, mid?: string) =>
      request<{
        ok: boolean;
        results?: Array<{
          mid: string;
          status: "blocked" | "not_blocked" | "skipped" | "unknown";
          reason: string;
          official: boolean;
        }>;
        error?: string;
      }>("POST", `/line/${accountId}/block-verification`, mid ? { mid } : {}),

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

    setNotification: (accountId: string, enable: boolean) =>
      request<{ ok: boolean; masterEnable?: boolean; error?: string }>(
        "POST",
        `/line/${accountId}/notifications`,
        { enable },
      ),

    /** 既読にする */
    markAsRead: (accountId: string, chatMid: string, lastMessageId?: string) =>
      request<{ ok: boolean }>("POST", `/line/${accountId}/read`, {
        chatMid,
        lastMessageId,
      }),

    markAllAsRead: (accountId: string, chatMids?: string[]) =>
      request<{ ok: boolean; count?: number }>("POST", `/line/${accountId}/read-all`, {
        chatMids,
      }),

    markReadBatch: (
      accountId: string,
      targets: Array<{ chatMid: string; lastMessageId: string }>,
    ) =>
      request<{ ok: boolean; count?: number }>("POST", `/line/${accountId}/read-batch`, {
        targets,
      }),

    /** 自分の送信メッセージの既読状態（軽量） */
    readReceipts: (
      accountId: string,
      chatMid: string,
      messageIds: string[],
      opts?: { force?: boolean },
    ) =>
      request<ReadReceiptsResponse>(
        "GET",
        `/line/${accountId}/read-receipts/${encodeURIComponent(chatMid)}?ids=${messageIds.map(encodeURIComponent).join(",")}${opts?.force ? "&force=1" : ""}`,
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
            deviceId: string;
            backupDate: string;
            restoredAt: string;
            extracted: { lineFiles: number; databases: number };
            parsed: { chats: number; totalMessages: number };
            restoredChatMids: string[];
            media: { restored: number; skipped: number };
          } | null;
          error: string | null;
          startedAt: number;
          completedAt: number | null;
        } | null;
        error?: string;
      }>("GET", `/line/${accountId}/restore/ios-backup/${encodeURIComponent(sessionId)}`),

    /** Android naver_line DB / LEINs ZIP から履歴復元を開始 */
    startAndroidBackupRestore: (
      accountId: string,
      file: File,
      includeMedia = false,
      onProgress?: (uploadedBytes: number, totalBytes: number) => void,
    ) => uploadAndroidBackupChunked(accountId, file, includeMedia, onProgress),

    /** Android DB 復元セッションのステータス取得 */
    getAndroidBackupSession: (accountId: string, sessionId: string) =>
      request<{
        ok: boolean;
        session?: {
          id: string;
          accountId: string;
          sourceName: string;
          includeMedia: boolean;
          status: "pending" | "running" | "completed" | "failed";
          progress: {
            stage: string;
            current: number;
            total: number;
            message: string;
            file?: string;
          } | null;
          result: {
            sourceName: string;
            sourceKind: "sqlite" | "zip";
            databaseVersion: number;
            restoredAt: string;
            parsed: {
              chats: number;
              totalMessages: number;
              reactions: number;
              unsupportedReactions: number;
            };
            restoredChatMids: string[];
            merged: {
              importedChats: number;
              skippedChats: number;
              importedMessages: number;
              skippedMessages: number;
            };
            media: { restored: number; skipped: number };
          } | null;
          error: string | null;
          startedAt: number;
          completedAt: number | null;
        } | null;
        error?: string;
      }>("GET", `/line/${accountId}/restore/android-backup/${encodeURIComponent(sessionId)}`),

    /** VylineBackup: チャット一覧 + メッセージ件数（選択 UI 用） */
    backupChats: (accountId: string) =>
      request<{
        ok: boolean;
        data?: Array<{ mid: string; name: string; messageCount: number }>;
        error?: string;
      }>("GET", `/line/${accountId}/backup/chats`),

    backupCreate: (accountId: string, opts: { chatMids?: string[]; includeMedia?: boolean }) =>
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

    backupStorage: (accountId: string) =>
      request<{
        ok: boolean;
        storage?: BackupStorageUsage;
        android?: { maxUploadBytes: number; maxExtractBytes: number };
        error?: string;
      }>("GET", `/line/${encodeURIComponent(accountId)}/backup/storage`),

    backupList: (accountId: string) =>
      request<{
        ok: boolean;
        storage?: BackupStorageUsage;
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

    backupRestore: (
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

    backupDelete: (accountId: string, backupId: string) =>
      request<{ ok: boolean; error?: string }>(
        "DELETE",
        `/line/${accountId}/backup/${encodeURIComponent(backupId)}`,
      ),

    /** チャット内容・アナウンスのタイミング付き詳細ログ（メディア対応） */
    messageLog: (accountId: string, limit?: number) =>
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

    callStart: (accountId: string, to: string, callType: CallType = "AUDIO") =>
      request<CallStartResponse>("POST", `/line/${accountId}/call/start`, { to, callType }),

    callEnd: (accountId: string, sessionId: string) =>
      request<{ ok: boolean; error?: string }>("POST", `/line/${accountId}/call/end`, {
        sessionId,
      }),

    callStatus: (accountId: string, sessionId: string) =>
      request<CallStatusResponse>(
        "GET",
        `/line/${accountId}/call/status?sessionId=${encodeURIComponent(sessionId)}`,
      ),

    callActive: (accountId: string) =>
      request<CallActiveResponse>("GET", `/line/${accountId}/call/active`),

    groupCall: (accountId: string, chatMid: string, callType: "AUDIO" | "VIDEO" = "AUDIO") =>
      request<CallRouteResponse>("POST", `/line/${accountId}/call`, {
        chatMid,
        callType,
        kind: "group",
      }),

    groupCallStatus: (accountId: string, chatMid: string) =>
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
      warm: (accountId: string, app: "ladder" | "schedule" | "poll", chatMid: string) =>
        request<{ ok: boolean }>("POST", `/line/${accountId}/liff/warm`, { app, chatMid }),
    },
    ladder: {
      members: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/ladder/members/${encodeURIComponent(chatMid)}`,
        ),
      generate: (accountId: string, chatMid: string, memberIds: string[], options: string[]) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/ladder/generate`, {
          chatMid,
          memberIds,
          options,
        }),
      result: (accountId: string, chatMid: string, hash: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/ladder/result/${encodeURIComponent(chatMid)}/${hash}`,
        ),
      message: (accountId: string, chatMid: string, hash: string) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/ladder/message`, {
          chatMid,
          hash,
        }),
    },

    schedule: {
      create: (
        accountId: string,
        chatMid: string,
        data: { name: string; description?: string; candidates: number[]; pictureId?: number },
      ) =>
        request<{ ok: boolean; data: unknown }>("POST", `/line/${accountId}/schedule/events`, {
          chatMid,
          ...data,
        }),
      answer: (
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
      share: (
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
      event: (accountId: string, chatMid: string, eventId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/events/${eventId}/${encodeURIComponent(chatMid)}`,
        ),
      groups: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/groups/${encodeURIComponent(chatMid)}`,
        ),
      group: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/schedule/group/${encodeURIComponent(chatMid)}`,
        ),
    },

    poll: {
      create: (
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
      vote: (accountId: string, chatMid: string, questionId: string, choiceIds: string[]) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/poll/${questionId}/vote`,
          {
            chatMid,
            choiceIds,
          },
        ),
      question: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/${questionId}/${encodeURIComponent(chatMid)}`,
        ),
      close: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "GET",
          `/line/${accountId}/poll/${questionId}/close/${encodeURIComponent(chatMid)}`,
        ),
      announce: (accountId: string, chatMid: string, questionId: string) =>
        request<{ ok: boolean; data: unknown }>(
          "POST",
          `/line/${accountId}/poll/${questionId}/announce`,
          {
            chatMid,
          },
        ),
    },

    announce: {
      list: (accountId: string, chatMid: string) =>
        request<{ ok: boolean; data: Announcement[] }>(
          "GET",
          `/line/${accountId}/announcements/${encodeURIComponent(chatMid)}`,
        ),
      create: (accountId: string, chatMid: string, text: string, messageId?: string) =>
        request<{ ok: boolean; data: { announcementSeq: string } }>(
          "POST",
          `/line/${accountId}/announcements`,
          { chatMid, text, messageId },
        ),
      remove: (accountId: string, chatMid: string, seq: string) =>
        request<{ ok: boolean; data: unknown }>(
          "DELETE",
          `/line/${accountId}/announcements/${encodeURIComponent(chatMid)}/${seq}`,
        ),
    },

    notes: {
      list: (accountId: string, homeId: string) =>
        request<unknown>("GET", `/line/${accountId}/notes?homeId=${encodeURIComponent(homeId)}`),
      updates: (accountId: string, revision: number) =>
        request<unknown>(
          "POST",
          `/line/${accountId}/notes/updates?revision=${encodeURIComponent(String(revision))}`,
        ),
      get: (accountId: string, homeId: string, postId: string) =>
        request<unknown>(
          "GET",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}?homeId=${encodeURIComponent(homeId)}`,
        ),
      create: (
        accountId: string,
        input: {
          homeId: string;
          text?: string;
          sharedPostId?: string;
          stickerIds?: string[];
          stickerPackageIds?: string[];
          mediaObjectIds?: string[];
          mediaObjectTypes?: string[];
          contents?: Record<string, unknown>;
          postInfo?: Record<string, unknown>;
        },
      ) => request<unknown>("POST", `/line/${accountId}/notes`, input),
      update: (
        accountId: string,
        postId: string,
        input: {
          homeId: string;
          text?: string;
          sharedPostId?: string;
          stickerIds?: string[];
          stickerPackageIds?: string[];
          mediaObjectIds?: string[];
          mediaObjectTypes?: string[];
          contents?: Record<string, unknown>;
          postInfo?: Record<string, unknown>;
        },
      ) =>
        request<unknown>("PATCH", `/line/${accountId}/notes/${encodeURIComponent(postId)}`, input),
      remove: (accountId: string, homeId: string, postId: string) =>
        request<unknown>(
          "DELETE",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}?homeId=${encodeURIComponent(homeId)}`,
        ),
      share: (accountId: string, postId: string, homeId: string) =>
        request<unknown>("POST", `/line/${accountId}/notes/${encodeURIComponent(postId)}/share`, {
          homeId,
        }),
      like: (accountId: string, postId: string, homeId: string, likeType?: string) =>
        request<unknown>("POST", `/line/${accountId}/notes/${encodeURIComponent(postId)}/like`, {
          homeId,
          likeType,
        }),
      unlike: (accountId: string, postId: string, homeId: string) =>
        request<unknown>(
          "DELETE",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}/like?homeId=${encodeURIComponent(homeId)}`,
        ),
      getLike: (accountId: string, postId: string, homeId: string) =>
        request<unknown>(
          "GET",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}/like?homeId=${encodeURIComponent(homeId)}`,
        ),
      listLikes: (accountId: string, postId: string, homeId: string) =>
        request<unknown>(
          "GET",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}/likes?homeId=${encodeURIComponent(homeId)}`,
        ),
      comment: (
        accountId: string,
        postId: string,
        homeId: string,
        text?: string,
        imageObjectId?: string,
      ) =>
        request<unknown>(
          "POST",
          `/line/${accountId}/notes/${encodeURIComponent(postId)}/comments`,
          {
            homeId,
            text,
            imageObjectId,
          },
        ),
      uploadMedia: (accountId: string, type: "image" | "video", blob: Blob) =>
        requestBlob<{ objId: string; objHash: string }>(
          "POST",
          `/line/${accountId}/notes/media/${type}`,
          blob,
        ),
      uploadCommentImage: (accountId: string, blob: Blob) =>
        requestBlob<{ objId: string; objHash: string }>(
          "POST",
          `/line/${accountId}/notes/comment-image`,
          blob,
        ),
    },

    albums: {
      list: (accountId: string, query: Record<string, string> = {}) => {
        const qs = new URLSearchParams(query).toString();
        return request<unknown>("GET", `/line/${accountId}/albums${qs ? `?${qs}` : ""}`);
      },
      preview: (accountId: string, chatId: string) =>
        request<unknown>(
          "GET",
          `/line/${accountId}/albums/preview?chatId=${encodeURIComponent(chatId)}`,
        ),
      create: (accountId: string, chatId: string, title: string) =>
        request<unknown>("POST", `/line/${accountId}/albums`, { chatId, title }),
      rename: (accountId: string, albumId: string, chatId: string, title: string) =>
        request<unknown>("PATCH", `/line/${accountId}/albums/${encodeURIComponent(albumId)}`, {
          chatId,
          title,
        }),
      remove: (accountId: string, albumId: string, chatId: string) =>
        request<unknown>(
          "DELETE",
          `/line/${accountId}/albums/${encodeURIComponent(albumId)}?chatId=${encodeURIComponent(chatId)}`,
        ),
      share: (accountId: string, albumId: string, chatId: string) =>
        request<unknown>("POST", `/line/${accountId}/albums/${encodeURIComponent(albumId)}/share`, {
          chatId,
        }),
      uploadMedia: (accountId: string, albumId: string, chatId: string, blob: Blob) =>
        requestBlob<{ oid: string }>(
          "POST",
          `/line/${accountId}/albums/${encodeURIComponent(albumId)}/media?chatId=${encodeURIComponent(chatId)}`,
          blob,
        ),
      addPhotos: (
        accountId: string,
        albumId: string,
        chatId: string,
        photos: Array<{
          obsResourceId: { oid: string; sid?: string; svc?: string };
          width: number;
          height: number;
          shotTime?: number;
          resourceType?: string;
        }>,
      ) =>
        request<unknown>(
          "POST",
          `/line/${accountId}/albums/${encodeURIComponent(albumId)}/photos`,
          { chatId, photos },
        ),
      deletePhotos: (accountId: string, albumId: string, chatId: string, photoIds: string[]) =>
        request<unknown>(
          "DELETE",
          `/line/${accountId}/albums/${encodeURIComponent(albumId)}/photos`,
          { chatId, photoIds },
        ),
      photos: (
        accountId: string,
        albumId: string,
        chatId: string,
        query: Record<string, string> = {},
      ) => {
        const qs = new URLSearchParams({ chatId, ...query }).toString();
        return request<unknown>(
          "GET",
          `/line/${accountId}/albums/${encodeURIComponent(albumId)}/photos?${qs}`,
        );
      },
      mediaUrl: (
        accountId: string,
        albumId: string,
        oid: string,
        chatId: string,
        mediaType: "image" | "video" = "image",
      ) =>
        `/api/line/${accountId}/albums/${encodeURIComponent(albumId)}/media/${encodeURIComponent(oid)}?${new URLSearchParams({ chatId, mediaType })}`,
    },
  },
  debug: {
    health: () => request<{ ok: boolean; uptime: number }>("GET", "/debug/health"),

    tokens: () => request<{ ok: boolean; tokens: Record<string, unknown> }>("GET", "/debug/tokens"),
  },
  settings: {
    account: (mid: string) =>
      request<{ ok: boolean; settings: AccountSettings }>(
        "GET",
        `/settings/accounts/${encodeURIComponent(mid)}`,
      ),
    saveAccount: (mid: string, settings: Partial<AccountSettings>) =>
      request<{ ok: boolean; settings: AccountSettings }>(
        "PUT",
        `/settings/accounts/${encodeURIComponent(mid)}`,
        settings,
      ),
    saveSetup: (mid: string, step: number, settings: Partial<AccountSettings>) =>
      request<{ ok: boolean; settings: AccountSettings }>(
        "PATCH",
        `/settings/accounts/${encodeURIComponent(mid)}/setup`,
        { step, settings },
      ),
  },
  handoff: {
    inspect: (mid: string, archiveBase64: string) =>
      request<{
        ok: boolean;
        error?: string;
        files?: string[];
        matchesCurrentAccount?: boolean;
        manifest?: {
          source: { platform: "desktop" | "web"; appVersion: string; schemaVersion: number };
          createdAt: string;
        };
      }>("POST", `/handoff/${encodeURIComponent(mid)}/inspect`, { archiveBase64 }),
    export: (mid: string) =>
      request<{ ok: boolean; filename: string; archiveBase64: string; manifest: unknown }>(
        "POST",
        `/handoff/${encodeURIComponent(mid)}/export`,
        {},
        { "x-vyline-platform": "desktop" },
      ),
    import: (mid: string, archiveBase64: string, mode: "overwrite" | "merge" | "cancel") =>
      request<{ ok: boolean; imported: string[]; manifest: unknown }>(
        "POST",
        `/handoff/${encodeURIComponent(mid)}/import`,
        { archiveBase64, mode },
      ),
  },
  diagnostics: {
    list: (mid: string) =>
      request<{ ok: boolean; entries: unknown[]; error?: string }>(
        "GET",
        `/diagnostics/${encodeURIComponent(mid)}`,
      ),
    clear: (mid: string) =>
      request<{ ok: boolean; error?: string }>("DELETE", `/diagnostics/${encodeURIComponent(mid)}`),
    export: (mid: string) =>
      request<{ ok: boolean; content: string; error?: string }>(
        "GET",
        `/diagnostics/${encodeURIComponent(mid)}/export`,
      ),
  },
};
