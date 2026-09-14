import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as protocol from "@vyline/protocol";
import * as clientManager from "../line/clientManager.js";
import * as profileBridge from "../vyline/profileBridge.js";
import * as tokenStore from "../storage/tokenStore.js";
import * as lineService from "../service/lineService.js";
import * as pluginManager from "../line/pluginManager.js";
import { authRouter } from "./auth.js";

afterEach(() => mock.restore());

describe("QR login status", () => {
  test("does not register a QR login that completes after the account was removed", async () => {
    const accountId = "test-qr-removed-while-pending";
    const base = new protocol.BaseClient({ device: "IOSIPAD" });
    base.authToken = "stale-issued-token";
    const client = new protocol.Client(base);
    let resolveLogin!: (client: protocol.Client) => void;
    const deferred = new Promise<protocol.Client>((resolve) => {
      resolveLogin = resolve;
    });
    const profile: protocol.DesktopProfile = await Bun.file(
      new URL("../../../packages/protocol/data/desktop-profile.fallback.json", import.meta.url),
    ).json();
    spyOn(profileBridge, "getVylineProfile").mockReturnValue(profile);
    spyOn(protocol, "loginWithQR").mockImplementation(async () => deferred);
    const saveToken = spyOn(tokenStore, "saveToken").mockResolvedValue(undefined);

    const pending = clientManager.loginWithQRCode(accountId, () => {});
    clientManager.removeClient(accountId);
    resolveLogin(client);

    await expect(pending).rejects.toThrow("login attempt superseded");
    expect(saveToken).not.toHaveBeenCalled();
    expect(clientManager.listAccounts()).not.toContain(accountId);
  });

  test("invalidates QR polling state immediately when the account is removed", async () => {
    const accountId = "test-qr-remove-clears-state";
    let resolveLogin!: (client: protocol.Client) => void;
    const deferred = new Promise<protocol.Client>((resolve) => {
      resolveLogin = resolve;
    });
    const profile: protocol.DesktopProfile = await Bun.file(
      new URL("../../../packages/protocol/data/desktop-profile.fallback.json", import.meta.url),
    ).json();
    spyOn(profileBridge, "getVylineProfile").mockReturnValue(profile);
    spyOn(protocol, "loginWithQR").mockImplementation(async () => deferred);

    const pending = clientManager.loginWithQRCode(accountId, () => {});
    expect(clientManager.getQrState(accountId).inProgress).toBe(true);
    clientManager.removeClient(accountId);
    expect(clientManager.getQrState(accountId).inProgress).toBe(false);

    const base = new protocol.BaseClient({ device: "IOSIPAD" });
    base.authToken = "stale-issued-token";
    resolveLogin(new protocol.Client(base));
    await expect(pending).rejects.toThrow("login attempt superseded");
  });

  test("cancels a delayed ops listener when the account is removed", async () => {
    const accountId = "test-qr-remove-before-ops-start";
    const previousDelay = process.env.VYLINE_TALK_LISTEN_DELAY_MS;
    process.env.VYLINE_TALK_LISTEN_DELAY_MS = "10";
    const base = new protocol.BaseClient({ device: "IOSIPAD" });
    base.authToken = "test-issued-token";
    base.profile = { mid: "u11111111111111111111111111111111" } as never;
    const client = new protocol.Client(base);
    const sync = spyOn(base.talk, "sync").mockResolvedValue({} as never);
    const profile: protocol.DesktopProfile = await Bun.file(
      new URL("../../../packages/protocol/data/desktop-profile.fallback.json", import.meta.url),
    ).json();
    spyOn(profileBridge, "getVylineProfile").mockReturnValue(profile);
    spyOn(protocol, "loginWithQR").mockResolvedValue(client);
    spyOn(tokenStore, "saveToken").mockResolvedValue(undefined);
    spyOn(tokenStore, "updateSessionMeta").mockResolvedValue(undefined);
    spyOn(lineService, "warmLineCache").mockResolvedValue(undefined);
    spyOn(pluginManager, "restoreEnabledPlugins").mockResolvedValue(undefined);

    try {
      await clientManager.loginWithQRCode(accountId, () => {});
      clientManager.removeClient(accountId);
      await Bun.sleep(30);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      clientManager.removeClient(accountId);
      if (previousDelay === undefined) Reflect.deleteProperty(process.env, "VYLINE_TALK_LISTEN_DELAY_MS");
      else process.env.VYLINE_TALK_LISTEN_DELAY_MS = previousDelay;
    }
  });

  test("does not call an authenticated connection failure QR expiration", async () => {
    const base = new protocol.BaseClient({ device: "IOSIPAD" });
    base.authToken = "test-issued-token";
    const client = new protocol.Client(base);
    const connectionError = Object.assign(new TypeError("socket connection was closed"), {
      code: "ECONNRESET",
    });
    const profile: protocol.DesktopProfile = await Bun.file(
      new URL("../../../packages/protocol/data/desktop-profile.fallback.json", import.meta.url),
    ).json();
    spyOn(profileBridge, "getVylineProfile").mockReturnValue(profile);
    spyOn(protocol, "loginWithQR").mockImplementation(async (options) => {
      options.onReceiveQRUrl("https://example.invalid/qr");
      return client;
    });
    const saveToken = spyOn(tokenStore, "saveToken").mockResolvedValue(undefined);
    spyOn(base.loginProcess, "ready").mockRejectedValue(connectionError);

    await expect(
      clientManager.loginWithQRCode("test-qr-post-auth-failure", () => {}),
    ).rejects.toThrow("socket connection was closed");

    expect(saveToken).toHaveBeenCalled();
    expect(clientManager.getQrState("test-qr-post-auth-failure")).toMatchObject({
      url: null,
      pincode: null,
      expired: false,
      inProgress: false,
    });
    const response = await authRouter.request("/login/qr/test-qr-post-auth-failure");
    expect((await response.json()).status).toBe("failed");
    expect(clientManager.listAccounts()).not.toContain("test-qr-post-auth-failure");
  });

  test("reports a failed additional login even when its old QR URL remains", async () => {
    spyOn(clientManager, "getQrState").mockReturnValue({
      url: "https://example.invalid/qr",
      expired: false,
      pincode: "123456",
      inProgress: false,
      error: "internal transport error containing private data",
    });

    const response = await authRouter.request("/login/qr/account-2");
    const body = await response.json();

    expect(body).toMatchObject({ ok: true, status: "failed", qrUrl: null, pincode: null });
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("private data");
  });

  test("still distinguishes expiration from other login failures", async () => {
    spyOn(clientManager, "getQrState").mockReturnValue({
      url: null,
      expired: true,
      pincode: null,
      inProgress: false,
      error: "expired",
    });

    const response = await authRouter.request("/login/qr/account-2");
    expect(await response.json()).toEqual({
      ok: true,
      status: "expired",
      qrUrl: null,
      pincode: null,
    });
  });

  test("reports completion only for the requested active account", async () => {
    spyOn(clientManager, "getQrState").mockReturnValue({
      url: null,
      expired: false,
      pincode: null,
      inProgress: false,
      error: null,
    });
    spyOn(clientManager, "listAccounts").mockReturnValue(["main", "account-2"]);
    spyOn(clientManager, "getLoggedInAt").mockReturnValue(1);

    const completed = await authRouter.request("/login/qr/account-2");
    expect((await completed.json()).status).toBe("completed");
    const idle = await authRouter.request("/login/qr/account-3");
    expect((await idle.json()).status).toBe("idle");
  });
});

test("session logout invalidates the client before deleting its saved token", async () => {
  const order: string[] = [];
  const deleted: string[] = [];
  spyOn(clientManager, "removeClient").mockImplementation(() => {
    order.push("remove");
  });
  spyOn(tokenStore, "deleteToken").mockImplementation(async (accountId) => {
    deleted.push(accountId);
    order.push("delete");
  });

  const response = await authRouter.request("/sessions/account-race?logout=1", { method: "DELETE" });

  expect(response.status).toBe(200);
  expect(order[0]).toBe("remove");
  expect(order.slice(1)).toEqual(["delete", "delete"]);
  expect(deleted.sort()).toEqual(["account-race", "account-race:content"]);
});

test("account deletion removes its hidden content-secondary credential", async () => {
  const deleted: string[] = [];
  spyOn(clientManager, "removeClient").mockImplementation(() => undefined);
  spyOn(tokenStore, "deleteToken").mockImplementation(async (accountId) => {
    deleted.push(accountId);
  });

  const response = await authRouter.request("/accounts/account-delete", { method: "DELETE" });

  expect(response.status).toBe(200);
  expect(deleted.sort()).toEqual(["account-delete", "account-delete:content"]);
});

test("secondary login cannot return after logout while its token persistence was pending", async () => {
  const accountId = "test-content-save-logout";
  const base = new protocol.BaseClient({ device: "IOSIPAD" });
  base.authToken = "fixture-issued-token";
  base.profile = { mid: "u11111111111111111111111111111111" } as never;
  const client = new protocol.Client(base);
  const profile: protocol.DesktopProfile = await Bun.file(
    new URL("../../../packages/protocol/data/desktop-profile.fallback.json", import.meta.url),
  ).json();
  spyOn(profileBridge, "getVylineProfile").mockReturnValue(profile);
  spyOn(protocol, "loginWithQR").mockResolvedValue(client);
  const saveToken = spyOn(tokenStore, "saveToken").mockResolvedValue(undefined);
  spyOn(tokenStore, "updateSessionMeta").mockResolvedValue(undefined);
  spyOn(lineService, "warmLineCache").mockResolvedValue(undefined);
  spyOn(pluginManager, "restoreEnabledPlugins").mockResolvedValue(undefined);
  let started!: () => void;
  let release!: () => void;
  const saving = new Promise<void>(resolve => { started = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  try {
    await clientManager.loginWithQRCode(accountId, () => {});
    saveToken.mockImplementation(async id => {
      if (id === `${accountId}:content`) { started(); await paused; }
    });
    const pending = clientManager.loginContentWithQRCode(accountId, () => {});
    await saving;
    clientManager.removeClient(accountId);
    release();
    await expect(pending).rejects.toThrow("content login attempt superseded");
    expect(clientManager.getContentQrState(accountId).ready).toBe(false);
  } finally {
    release();
    clientManager.removeClient(accountId);
  }
});
