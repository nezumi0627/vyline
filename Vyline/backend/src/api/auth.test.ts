import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as protocol from "@vyline/protocol";
import * as clientManager from "../line/clientManager.js";
import * as profileBridge from "../vyline/profileBridge.js";
import * as tokenStore from "../storage/tokenStore.js";
import { authRouter } from "./auth.js";

afterEach(() => mock.restore());

describe("QR login status", () => {
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
      ok: true, status: "expired", qrUrl: null, pincode: null,
    });
  });

  test("reports completion only for the requested active account", async () => {
    spyOn(clientManager, "getQrState").mockReturnValue({
      url: null, expired: false, pincode: null, inProgress: false, error: null,
    });
    spyOn(clientManager, "listAccounts").mockReturnValue(["main", "account-2"]);
    spyOn(clientManager, "getLoggedInAt").mockReturnValue(1);

    const completed = await authRouter.request("/login/qr/account-2");
    expect((await completed.json()).status).toBe("completed");
    const idle = await authRouter.request("/login/qr/account-3");
    expect((await idle.json()).status).toBe("idle");
  });
});
