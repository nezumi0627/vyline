import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";

let dataDir: string;
let router: typeof import("./line.js").lineRouter;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vyline-delete-contact-"));
  process.env.VYLINE_DATA_DIR = dataDir;
  process.env.VYLINE_STORAGE_DIR = join(dataDir, "storage");
  ({ lineRouter: router } = await import("./line.js"));
});

afterAll(async () => {
  const { closeSqlite } = await import("../storage/sqlite.js");
  closeSqlite();
  await rm(dataDir, { recursive: true, force: true });
});

test("friend deletion rejects a group MID before contacting LINE", async () => {
  const response = await router.request(
    "/offline-delete-contact/contacts/c0123456789abcdef0123456789abcdef",
    {
      method: "DELETE",
    },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, error: "user MID required" });
});

test("friend deletion blocks the protected LINE buddy before contacting LINE", async () => {
  const response = await router.request(
    "/offline-delete-contact/contacts/u085311ecd9e3e3d74ae4c9f5437cbcb5",
    { method: "DELETE" },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    ok: false,
    error: "この友だちは保護対象のため削除できません",
    code: "PROTECTED_CONTACT_DELETE",
  });
});
