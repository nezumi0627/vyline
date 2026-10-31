import { expect, test } from "bun:test";
import {
  authorizeSubdeviceRoute,
  isApiTokenAuthorizedForAccount,
  hasApiScope,
  hashApiToken,
  isLanAccessEnabled,
  isAllowedOrigin,
  isLanProtectedPath,
  isPublicPairingRequest,
  isSubdeviceHeartbeatPath,
  isSubdeviceManagementPath,
  isTrustedLineMediaUrl,
  parseApiScopes,
  secretsEqual,
  subdeviceAccountIdFromPath,
} from "./policies";

test("API scope parsing accepts only the supported least-privilege scopes", () => {
  expect(parseApiScopes(undefined)).toEqual(["read", "write"]);
  expect(parseApiScopes(["read", "read"])).toEqual(["read"]);
  expect(parseApiScopes([])).toBeNull();
  expect(parseApiScopes(["admin"])).toBeNull();
  expect(hasApiScope(["read"], "write")).toBe(false);
});

test("API tokens are restricted to their bound account", () => {
  expect(isApiTokenAuthorizedForAccount("account-a", "account-a")).toBe(true);
  expect(isApiTokenAuthorizedForAccount("account-a", "account-b")).toBe(false);
  expect(isApiTokenAuthorizedForAccount(null, "account-a")).toBe(false);
  expect(isApiTokenAuthorizedForAccount(null)).toBe(false);
});

test("Origin policy allows configured and same-origin requests only", () => {
  const allowed = new Set(["http://localhost:5173"]);
  expect(isAllowedOrigin("http://localhost:5173", "http://localhost:3001/api", allowed)).toBe(true);
  expect(isAllowedOrigin("http://localhost:3001", "http://localhost:3001/api", allowed)).toBe(true);
  expect(isAllowedOrigin("https://attacker.example", "http://localhost:3001/api", allowed)).toBe(
    false,
  );
  expect(isAllowedOrigin(undefined, "http://localhost:3001/api", allowed)).toBe(false);
});

test("LAN protection covers API aliases and direct routes without protecting static assets", () => {
  for (const path of ["/line/a/chats", "/api/line/a/chats", "/debug/tokens", "/auth/accounts", "/api/beta/agent-i/x", "/docs", "/openapi.json", "/metrics"]) {
    expect(isLanProtectedPath(path)).toBe(true);
  }
  expect(isLanProtectedPath("/subdevice")).toBe(false);
  expect(isLanProtectedPath("/assets/app.js")).toBe(false);
});

test("LAN protection is required whenever the backend binds a non-loopback address", () => {
  expect(isLanAccessEnabled(false, "127.0.0.1")).toBe(false);
  expect(isLanAccessEnabled(false, "localhost")).toBe(false);
  expect(isLanAccessEnabled(false, "::1")).toBe(false);
  expect(isLanAccessEnabled(false, "0.0.0.0")).toBe(true);
  expect(isLanAccessEnabled(false, "192.168.1.10")).toBe(true);
  expect(isLanAccessEnabled(true, "127.0.0.1")).toBe(true);
});

test("subdevice LAN policy only exempts one-time pairing and heartbeat", () => {
  expect(isPublicPairingRequest("/auth/subdevices/pairing/secret", "GET")).toBe(true);
  expect(isPublicPairingRequest("/api/auth/subdevices/pairing/secret/complete", "POST")).toBe(true);
  expect(isPublicPairingRequest("/auth/subdevices/pairing", "POST")).toBe(false);
  expect(isSubdeviceHeartbeatPath("/api/auth/subdevices/heartbeat", "POST")).toBe(true);
  expect(isSubdeviceManagementPath("/auth/subdevices/device-id/block")).toBe(true);
});

test("subdevice account scope is extracted from both direct and API paths", () => {
  expect(subdeviceAccountIdFromPath("/line/account%2D1/chats")).toBe("account-1");
  expect(subdeviceAccountIdFromPath("/api/line/account-2/profile")).toBe("account-2");
  expect(subdeviceAccountIdFromPath("/debug/tokens")).toBeNull();
  expect(subdeviceAccountIdFromPath("/api/line/%E0%A4%A/chats")).toBeNull();
});

test("LAN subdevice access is limited to its own account and heartbeat", () => {
  expect(authorizeSubdeviceRoute("/line/a/chats", "GET", "a")).toBe("allow");
  expect(authorizeSubdeviceRoute("/api/line/b/chats", "GET", "a")).toBe("forbidden");
  expect(authorizeSubdeviceRoute("/auth/subdevices/heartbeat", "POST", "a")).toBe("allow");
  expect(authorizeSubdeviceRoute("/auth/subdevices/device-a/block", "POST", "a")).toBe("forbidden");
  expect(authorizeSubdeviceRoute("/debug/tokens", "GET", "a")).toBe("forbidden");
  expect(authorizeSubdeviceRoute("/line/a/chats", "GET", null)).toBe("unauthorized");
});

test("admin secrets are compared by bytes without early content mismatch", () => {
  expect(secretsEqual("secret", "secret")).toBe(true);
  expect(secretsEqual("secret", "secreT")).toBe(false);
  expect(secretsEqual("short", "longer")).toBe(false);
});

test("API token storage keys are one-way digests rather than bearer values", () => {
  const digest = hashApiToken("vyl_secret-token");
  expect(digest).not.toContain("vyl_secret-token");
  expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(hashApiToken("vyl_secret-token")).toBe(digest);
});

test("media URLs are restricted to HTTPS LINE media hosts", () => {
  expect(isTrustedLineMediaUrl("https://obs.line-scdn.net/object/123")).toBe(true);
  expect(isTrustedLineMediaUrl("http://obs.line-scdn.net/object/123")).toBe(false);
  expect(isTrustedLineMediaUrl("https://127.0.0.1/admin")).toBe(false);
  expect(isTrustedLineMediaUrl("https://obs.line-scdn.net.attacker.example/file")).toBe(false);
  expect(isTrustedLineMediaUrl("https://user:pass@obs.line-scdn.net/file")).toBe(false);
});
