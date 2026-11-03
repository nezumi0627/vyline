import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SquareStore } from "./squareStore.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SquareStore", () => {
  test("starts disabled and persists enablement across reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "vyline-square-test-"));
    roots.push(root);
    const path = join(root, "square.sqlite");
    const first = new SquareStore(path);

    expect(first.isEnabled()).toBe(false);
    first.setEnabled(true);
    first.close();

    const reopened = new SquareStore(path);
    expect(reopened.isEnabled()).toBe(true);
    reopened.close();
  });

  test("keeps Square identifiers opaque and namespaces room records", () => {
    const store = new SquareStore(":memory:");
    store.upsertRoom({
      id: "c0123456789abcdef0123456789abcdef",
      name: "Room",
      parentSquareId: "sq-1",
    });
    expect(store.listRooms()).toEqual([
      { id: "c0123456789abcdef0123456789abcdef", name: "Room", parentSquareId: "sq-1" },
    ]);
    expect(store.hasRoom("c0123456789abcdef0123456789abcdef")).toBe(true);
    expect(store.hasRoom("unknown-room")).toBe(false);
    store.close();
  });

  test("keeps room cursors separate and clears cached content without changing opt-in", () => {
    const store = new SquareStore(":memory:");
    store.setEnabled(true);
    store.setRoomSyncCursor("room-a", "cursor-a");
    store.setRoomSyncCursor("room-b", "cursor-b");
    store.upsertRoom({ id: "room-a", name: "Room A" });
    store.upsertMessages([{ roomId: "room-a", id: "m1", payload: { text: "cached" } }]);

    expect(store.getRoomSyncCursor("room-a")).toBe("cursor-a");
    expect(store.getRoomSyncCursor("room-b")).toBe("cursor-b");
    store.setRoomSyncState("room-a", "cursor-a", "page-2");
    expect(store.getRoomContinuationToken("room-a")).toBe("page-2");
    store.clearCache();
    expect(store.getRoomSyncCursor("room-a")).toBeNull();
    expect(store.listRooms()).toEqual([]);
    expect(store.listMessages("room-a")).toEqual([]);
    expect(store.isEnabled()).toBe(true);
    store.close();
  });

  test("throttles repeated sends per room without blocking a different room", () => {
    const store = new SquareStore(":memory:");
    expect(store.reserveRoomSend("room-a", "op-1", 10_000, 1_250)).toEqual({ status: "reserved" });
    expect(store.reserveRoomSend("room-a", "op-2", 10_500, 1_250)).toEqual({
      status: "cooldown",
      retryAfterMs: 750,
    });
    expect(store.reserveRoomSend("room-b", "op-3", 10_500, 1_250)).toEqual({ status: "reserved" });
    expect(store.reserveRoomSend("room-a", "op-1", 11_250, 1_250)).toEqual({ status: "duplicate" });
    expect(store.reserveRoomSend("room-a", "op-4", 11_250, 1_250)).toEqual({ status: "reserved" });
    store.close();
  });

  test("throttles catalog searches per account", () => {
    const store = new SquareStore(":memory:");
    expect(store.reserveSquareSearch(10_000, 1_000)).toBe(0);
    expect(store.reserveSquareSearch(10_500, 1_000)).toBe(500);
    expect(store.reserveSquareSearch(11_000, 1_000)).toBe(0);
    store.close();
  });

  test("invalidates an in-flight response when opt-in is withdrawn", () => {
    const store = new SquareStore(":memory:");
    store.setEnabled(true);
    const startedAt = store.getGeneration();
    expect(store.isCurrentGeneration(startedAt)).toBe(true);
    store.setEnabled(false);
    expect(store.isCurrentGeneration(startedAt)).toBe(false);
    store.close();
  });

  test("tombstones prevent older or repeated pages from resurrecting a destroyed message", () => {
    const store = new SquareStore(":memory:");
    store.upsertMessages([{ roomId: "room-a", id: "m1", revision: 4, payload: { text: "old" } }]);
    store.markMessageDestroyed("room-a", "m1", 20);
    store.upsertMessages([{ roomId: "room-a", id: "m1", revision: 1, payload: { text: "stale" } }]);
    expect(store.listMessages("room-a")).toEqual([]);
    store.close();
  });
});
