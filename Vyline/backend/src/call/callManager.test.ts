import { expect, spyOn, test } from "bun:test";
import { encodeCallVideoFrame } from "@vyline/types";
import { Buffer } from "node:buffer";
import * as sessionFactory from "./sessionFactory.js";
import {
  endManagedCall,
  endManagedCallForAccount,
  getCallSnapshotForAccount,
  listAccountCalls,
  startManagedCall,
} from "./callManager.js";

function fakeSession() {
  let state: "idle" | "in-call" | "ended" = "idle";
  const listeners = new Map<string, (...values: unknown[]) => void>();
  return {
    get state() {
      return state;
    },
    on(event: string, listener: (value?: unknown) => void) {
      listeners.set(event, listener);
    },
    async start() {
      state = "in-call";
      listeners.get("state")?.("in-call");
    },
    async end() {
      state = "ended";
      listeners.get("ended")?.("user-ended");
    },
    async sendStream() {},
    async *received() {},
  };
}

test("managed calls are isolated by account and can be ended through the scoped API", async () => {
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session: session as never,
    transportKind: "planet",
    wire: { deviceDetails: { device: "DESKTOPWIN" } },
  } as never);
  const accountId = `call-test-${crypto.randomUUID()}`;
  try {
    const created = await startManagedCall({ accountId, client: {} as never, to: "u-peer" });
    expect(listAccountCalls(accountId)).toHaveLength(1);
    expect(getCallSnapshotForAccount(accountId, created.sessionId)?.accountId).toBe(accountId);
    expect(getCallSnapshotForAccount(`${accountId}-other`, created.sessionId)).toBeNull();
    expect(await endManagedCallForAccount(`${accountId}-other`, created.sessionId)).toBe(false);
    expect(listAccountCalls(accountId)).toHaveLength(1);
    expect(await endManagedCallForAccount(accountId, created.sessionId)).toBe(true);
    expect(listAccountCalls(accountId)).toHaveLength(0);
  } finally {
    create.mockRestore();
    for (const call of listAccountCalls(accountId)) await endManagedCall(call.sessionId);
  }
});

test("video websocket validates and relays VP8 packets without buffering them", async () => {
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockResolvedValue({
    session: session as never,
    transportKind: "planet",
    wire: { deviceDetails: { device: "DESKTOPWIN" } },
  } as never);
  const accountId = `video-call-${crypto.randomUUID()}`;
  const messages: unknown[][] = [[], []];
  const sockets = messages.map((received, index) => ({
    data: { accountId, sessionId: "", media: "video" as const },
    send(value: unknown) {
      received.push(value);
    },
    close() {},
  }));
  try {
    const created = await startManagedCall({
      accountId,
      client: {} as never,
      to: "u-peer",
      kind: "VIDEO",
    });
    for (const socket of sockets) socket.data.sessionId = created.sessionId;
    const manager = await import("./callManager.js");
    manager.attachCallWebSocket(sockets[0] as never);
    manager.attachCallWebSocket(sockets[1] as never);
    manager.callWebSocketHandler.message(
      sockets[0] as never,
      JSON.stringify({ type: "video", enabled: true }),
    );
    manager.callWebSocketHandler.message(
      sockets[1] as never,
      JSON.stringify({ type: "video", enabled: true }),
    );
    const packet = encodeCallVideoFrame({
      data: new Uint8Array([0, 0, 0, 0x9d, 1, 0x2a, 1, 2, 3]),
      key: true,
      timestamp: 1,
    });
    manager.callWebSocketHandler.message(sockets[0] as never, Buffer.from(packet));
    expect(
      messages[1]!.some(
        (value) =>
          value instanceof Uint8Array &&
          Array.from(value).join(",") === Array.from(packet).join(","),
      ),
    ).toBe(true);
    expect(
      messages[0]!.some((value) => typeof value === "string" && value.includes('"available":true')),
    ).toBe(true);
  } finally {
    create.mockRestore();
    await endManagedCall(createdSessionId(messages, accountId));
  }
});

function createdSessionId(_messages: unknown[][], accountId: string): string {
  return listAccountCalls(accountId)[0]?.sessionId ?? "missing";
}

test("concurrent starts for one account are serialized before route acquisition", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = fakeSession();
  const create = spyOn(sessionFactory, "createDirectCallSession").mockImplementation(async () => {
    await gate;
    return {
      session: session as never,
      transportKind: "planet",
      wire: { deviceDetails: { device: "DESKTOPWIN" } },
    } as never;
  });
  const accountId = `call-race-${crypto.randomUUID()}`;
  const opts = { accountId, client: {} as never, to: "u-peer" };
  const pending = startManagedCall(opts);
  try {
    await expect(startManagedCall(opts)).rejects.toThrow("通話の接続処理中です");
    release();
    const created = await pending;
    await endManagedCall(created.sessionId);
  } finally {
    release();
    create.mockRestore();
    for (const call of listAccountCalls(accountId)) await endManagedCall(call.sessionId);
  }
});
