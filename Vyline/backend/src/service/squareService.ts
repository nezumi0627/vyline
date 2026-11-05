import type { VylineClient } from "@vyline/protocol";
import { enums } from "../../../packages/line-types/line_types.js";
import type * as LINE from "../../../packages/line-types/line_types.ts";
import {
  SquareDisabledError,
  SquareRoomUnavailableError,
  SquareThreadNotJoinedError,
  withSquareEnabled,
} from "./squareFeatureGate.js";
import { getSquareStore, type SquareStore } from "../storage/squareStore.js";

const READ_LIMIT = 100;
const MAX_PAGES = 20;
const MAX_EVENT_PAGES_PER_REQUEST = 5;
const SQUARE_SEARCH_MIN_INTERVAL_MS = 1_000;
const ROOM_SEND_COOLDOWN_MS = 1_250;

export function buildSquareStickerContent(packageId: string, stickerId: string, premium = false) {
  if (!/^\d{1,20}$/.test(packageId) || !/^\d{1,20}$/.test(stickerId))
    throw new Error("invalid Square sticker identity");
  return {
    contentType: enums.ContentType.STICKER,
    contentMetadata: {
      STKPKGID: packageId,
      STKID: stickerId,
      STKVER: premium ? "100" : "1",
      STKOPT: premium ? "A" : "",
    },
  };
}

export function buildSquareThreadTextRequest(
  reqSeq: number,
  roomId: string,
  threadMid: string,
  text: string,
) {
  return {
    reqSeq,
    chatMid: roomId,
    threadMid,
    threadMessage: {
      message: {
        to: roomId,
        text,
        contentType: "NONE" as const,
        toType: "SQUARE_THREAD" as const,
      },
    },
  };
}

export function buildSquareReadRequest(roomId: string, messageId: string, threadMid?: string) {
  return {
    request: {
      squareChatMid: roomId,
      messageId,
      ...(threadMid ? { threadMid } : {}),
    },
  };
}

export function buildSquareReactionRequest(
  roomId: string,
  messageId: string,
  reaction: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG",
  threadMid?: string,
) {
  return {
    request: {
      reqSeq: 0,
      squareChatMid: roomId,
      messageId,
      reactionType: enums.MessageReactionType[reaction],
      ...(threadMid ? { threadMid } : {}),
    },
  };
}

function toJson(value: unknown): string {
  const result = JSON.stringify(value, (_name, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  if (typeof result !== "string") throw new Error("Square data is not serializable");
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asInt(value: unknown): number {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function extractSquareMessage(event: LINE.SquareEvent): LINE.SquareMessage | null {
  const payload = asRecord(event.payload);
  if (!payload) return null;
  for (const name of [
    "sendMessage",
    "receiveMessage",
    "notificationMessage",
    "notificationThreadMessage",
  ]) {
    const value = asRecord(payload[name]);
    const message = asRecord(value?.squareMessage);
    if (message?.message && typeof message.message === "object") {
      return message as unknown as LINE.SquareMessage;
    }
  }
  return null;
}

export function getSquareFeatureStore(accountId: string): SquareStore {
  return getSquareStore(accountId);
}

export async function setSquareFeatureEnabled(accountId: string, enabled: boolean) {
  const store = getSquareStore(accountId);
  store.setEnabled(enabled);
  return { ok: true as const, enabled };
}

export function getSquareFeatureStatus(accountId: string) {
  return { ok: true as const, enabled: getSquareStore(accountId).isEnabled() };
}

export function buildSquareCreateOptions(name: string, displayName: string, description?: string) {
  const squareName = name.trim();
  if (!squareName) throw new Error("invalid Square name");
  return {
    squareName,
    displayName: displayName.trim(),
    ...(description?.trim() ? { description: description.trim() } : {}),
    searchable: false,
    squareJoinMethodType: "CODE" as const,
  };
}

export async function createPrivateSquare(
  accountId: string,
  name: string,
  description: string,
  client: VylineClient,
) {
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    const generation = store.getGeneration();
    const profile = await client.base.talk.getProfile();
    if (!profile.displayName?.trim()) throw new Error("LINE profile display name is unavailable");
    const created = await client.base.square.createSquare(
      buildSquareCreateOptions(name, profile.displayName, description),
    );
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    const square = created.square;
    const room = created.squareChat;
    if (!square?.mid || !room?.squareChatMid || room.squareMid !== square.mid) {
      throw new Error("Square creation response did not include its room");
    }
    store.upsertEntity("square", square.mid, square);
    if (created.creator?.squareMemberMid) {
      store.upsertEntity("member", created.creator.squareMemberMid, created.creator, square.mid);
    }
    store.upsertEntity(
      "room",
      room.squareChatMid,
      {
        ...room,
        status: created.squareChatStatus,
      },
      square.mid,
    );
    return {
      ok: true as const,
      square: { mid: square.mid, name: square.name },
      room: { id: room.squareChatMid, name: room.name, parentSquareId: square.mid },
    };
  });
}

/** Return a stale cache only while the same enabled session is still active. */
export function readSquareCacheForGeneration(
  store: SquareStore,
  generation: number,
  roomId?: string,
  threadMid?: string,
) {
  if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
  const result = roomId
    ? {
        ok: true as const,
        messages: threadMid
          ? store
              .listMessages<{
                threadInfo?: { chatThreadMid?: string };
              }>(roomId, 200)
              .filter((item) => item.threadInfo?.chatThreadMid === threadMid)
              .slice(-100)
          : store.listMessages(roomId, 100),
      }
    : {
        ok: true as const,
        squares: store.listEntities<LINE.Square>("square"),
        rooms: store.listRooms(),
      };
  if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
  return result;
}

export async function loadSquareOverview(accountId: string, client: VylineClient) {
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    const generation = store.getGeneration();
    const squares: LINE.Square[] = [];
    let squareCursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await client.base.square.getJoinedSquares({
        limit: READ_LIMIT,
        ...(squareCursor ? { continuationToken: squareCursor } : {}),
      });
      if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
      squares.push(...(response.squares ?? []));
      for (const square of response.squares ?? []) store.upsertEntity("square", square.mid, square);
      for (const [id, member] of Object.entries(response.members ?? {})) {
        store.upsertEntity("member", id, member, member.squareMid);
      }
      squareCursor = response.continuationToken || undefined;
      if (!squareCursor || !response.squares?.length) break;
    }

    const rooms: LINE.SquareChat[] = [];
    let roomCursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await client.base.square.getJoinedSquareChats({
        request: { limit: READ_LIMIT, ...(roomCursor ? { continuationToken: roomCursor } : {}) },
      });
      if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
      rooms.push(...(response.chats ?? []));
      for (const room of response.chats ?? [])
        store.upsertRoom({
          id: room.squareChatMid,
          name: room.name,
          parentSquareId: room.squareMid,
        });
      for (const [id, member] of Object.entries(response.chatMembers ?? {})) {
        store.upsertEntity("member", id, member, member.squareChatMid);
      }
      for (const [id, status] of Object.entries(response.statuses ?? {})) {
        store.upsertEntity("room", id, {
          ...(response.chats ?? []).find((room) => room.squareChatMid === id),
          status,
        });
      }
      roomCursor = response.continuationToken || undefined;
      if (!roomCursor || !response.chats?.length) break;
    }

    return { ok: true as const, squares, rooms };
  });
}

export async function searchSquareCatalog(accountId: string, query: string, client: VylineClient) {
  if (query.trim().length < 2 || query.length > 100)
    throw new Error("Square search query must contain 2 to 100 characters");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    const generation = store.getGeneration();
    const retryAfterMs = store.reserveSquareSearch(Date.now(), SQUARE_SEARCH_MIN_INTERVAL_MS);
    if (retryAfterMs > 0)
      return { ok: false as const, error: "SQUARE_SEARCH_RATE_LIMIT", retryAfterMs };
    const response = await client.base.square.searchSquares({
      request: { query: query.trim(), continuationToken: "", limit: 20 },
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    for (const square of response.squares ?? []) store.upsertEntity("square", square.mid, square);
    return {
      ok: true as const,
      squares: response.squares ?? [],
      continuationToken: response.continuationToken || null,
    };
  });
}

export async function listSquareMessages(
  accountId: string,
  roomId: string,
  client: VylineClient,
  limit = 50,
  threadMid?: string,
) {
  if (!roomId || roomId.length > 512) throw new Error("invalid Square room id");
  if (threadMid !== undefined && (!threadMid || threadMid.length > 512))
    throw new Error("invalid Square thread id");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    if (
      threadMid &&
      !store
        .listMessages<{
          threadInfo?: { chatThreadMid?: string };
        }>(roomId, 200)
        .some((item) => item.threadInfo?.chatThreadMid === threadMid)
    ) {
      throw new Error("Square thread was not discovered in this room");
    }
    const generation = store.getGeneration();
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const stateKey = threadMid ? `thread:${roomId}:${threadMid}` : roomId;
    const roomCursor = store.getRoomSyncCursor(stateKey);
    let continuationToken = store.getRoomContinuationToken(stateKey);
    let nextSyncCursor = roomCursor;
    const events: LINE.SquareEvent[] = [];
    for (let page = 0; page < MAX_EVENT_PAGES_PER_REQUEST; page++) {
      const response = await client.base.square.fetchSquareChatEvents({
        squareChatMid: roomId,
        ...(threadMid ? { threadMid } : {}),
        ...(roomCursor ? { syncToken: roomCursor } : {}),
        ...(continuationToken ? { continuationToken } : {}),
        limit: boundedLimit,
      });
      if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
      events.push(...(response.events ?? []));
      nextSyncCursor = response.syncToken || nextSyncCursor;
      continuationToken = response.continuationToken || null;
      if (!continuationToken) break;
    }
    const messages: Array<{
      roomId: string;
      id: string;
      createdAt: number;
      revision: number;
      payload: unknown;
    }> = [];
    for (const event of events) {
      const squareMessage = extractSquareMessage(event);
      if (!squareMessage?.message?.id) continue;
      messages.push({
        roomId,
        id: squareMessage.message.id,
        createdAt: asInt(squareMessage.message.createdTime),
        revision: asInt(squareMessage.squareMessageRevision),
        payload: {
          eventType: event.type,
          state: squareMessage.state,
          threadInfo: squareMessage.threadInfo,
          message: squareMessage.message,
        },
      });
    }
    store.upsertMessages(messages);
    for (const event of events) {
      const destroyed = event.payload?.notifiedDestroyMessage;
      if (destroyed?.squareChatMid && destroyed.messageId) {
        store.markMessageDestroyed(
          destroyed.squareChatMid,
          destroyed.messageId,
          asInt(event.createdTime),
        );
      }
    }
    // Don't move the durable cursor until every continuation page was applied.
    // If capped, the next call resumes from the saved continuation token.
    store.setRoomSyncState(
      stateKey,
      continuationToken ? roomCursor : nextSyncCursor,
      continuationToken,
    );
    return {
      ok: true as const,
      roomId,
      messages: threadMid
        ? store
            .listMessages<{
              threadInfo?: { chatThreadMid?: string };
            }>(roomId, 200)
            .filter((item) => item.threadInfo?.chatThreadMid === threadMid)
            .slice(-boundedLimit)
        : store.listMessages(roomId, boundedLimit),
      continuationToken,
      threadMid: threadMid ?? null,
    };
  });
}

export async function markSquareMessageAsRead(
  accountId: string,
  roomId: string,
  messageId: string,
  client: VylineClient,
  threadMid?: string,
) {
  if (!roomId || roomId.length > 512 || !messageId || messageId.length > 512)
    throw new Error("invalid Square message identity");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const stored = store.getMessage<{ threadInfo?: { chatThreadMid?: string } }>(roomId, messageId);
    if (!stored) throw new Error("Square message is not cached in this room");
    if (threadMid && stored.threadInfo?.chatThreadMid !== threadMid)
      throw new Error("Square message does not belong to this thread");
    const generation = store.getGeneration();
    const result = await client.base.square.markAsRead(
      buildSquareReadRequest(roomId, messageId, threadMid),
    );
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    return { ok: true as const, result };
  });
}

export async function reactToSquareMessage(
  accountId: string,
  roomId: string,
  messageId: string,
  reaction: "NICE" | "LOVE" | "FUN" | "AMAZING" | "SAD" | "OMG",
  client: VylineClient,
  threadMid?: string,
) {
  if (!roomId || roomId.length > 512 || !messageId || messageId.length > 512)
    throw new Error("invalid Square message identity");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const stored = store.getMessage<{ threadInfo?: { chatThreadMid?: string } }>(roomId, messageId);
    if (!stored) throw new Error("Square message is not cached in this room");
    if (threadMid && stored.threadInfo?.chatThreadMid !== threadMid)
      throw new Error("Square message does not belong to this thread");
    const generation = store.getGeneration();
    const result = await client.base.square.reactToMessage(
      buildSquareReactionRequest(roomId, messageId, reaction, threadMid),
    );
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    return { ok: true as const, result };
  });
}

export async function sendSquareText(
  accountId: string,
  roomId: string,
  operationId: string,
  text: string,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512) throw new Error("invalid Square room id");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new Error("invalid Square operation id");
  }
  if (!text.trim() || text.length > 5000) throw new Error("invalid Square message text");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const generation = store.getGeneration();
    const reservation = store.reserveRoomSend(
      roomId,
      operationId,
      Date.now(),
      ROOM_SEND_COOLDOWN_MS,
    );
    if (reservation.status === "duplicate") {
      return { ok: false as const, error: "SQUARE_SEND_ALREADY_ATTEMPTED" };
    }
    if (reservation.status === "cooldown") {
      return {
        ok: false as const,
        error: "SQUARE_SEND_RATE_LIMIT",
        retryAfterMs: reservation.retryAfterMs,
      };
    }
    // Keep the cooldown after uncertain failures to avoid a timeout causing duplicate sends.
    const result = await client.base.square.sendMessage({ squareChatMid: roomId, text });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    return { ok: true as const, result };
  });
}

export async function sendSquareSticker(
  accountId: string,
  roomId: string,
  operationId: string,
  packageId: string,
  stickerId: string,
  premium: boolean,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512) throw new Error("invalid Square room id");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new Error("invalid Square operation id");
  }
  const stickerContent = buildSquareStickerContent(packageId, stickerId, premium);
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const generation = store.getGeneration();
    const reservation = store.reserveRoomSend(
      roomId,
      operationId,
      Date.now(),
      ROOM_SEND_COOLDOWN_MS,
    );
    if (reservation.status === "duplicate")
      return { ok: false as const, error: "SQUARE_SEND_ALREADY_ATTEMPTED" };
    if (reservation.status === "cooldown") {
      return {
        ok: false as const,
        error: "SQUARE_SEND_RATE_LIMIT",
        retryAfterMs: reservation.retryAfterMs,
      };
    }
    const result = await client.base.square.sendMessage({
      squareChatMid: roomId,
      ...stickerContent,
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    const created = result.createdSquareMessage;
    if (created?.message?.id) {
      store.upsertMessages([
        {
          roomId,
          id: created.message.id,
          createdAt: asInt(created.message.createdTime),
          revision: asInt(created.squareMessageRevision),
          payload: { eventType: "sendMessage", state: created.state, message: created.message },
        },
      ]);
    }
    return { ok: true as const, result };
  });
}

export async function sendSquareThreadText(
  accountId: string,
  roomId: string,
  threadMid: string,
  operationId: string,
  text: string,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512 || !threadMid || threadMid.length > 512)
    throw new Error("invalid Square thread identity");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new Error("invalid Square operation id");
  }
  if (!text.trim() || text.length > 5000) throw new Error("invalid Square message text");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const knownThread = store
      .listMessages<{ threadInfo?: { chatThreadMid?: string } }>(roomId, 200)
      .some((item) => item.threadInfo?.chatThreadMid === threadMid);
    if (!knownThread) throw new Error("Square thread was not discovered in this room");

    const generation = store.getGeneration();
    const thread = await client.base.square.getSquareThread({
      request: { threadMid, includeRootMessage: false },
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    if (
      thread.squareThread?.chatMid !== roomId ||
      thread.myThreadMember?.membershipState !== enums.SquareThreadMembershipState.JOINED
    ) {
      throw new SquareThreadNotJoinedError();
    }

    const reservation = store.reserveRoomSend(
      roomId,
      operationId,
      Date.now(),
      ROOM_SEND_COOLDOWN_MS,
    );
    if (reservation.status === "duplicate")
      return { ok: false as const, error: "SQUARE_SEND_ALREADY_ATTEMPTED" };
    if (reservation.status === "cooldown") {
      return {
        ok: false as const,
        error: "SQUARE_SEND_RATE_LIMIT",
        retryAfterMs: reservation.retryAfterMs,
      };
    }

    // Matches the verified SquareThreadMessage client path and captured request shape.
    const result = await client.base.square.sendSquareThreadMessage({
      request: buildSquareThreadTextRequest(
        await client.base.getReqseq("sq"),
        roomId,
        threadMid,
        text,
      ),
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    const created = result.createdThreadMessage;
    if (created?.message?.id) {
      store.upsertMessages([
        {
          roomId,
          id: created.message.id,
          createdAt: asInt(created.message.createdTime),
          revision: asInt(created.squareMessageRevision),
          payload: {
            eventType: "sendSquareThreadMessage",
            state: created.state,
            threadInfo: created.threadInfo,
            message: created.message,
            fromType: created.fromType,
          },
        },
      ]);
    }
    return { ok: true as const, result };
  });
}

function assertKnownSquareThread(store: SquareStore, roomId: string, threadMid: string): void {
  if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
  const knownThread = store
    .listMessages<{ threadInfo?: { chatThreadMid?: string } }>(roomId, 200)
    .some((item) => item.threadInfo?.chatThreadMid === threadMid);
  if (!knownThread) throw new Error("Square thread was not discovered in this room");
}

export async function loadSquareThreadContext(
  accountId: string,
  roomId: string,
  threadMid: string,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512 || !threadMid || threadMid.length > 512)
    throw new Error("invalid Square thread identity");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    assertKnownSquareThread(store, roomId, threadMid);
    const generation = store.getGeneration();
    const result = await client.base.square.getSquareThread({
      request: { threadMid, includeRootMessage: true },
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    if (result.squareThread?.chatMid !== roomId) throw new Error("Square thread room mismatch");
    return {
      ok: true as const,
      state: result.squareThread.state,
      membershipState: result.myThreadMember?.membershipState ?? null,
      rootMessage: result.rootMessage,
    };
  });
}

export async function joinSquareThreadForAccount(
  accountId: string,
  roomId: string,
  threadMid: string,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512 || !threadMid || threadMid.length > 512)
    throw new Error("invalid Square thread identity");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    assertKnownSquareThread(store, roomId, threadMid);
    const generation = store.getGeneration();
    const result = await client.base.square.joinSquareThread({
      request: { chatMid: roomId, threadMid },
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    return { ok: true as const, result };
  });
}

export async function listSquareMembers(
  accountId: string,
  roomId: string,
  client: VylineClient,
  continuationToken?: string,
  limit = 100,
) {
  if (!roomId || roomId.length > 512) throw new Error("invalid Square room id");
  if (continuationToken && continuationToken.length > 4096)
    throw new Error("invalid Square member cursor");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const generation = store.getGeneration();
    const response = await client.base.square.getSquareChatMembers({
      squareChatMid: roomId,
      limit: Math.max(1, Math.min(100, Math.trunc(limit))),
      ...(continuationToken ? { continuationToken } : {}),
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    for (const member of response.squareChatMembers ?? []) {
      store.upsertEntity("squareMember", member.squareMemberMid, member, roomId);
    }
    return {
      ok: true as const,
      members: response.squareChatMembers ?? [],
      continuationToken: response.continuationToken || null,
    };
  });
}

export async function loadSquareMediaPreview(
  accountId: string,
  roomId: string,
  messageId: string,
  client: VylineClient,
) {
  if (!roomId || roomId.length > 512 || !messageId || messageId.length > 512)
    throw new Error("invalid Square media identity");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const stored = store.getMessage<{
      message?: { id?: string; contentType?: string | number };
    }>(roomId, messageId);
    const contentType = stored?.message?.contentType;
    const previewTypes = new Set<string | number>([
      "IMAGE",
      "VIDEO",
      "AUDIO",
      enums.ContentType.IMAGE,
      enums.ContentType.VIDEO,
      enums.ContentType.AUDIO,
    ]);
    if (stored?.message?.id !== messageId || !previewTypes.has(contentType ?? "")) {
      throw new Error("Square message has no supported media preview");
    }
    const generation = store.getGeneration();
    // Always use Square OBS by message ID; never fetch URLs from message metadata.
    const file = await client.base.obs.downloadMessageData({
      messageId,
      isPreview: true,
      isSquare: true,
    });
    if (!store.isCurrentGeneration(generation)) throw new SquareDisabledError();
    if (file.size > 8 * 1024 * 1024) throw new Error("Square preview is too large");
    const mediaType = file.type.toLowerCase();
    if (!/^(image|video|audio)\/[a-z0-9.+-]+$/.test(mediaType)) {
      throw new Error("Square preview returned an unsupported media type");
    }
    return {
      ok: true as const,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mediaType,
    };
  });
}

export function readSquareCache(accountId: string, roomId?: string) {
  const store = getSquareStore(accountId);
  if (!store.isEnabled()) throw new SquareDisabledError();
  return roomId
    ? { ok: true as const, messages: store.listMessages(roomId, 100) }
    : {
        ok: true as const,
        squares: store.listEntities<LINE.Square>("square"),
        rooms: store.listRooms(),
      };
}
