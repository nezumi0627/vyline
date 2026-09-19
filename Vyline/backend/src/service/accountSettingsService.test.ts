import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

if (process.env.VYLINE_ACCOUNT_SETTINGS_TEST_CHILD !== "1") {
  test("account settings persistence runs in an isolated process", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "vyline-account-settings-test-"));
    try {
      const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
        env: {
          ...process.env,
          VYLINE_ACCOUNT_SETTINGS_TEST_CHILD: "1",
          VYLINE_ACCOUNT_SETTINGS_TEST_ROOT: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(`${stdout}\n${stderr}`).toContain("0 fail");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
} else {
  process.env.VYLINE_DATA_DIR = process.env.VYLINE_ACCOUNT_SETTINGS_TEST_ROOT!;
  const settings = await import("./accountSettingsService.js");

  describe("account settings persistence", () => {
    test("concurrent patches for one account preserve both changes", async () => {
      const defaults = settings.defaultAccountSettings();

      await Promise.all([
        settings.saveAccountSettings("account-a", { displayName: "Alice" }),
        settings.saveAccountSettings("account-a", {
          layout: { ...defaults.layout, compact: true },
        }),
      ]);

      const saved = await settings.loadAccountSettings("account-a");
      expect(saved.displayName).toBe("Alice");
      expect(saved.layout.compact).toBe(true);
    });
  });
}
