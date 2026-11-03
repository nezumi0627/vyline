import type { VylineClient } from "@vyline/protocol";
import type * as LINE from "../../../packages/line-types/line_types.ts";
import {
  SquareDisabledError,
  SquareRoomUnavailableError,
  withSquareEnabled,
} from "./squareFeatureGate.js";
import { getSquareStore, type SquareStore } from "../storage/squareStore.js";

const READ_LIMIT = 100;
const MAX_PAGES = 20;
const MAX_EVENT_PAGES_PER_REQUEST = 5;
const SQUARE_SEARCH_MIN_INTERVAL_MS = 1_000;
const ROOM_SEND_COOLDOWN_MS = 1_250;

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
) {
  if (!roomId || roomId.length > 512) throw new Error("invalid Square room id");
  const store = getSquareStore(accountId);
  return withSquareEnabled(store, async () => {
    if (!store.hasRoom(roomId)) throw new SquareRoomUnavailableError();
    const generation = store.getGeneration();
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const roomCursor = store.getRoomSyncCursor(roomId);
    let continuationToken = store.getRoomContinuationToken(roomId);
    let nextSyncCursor = roomCursor;
    const events: LINE.SquareEvent[] = [];
    for (let page = 0; page < MAX_EVENT_PAGES_PER_REQUEST; page++) {
      const response = await client.base.square.fetchSquareChatEvents({
        squareChatMid: roomId,
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
      roomId,
      continuationToken ? roomCursor : nextSyncCursor,
      continuationToken,
    );
    return {
      ok: true as const,
      roomId,
      messages: store.listMessages(roomId, boundedLimit),
      continuationToken,
    };
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
