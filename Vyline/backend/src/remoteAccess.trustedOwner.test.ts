import { afterEach, expect, test } from "bun:test";
import {
  isLoopbackRequestAddress,
  trustsRemoteOwnerAccess,
  withServerVerifiedLocalRequest,
} from "./remoteAccess.js";

const previousTrustedRemoteOwner = process.env.VYLINE_TRUST_REMOTE_OWNER;

afterEach(() => {
  if (previousTrustedRemoteOwner === undefined) {
    Reflect.deleteProperty(process.env, "VYLINE_TRUST_REMOTE_OWNER");
  } else {
    process.env.VYLINE_TRUST_REMOTE_OWNER = previousTrustedRemoteOwner;
  }
});

test("trusted remote owner mode promotes a remote request only when explicitly enabled", () => {
  process.env.VYLINE_TRUST_REMOTE_OWNER = "false";
  expect(trustsRemoteOwnerAccess()).toBe(false);
  expect(isLoopbackRequestAddress("192.168.128.30")).toBe(false);

  const untrusted = withServerVerifiedLocalRequest(
    new Request("http://localhost/resource", {
      headers: { "x-vyline-local-request": "1" },
    }),
    "192.168.128.30",
  );
  expect(untrusted.headers.get("x-vyline-local-request")).toBe("0");

  process.env.VYLINE_TRUST_REMOTE_OWNER = "true";
  expect(trustsRemoteOwnerAccess()).toBe(true);
  expect(isLoopbackRequestAddress("192.168.128.30")).toBe(true);

  const trusted = withServerVerifiedLocalRequest(
    new Request("http://localhost/resource", {
      headers: { "x-vyline-local-request": "0" },
    }),
    "192.168.128.30",
  );
  expect(trusted.headers.get("x-vyline-local-request")).toBe("1");
});
