import { describe, expect, test } from "bun:test";
import { isAllowedLoopbackRequest, isLocalInstallerRuntime, isLoopbackHost } from "./updater.js";

describe("local installer updater host checks", () => {
  test("accepts loopback hostnames with ports and origins", () => {
    expect(isLoopbackHost("127.0.0.1:18765")).toBe(true);
    expect(isLoopbackHost("http://localhost:5173")).toBe(true);
    expect(isLoopbackHost("http://[::1]:3001")).toBe(true);
  });

  test("rejects LAN, public, malformed, and lookalike hosts", () => {
    expect(isLoopbackHost("192.168.1.20:18765")).toBe(false);
    expect(isLoopbackHost("https://example.com")).toBe(false);
    expect(isLoopbackHost("http://localhost.example.com")).toBe(false);
    expect(isLoopbackHost("127.999.1.1:18765")).toBe(false);
    expect(isLoopbackHost("not a host")).toBe(false);
  });

  test("requires an exact same-origin loopback request", () => {
    expect(isAllowedLoopbackRequest("http://127.0.0.1:18765", "127.0.0.1:18765")).toBe(true);
    expect(isAllowedLoopbackRequest("http://localhost:3000", "localhost:18765")).toBe(false);
    expect(isAllowedLoopbackRequest("https://attacker.example", "127.0.0.1:18765")).toBe(false);
    expect(isAllowedLoopbackRequest(undefined, "127.0.0.1:18765")).toBe(false);
  });

  test("enables installer launch only for production loopback servers", () => {
    expect(isLocalInstallerRuntime("production", "127.0.0.1", undefined)).toBe(true);
    expect(isLocalInstallerRuntime("development", "127.0.0.1", undefined)).toBe(false);
    expect(isLocalInstallerRuntime("production", "0.0.0.0", "true")).toBe(false);
    expect(isLocalInstallerRuntime("production", "192.168.1.5", undefined)).toBe(false);
  });
});
