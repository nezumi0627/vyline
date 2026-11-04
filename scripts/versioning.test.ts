import { describe, expect, test } from "bun:test";
import {
  compareVersionPrecedence,
  isValidVersion,
  parseVersion,
  replaceProductVersions,
  resolveNextVersion,
} from "./versioning";

describe("version parsing", () => {
  test("accepts stable and qualified prerelease versions", () => {
    expect(isValidVersion("1.2.3")).toBe(true);
    expect(isValidVersion("1.2.3-beta.10+sha.abc")).toBe(true);
    expect(isValidVersion("1.2.3-beta.01")).toBe(false);
    expect(isValidVersion("01.2.3")).toBe(false);
    expect(parseVersion("1.2.3-rc.1")?.prerelease).toEqual(["rc", "1"]);
  });
});

describe("resolveNextVersion", () => {
  test("bumps major minor and patch from prereleases without carrying the suffix", () => {
    expect(resolveNextVersion("1.2.3-beta.8", "major")).toBe("2.0.0");
    expect(resolveNextVersion("1.2.3-beta.8", "minor")).toBe("1.3.0");
    expect(resolveNextVersion("1.2.3-beta.8", "patch")).toBe("1.2.4");
  });

  test("creates and increments alpha beta and rc versions", () => {
    expect(resolveNextVersion("1.2.0", "prerelease:beta")).toBe("1.2.1-beta.1");
    expect(resolveNextVersion("1.2.0-beta.1", "prerelease:beta")).toBe("1.2.0-beta.2");
    expect(resolveNextVersion("1.2.0-beta.10", "prerelease:beta")).toBe("1.2.0-beta.11");
    expect(resolveNextVersion("1.2.0-beta.4", "prerelease:rc")).toBe("1.2.0-rc.1");
  });

  test("promotes a prerelease without leaving a tag-creation side effect", () => {
    expect(resolveNextVersion("1.2.0-rc.1", "promote")).toBe("1.2.0");
    expect(() => resolveNextVersion("1.2.0", "promote")).toThrow();
  });

  test("accepts explicit valid versions and rejects invalid operations", () => {
    expect(resolveNextVersion("1.0.0", "1.4.0-alpha.1")).toBe("1.4.0-alpha.1");
    expect(() => resolveNextVersion("1.0.0", "1.4.0-beta.01")).toThrow();
    expect(() => resolveNextVersion("1.0.0", "1.0.0")).toThrow();
    expect(compareVersionPrecedence("1.2.0-beta.10", "1.2.0-beta.2")).toBe(1);
    expect(compareVersionPrecedence("1.2.0+build.2", "1.2.0+build.1")).toBe(0);
  });
});

test("updates product package versions while keeping other metadata", () => {
  const result = replaceProductVersions(
    '{"name":"root","version":"1.0.0"}',
    '{"name":"desktop","version":"1.0.0","private":true}',
    "1.1.0",
  );
  expect(JSON.parse(result.root)).toMatchObject({ name: "root", version: "1.1.0" });
  expect(JSON.parse(result.desktop)).toMatchObject({
    name: "desktop",
    version: "1.1.0",
    private: true,
  });
});
