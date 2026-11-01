import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("create-vyline-plugin scaffold", () => {
  it("generates the manifest format consumed by pluginManager", async () => {
    const root = await mkdtemp(join(tmpdir(), "vyline-plugin-test-"));
    const target = join(root, "sample-plugin");
    const result = Bun.spawnSync([process.execPath, "index.ts", target], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      id: "sample-plugin",
      main: "src/index.ts",
      permissions: ["messages:read"],
    });
    expect(await Bun.file(join(target, "vyline.plugin.json")).exists()).toBeFalse();
  });
});
