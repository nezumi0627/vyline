import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousDataDir = process.env.VYLINE_DATA_DIR;
const previousAdminSecret = process.env.VYLINE_API_ADMIN_SECRET;
const dataDir = await mkdtemp(join(tmpdir(), "vyline-public-api-"));
process.env.VYLINE_DATA_DIR = dataDir;
process.env.VYLINE_API_ADMIN_SECRET = "test-admin-secret";

const { publicRouter } = await import(`./public.ts?test=${crypto.randomUUID()}`);

afterAll(async () => {
  if (previousDataDir == null) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = previousDataDir;
  if (previousAdminSecret == null) Reflect.deleteProperty(process.env, "VYLINE_API_ADMIN_SECRET");
  else process.env.VYLINE_API_ADMIN_SECRET = previousAdminSecret;
  await rm(dataDir, { recursive: true, force: true });
});

describe("public API account boundaries", () => {
  test("rejects cross-account use of an account-scoped token", async () => {
    const createdResponse = await publicRouter.request("/tokens", {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "account-a client",
        accountIds: ["account-a"],
        scopes: ["read"],
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.data.accountIds).toEqual(["account-a"]);

    const response = await publicRouter.request("/accounts/account-b/chats", {
      headers: { authorization: `Bearer ${created.data.token}` },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "token is not authorized for this account",
    });

    const revoked = await publicRouter.request(`/tokens/${created.data.token}`, {
      method: "DELETE",
      headers: { authorization: "Bearer test-admin-secret" },
    });
    expect(revoked.status).toBe(200);
  });

  test("does not create an unscoped token when no account is active", async () => {
    const response = await publicRouter.request("/tokens", {
      method: "POST",
      headers: {
        authorization: "Bearer test-admin-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "documented request shape" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "accountIds must contain at least one active account",
    });
  });
});
