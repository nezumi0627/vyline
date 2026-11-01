import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";

const DB_NAME = "vyline-browser-state";
const STORE_NAME = "zustand";
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked"));
  });
  const guarded = opening.catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  database = guarded;
  return guarded;
}

function localGet(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Storage can be disabled in private or quota-limited browser contexts.
  }
}

async function readIndexed(key: string): Promise<unknown | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

async function writeIndexed(key: string, value: unknown | null): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (value === null) store.delete(key);
    else store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
  });
}

export async function getPersistedRaw(key: string): Promise<string | null> {
  try {
    const stored = await readIndexed(key);
    if (typeof stored === "string") {
      localRemove(key);
      return stored;
    }
    const legacy = localGet(key);
    if (legacy !== null) {
      try {
        await writeIndexed(key, legacy);
        localRemove(key);
      } catch {
        /* preserve and use legacy data */
      }
    }
    return legacy;
  } catch {
    return localGet(key);
  }
}

export async function getPersistedValue<T>(key: string): Promise<T | null> {
  try {
    const stored = await readIndexed(key);
    if (stored !== null) {
      if (typeof stored === "string") {
        try {
          const value = JSON.parse(stored) as T;
          localRemove(key);
          return value;
        } catch {
          localRemove(key);
          return stored as T;
        }
      }
      localRemove(key);
      return stored as T;
    }
  } catch {
    // Fall through to the legacy localStorage value.
  }
  const legacy = localGet(key);
  if (legacy === null) return null;
  try {
    const value = JSON.parse(legacy) as T;
    try {
      await writeIndexed(key, value);
      localRemove(key);
    } catch {
      /* preserve and use legacy data */
    }
    return value;
  } catch {
    return legacy as T;
  }
}

export async function setPersistedRaw(key: string, value: string): Promise<void> {
  await writeIndexed(key, value);
  localRemove(key);
}

export async function setPersistedValue<T>(key: string, value: T): Promise<boolean> {
  try {
    await writeIndexed(key, value);
    localRemove(key);
    return true;
  } catch {
    return false;
  }
}

/** Async Zustand storage; localStorage is read only for one-time legacy import. */
export const indexedDbStateStorage: StateStorage = {
  async getItem(key) {
    return getPersistedRaw(key);
  },
  async setItem(key, value) {
    await setPersistedRaw(key, value);
  },
  async removeItem(key) {
    try {
      await writeIndexed(key, null);
    } catch {
      // The local fallback is removed even when the database is unavailable.
    } finally {
      localRemove(key);
    }
  },
};

/** Persist Zustand snapshots as IndexedDB structured-clone objects, avoiding JSON work on updates. */
export const indexedDbPersistStorage: PersistStorage<any> = {
  async getItem(name) {
    try {
      const stored = await readIndexed(name);
      if (stored && typeof stored === "object") {
        localRemove(name);
        return stored as StorageValue<any>;
      }
      if (typeof stored === "string") {
        const value = JSON.parse(stored) as StorageValue<any>;
        localRemove(name);
        return value;
      }
    } catch {
      // Read the pre-migration value below.
    }
    const legacy = localGet(name);
    if (legacy === null) return null;
    try {
      const value = JSON.parse(legacy) as StorageValue<any>;
      try {
        await writeIndexed(name, value);
        localRemove(name);
      } catch {
        /* preserve and use legacy data */
      }
      return value;
    } catch {
      return null;
    }
  },
  async setItem(name, value) {
    try {
      await writeIndexed(name, value);
      localRemove(name);
    } catch {
      /* Keep the in-memory store usable. */
    }
  },
  async removeItem(name) {
    try {
      await writeIndexed(name, null);
    } catch {
      /* remove local fallback below */
    }
    localRemove(name);
  },
};
