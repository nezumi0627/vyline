import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, appendFile, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallRecordingStore, RECORDING_CHUNK_BYTES } from "./callRecordingStore.js";

const root = await mkdtemp(join(tmpdir(), "vyline-recordings-"));
let store = new CallRecordingStore(root);
afterAll(async () => {
  store.close();
  await rm(root, { recursive: true, force: true });
});
const input = {
  sessionId: "call-1",
  chatMid: `c${"1".repeat(32)}`,
  title: "合成テスト",
  kind: "audio" as const,
  mimeType: "audio/webm;codecs=opus",
  retentionDays: 30,
};

test("failed WebDAV copies stay local; retry exposes pending and cannot resurrect a deleted record", async () => {
  const row = await store.create("transfer", input, 100, { id: "fixture-target" });
  await store.append("transfer", row.id, 0, new Uint8Array([1, 2, 3]));
  await store.finish("transfer", row.id, 1000);
  await expect(
    store.transfer("transfer", row.id, async () => {
      throw new Error("fixture failure");
    }),
  ).rejects.toThrow();
  expect(store.get("transfer", row.id).transfer).toBe("error");
  expect((await readFile(store.file("transfer", row.id))).length).toBe(3);
  await store.transfer("transfer", row.id, async () => {
    expect(store.get("transfer", row.id).transfer).toBe("pending");
  });
  expect(store.get("transfer", row.id).transfer).toBe("complete");
  let deletedExternal = false;
  await store.remove("transfer", row.id, async () => {
    deletedExternal = true;
  });
  expect(deletedExternal).toBe(true);
  await expect(store.transfer("transfer", row.id, async () => {})).rejects.toThrow();
});

test("durable ordered chunks, exact retries, ownership, reservation and idempotent finish/delete", async () => {
  const row = await store.create("owner", input, 12);
  expect(store.usage("owner")).toEqual({ recordingBytes: 0, recordingReservedBytes: 12 });
  await expect(store.append("other", row.id, 0, new Uint8Array([1]))).rejects.toThrow();
  await expect(store.append("owner", row.id, 2, new Uint8Array([1]))).rejects.toThrow();
  await expect(
    store.append("owner", row.id, 0, new Uint8Array(RECORDING_CHUNK_BYTES + 1)),
  ).rejects.toThrow();
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await Promise.all([
    store.append("owner", row.id, 0, bytes),
    store.append("owner", row.id, 0, bytes),
  ]);
  expect(result.map((r) => r.bytes)).toEqual([3, 3]);
  await expect(store.append("owner", row.id, 0, new Uint8Array([4]))).rejects.toThrow();
  expect(store.usage("owner")).toEqual({ recordingBytes: 3, recordingReservedBytes: 9 });
  expect(new Uint8Array(await readFile(store.file("owner", row.id)))).toEqual(bytes);
  const done = await store.finish("owner", row.id, 1234);
  expect(done.state).toBe("ready");
  expect(await store.finish("owner", row.id, 1234)).toEqual(done);
  await expect(store.append("owner", row.id, 3, bytes)).rejects.toThrow();
  expect(store.usage("owner")).toEqual({ recordingBytes: 3, recordingReservedBytes: 0 });
  expect(store.list("other").items).toEqual([]);
  await store.remove("owner", row.id);
  await store.remove("owner", row.id);
  await expect(store.append("owner", row.id, 0, bytes)).rejects.toThrow();
});

test("a shared destination automatically separates each account into its own stable subdirectory", async () => {
  const base = join(root, "shared-destination");
  const a = await store.create("account-a", input, 12, { id: "target-a", directory: base });
  const b = await store.create("account-b", input, 12, { id: "target-b", directory: base });
  const pathA = store.file("account-a", a.id);
  const pathB = store.file("account-b", b.id);
  expect(pathA.startsWith(base)).toBe(true);
  expect(pathB.startsWith(base)).toBe(true);
  expect(pathA.split(/[\\/]/).at(-2)).not.toBe(pathB.split(/[\\/]/).at(-2));
  await store.finish("account-a", a.id, 0);
  const next = await store.create("account-a", input, 12, { id: "target-a", directory: base });
  expect(store.file("account-a", next.id).split(/[\\/]/).at(-2)).toBe(pathA.split(/[\\/]/).at(-2));
});

test("restart truncates unacknowledged bytes; missing acknowledged bytes are never padded", async () => {
  const row = await store.create("recovery", { ...input, retentionDays: 0 }, 100);
  await store.append("recovery", row.id, 0, new Uint8Array([1, 2]));
  await appendFile(store.file("recovery", row.id), new Uint8Array([8, 9]));
  store.close();
  store = new CallRecordingStore(root);
  await store.recover();
  expect((await readFile(store.file("recovery", row.id))).length).toBe(2);
  expect(store.get("recovery", row.id).state).toBe("interrupted");
  expect(store.usage("recovery").recordingReservedBytes).toBe(0);
  const short = await store.create("short", input, 100);
  await store.append("short", short.id, 0, new Uint8Array([1, 2]));
  await truncate(store.file("short", short.id), 1);
  store.close();
  store = new CallRecordingStore(root);
  await store.recover();
  expect(store.get("short", short.id).state).toBe("interrupted");
  expect(store.get("short", short.id).error).toBeTruthy();
  expect((await readFile(store.file("short", short.id))).length).toBe(1);
});

test("bounded capacity, MIME/path rejection, finite and indefinite retention", async () => {
  await expect(store.create("bad", { ...input, mimeType: "text/html" }, 4)).rejects.toThrow();
  const row = await store.create("limit", input, 4, undefined, 1000);
  await expect(store.append("limit", row.id, 0, new Uint8Array(5))).rejects.toThrow();
  await store.append("limit", row.id, 0, new Uint8Array([1]));
  await store.finish("limit", row.id, 10);
  const forever = await store.create("forever", { ...input, retentionDays: 0 }, 4, undefined, 1000);
  await store.append("forever", forever.id, 0, new Uint8Array([1]));
  await store.finish("forever", forever.id, 10);
  await store.prune(1000 + 31 * 86400000);
  expect(() => store.get("limit", row.id)).toThrow();
  expect(store.get("forever", forever.id).expiresAt).toBeNull();
  expect(() => store.file("forever", "../../tokens.json")).toThrow();
});
