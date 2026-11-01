import { afterAll, beforeAll, expect, test } from "bun:test";

const values = new Map<string, string>();
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let storage: typeof import("./indexedDbStorage.js").indexedDbStateStorage;
let persistStorage: typeof import("./indexedDbStorage.js").indexedDbPersistStorage;
let betaConsent: typeof import("./betaConsent.js");
let tosConsent: typeof import("./tosConsent.js");

beforeAll(async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  ({ indexedDbStateStorage: storage, indexedDbPersistStorage: persistStorage } = await import(
    "./indexedDbStorage.js"
  ));
  betaConsent = await import("./betaConsent.js");
  tosConsent = await import("./tosConsent.js");
});

afterAll(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("reads the legacy browser value but does not keep writing to localStorage", async () => {
  values.set("vyline:test", "legacy-value");
  expect(await storage.getItem("vyline:test")).toBe("legacy-value");
  await expect(storage.setItem("vyline:test", "updated-value")).rejects.toThrow();
  expect(values.get("vyline:test")).toBe("legacy-value");
  await storage.removeItem("vyline:test");
  expect(values.has("vyline:test")).toBe(false);
});

test("reads old Zustand JSON into the structured persistence shape", async () => {
  values.set("vyline:auth", JSON.stringify({ state: { activeAccountId: "offline" }, version: 0 }));
  expect(await persistStorage.getItem("vyline:auth")).toEqual({
    state: { activeAccountId: "offline" },
    version: 0,
  });
  await persistStorage.setItem("vyline:auth", { state: { activeAccountId: "next" }, version: 0 });
  expect(JSON.parse(values.get("vyline:auth")!).state.activeAccountId).toBe("offline");
});

test("consent migration reads legacy JSON but never writes consent state back to localStorage", async () => {
  const betaKey = "vyline:beta-feature-consent-v1";
  const legacyBeta = JSON.stringify({ old: { consentedAt: "2026-01-01", version: "1" } });
  values.set(betaKey, legacyBeta);
  await betaConsent.hydrateBetaConsent();
  expect(betaConsent.hasBetaFeatureConsent("old")).toBe(true);
  expect(await betaConsent.recordBetaFeatureConsent("new")).toBe(false);
  expect(values.get(betaKey)).toBe(legacyBeta);

  values.set("vyline:tos-consent-v4", "1");
  await tosConsent.hydrateTosConsent();
  expect(tosConsent.hasTosConsent()).toBe(true);
});

test("removes a legacy localStorage value only after IndexedDB accepts the migration", async () => {
  const records = new Map<string, unknown>();
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          get: (key: string) => {
            const request: any = {};
            queueMicrotask(() => {
              request.result = records.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          put: (value: unknown, key: string) => {
            records.set(key, value);
            queueMicrotask(() => tx.oncomplete?.());
          },
          delete: (key: string) => {
            records.delete(key);
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
      };
      return tx;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request: any = {};
        queueMicrotask(() => {
          request.result = db;
          request.onsuccess?.();
        });
        return request;
      },
    },
  });

  values.set("vyline:migrated", "legacy");
  expect(await storage.getItem("vyline:migrated")).toBe("legacy");
  expect(records.get("vyline:migrated")).toBe("legacy");
  expect(values.has("vyline:migrated")).toBe(false);
});
