import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { api } from "../api/client.js";
let useAuthStore: typeof import("./authStore.js")["useAuthStore"];

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
let storage: Map<string, string>;
function installStorage() {
  storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
}
beforeAll(async () => {
  installStorage();
  ({ useAuthStore } = await import("./authStore.js"));
});
beforeEach(() => {
  installStorage();
  useAuthStore.setState({
    activeAccountId: "previous-owner",
    accounts: ["previous-owner"],
    saved: ["private-account"],
    sessions: [],
    initialized: false,
    loading: false,
    error: null,
  });
});
afterEach(() => {
  mock.restore();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
  if (originalCrypto) Object.defineProperty(globalThis, "crypto", originalCrypto);
});

describe("paired browser authentication", () => {
  test("activates the paired account immediately after QR completion", () => {
    useAuthStore.getState().activateSubdevice("account-2");
    expect(useAuthStore.getState()).toMatchObject({
      activeAccountId: "account-2",
      accounts: ["account-2"],
      saved: [],
      sessions: [],
      initialized: true,
      loading: false,
    });
  });

  test("restores only the paired account without calling owner account APIs", async () => {
    storage.set("vyline:subdevice-session", "vys_test");
    const calls: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      calls.push(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer vys_test");
      return Response.json({ ok: true, device: { accountId: "account-2" } });
    }) as typeof fetch);
    await useAuthStore.getState().bootstrap();
    await useAuthStore.getState().refreshSessions();
    expect(calls).toEqual(["/api/auth/subdevices/heartbeat", "/api/auth/subdevices/heartbeat"]);
    expect(useAuthStore.getState()).toMatchObject({
      activeAccountId: "account-2",
      accounts: ["account-2"],
      saved: [],
    });
  });

  test("clears stale owner state when a paired session is revoked", async () => {
    storage.set("vyline:subdevice-session", "vys_revoked");
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ ok: false }, { status: 401 }),
    );
    await useAuthStore.getState().bootstrap();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      activeAccountId: null,
      accounts: [],
      saved: [],
      initialized: true,
    });
    expect(useAuthStore.getState().error).toContain("QR");
  });

  test("binds a stable installation ID on HTTP LAN browsers without randomUUID", async () => {
    const random = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: random },
    });
    const ids: string[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
      ids.push(new Headers(init?.headers).get("x-vyline-installation-id")!);
      return Response.json({ ok: true });
    }) as typeof fetch);
    await api.subdevices.heartbeat("vys_test");
    await api.subdevices.heartbeat("vys_test");
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[1]).toBe(ids[0]);
  });
});
