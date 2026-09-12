import { expect, spyOn, test } from "bun:test";
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
