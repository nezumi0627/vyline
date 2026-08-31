import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createRemoteAccessGuard,
  isLoopbackBindHost,
  isLoopbackRequestAddress,
  requiresRemoteAuthentication,
  SUBDEVICE_INSTALLATION_COOKIE,
  SUBDEVICE_SESSION_COOKIE,
  resolveBackendHost,
  withServerVerifiedLocalRequest,
} from "./remoteAccess.js";

function protectedApp(options: {
  lanAccess: boolean;
  host: string;
  mode?: "local" | "subdevice";
}) {
  const app = new Hono();
  const remoteAuthRequired = requiresRemoteAuthentication(options.lanAccess, options.host);
  app.use(
    "*",
    createRemoteAccessGuard({
      remoteAuthRequired,
      mode: options.mode ?? "subdevice",
      authenticateSubdevice: async (token, installationId) =>
        token === "paired-session" && installationId === "installation-1"
          ? { accountId: "account-1" }
          : null,
    }),
  );
  app.get("/resource", (c) => c.json({ ok: true }));
  return app;
}

describe("remote BFF access policy", () => {
  test("VYLINE_LAN_ACCESS=false still rejects unauthenticated remote access on 0.0.0.0", async () => {
    const app = protectedApp({ lanAccess: false, host: "0.0.0.0" });
    const response = await app.request("/resource", {
      headers: { "x-vyline-local-request": "0" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "subdevice authentication required",
    });
  });

  test("VYLINE_LAN_ACCESS=false keeps loopback bind access unauthenticated", async () => {
    const app = protectedApp({ lanAccess: false, host: "127.0.0.1" });
    const response = await app.request("/resource", {
      headers: { "x-vyline-local-request": "1" },
    });

    expect(response.status).toBe(200);
  });

  test("VYLINE_LAN_ACCESS=true authenticates remote access with the bound subdevice session", async () => {
    const app = protectedApp({ lanAccess: true, host: "0.0.0.0" });
    const rejected = await app.request("/resource", {
      headers: { "x-vyline-local-request": "0" },
    });
    const accepted = await app.request("/resource", {
      headers: {
        authorization: "Bearer paired-session",
        "x-vyline-installation-id": "installation-1",
        "x-vyline-local-request": "0",
      },
    });

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
  });

  test("non-loopback Docker bind accepts an existing paired session", async () => {
    const app = protectedApp({ lanAccess: false, host: "::" });
    const response = await app.request("/resource", {
      headers: {
        authorization: "Bearer paired-session",
        "x-vyline-installation-id": "installation-1",
        "x-vyline-local-request": "0",
      },
    });

    expect(response.status).toBe(200);
  });

  test("accepts installation-bound SameSite cookies for browser subresources", async () => {
    const app = protectedApp({ lanAccess: false, host: "0.0.0.0" });
    const response = await app.request("/resource", {
      headers: {
        cookie: `${SUBDEVICE_SESSION_COOKIE}=paired-session; ${SUBDEVICE_INSTALLATION_COOKIE}=installation-1`,
        "x-vyline-local-request": "0",
      },
    });

    expect(response.status).toBe(200);
  });

  test("does not accept cookie-only authentication for mutating BFF requests", async () => {
    const app = protectedApp({ lanAccess: false, host: "0.0.0.0" });
    const response = await app.request("/resource", {
      method: "POST",
      headers: {
        cookie: `${SUBDEVICE_SESSION_COOKIE}=paired-session; ${SUBDEVICE_INSTALLATION_COOKIE}=installation-1`,
        "x-vyline-local-request": "0",
      },
    });

    expect(response.status).toBe(401);
  });

  test("does not let ambient Basic auth bypass mutating-request cookie protection", async () => {
    const app = protectedApp({ lanAccess: false, host: "0.0.0.0" });
    const response = await app.request("/resource", {
      method: "POST",
      headers: {
        authorization: "Basic dXNlcjpwYXNz",
        cookie: `${SUBDEVICE_SESSION_COOKIE}=paired-session; ${SUBDEVICE_INSTALLATION_COOKIE}=installation-1`,
        "x-vyline-local-request": "0",
      },
    });

    expect(response.status).toBe(401);
  });

  test("owner-only management remains unavailable to a remote paired browser", async () => {
    const app = protectedApp({ lanAccess: false, host: "0.0.0.0", mode: "local" });
    const response = await app.request("/resource", {
      headers: {
        authorization: "Bearer paired-session",
        "x-vyline-installation-id": "installation-1",
        "x-vyline-local-request": "0",
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "local request required" });
  });

  test("recognizes loopback literals without treating wildcard binds as local", () => {
    expect(resolveBackendHost(false, undefined)).toBe("127.0.0.1");
    expect(resolveBackendHost(true, "127.0.0.1")).toBe("0.0.0.0");
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("127.20.30.40")).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isLoopbackBindHost("::")).toBe(false);
    expect(isLoopbackRequestAddress("::ffff:127.0.0.1")).toBe(true);
  });

  test("overwrites a client-supplied local marker from the server request IP", () => {
    const remote = withServerVerifiedLocalRequest(
      new Request("http://localhost/resource", {
        headers: { "x-vyline-local-request": "1" },
      }),
      "172.18.0.1",
    );
    const local = withServerVerifiedLocalRequest(
      new Request("http://localhost/resource", {
        headers: { "x-vyline-local-request": "0" },
      }),
      "127.0.0.1",
    );

    expect(remote.headers.get("x-vyline-local-request")).toBe("0");
    expect(local.headers.get("x-vyline-local-request")).toBe("1");
  });
});
