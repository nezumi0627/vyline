import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { CallRecordingStore } from "./callRecordingStore.js";
import { RecordingSettings } from "./recordingSettings.js";

test("path suggestions stay inside approved roots, exclude managed data and bound enumeration", async () => {
  const root = await mkdtemp(join(tmpdir(), "vyline-recording-paths-"));
  const store = new CallRecordingStore(join(root, "index"));
  const disk = join(root, "disk");
  await mkdir(disk);
  const settings = new RecordingSettings(store, [disk]);
  const album = join(disk, "音声記録");
  const outside = join(root, "outside");
  const managed = join(disk, "a".repeat(64));
  try {
    for (const path of [album, join(disk, "video"), join(disk, ".hidden"), outside, managed])
      await mkdir(path);
    await mkdir(join(managed, "private-name"));
    await writeFile(join(disk, "private-file.txt"), "synthetic");
    await symlink(outside, join(disk, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect((await settings.suggestPaths("")).items).toEqual([disk]);
    expect((await settings.suggestPaths(disk)).items).toEqual([join(disk, "video"), album].sort());
    expect((await settings.suggestPaths(`${disk}${sep}音`)).items).toEqual([album]);
    expect((await settings.suggestPaths(`${disk}${sep}none`)).items).toEqual([]);
    await expect(settings.suggestPaths(outside)).rejects.toThrow("許可された保存ルートの外");
    await expect(settings.suggestPaths(join(root, "missing"))).rejects.toThrow(
      "許可された保存ルートの外",
    );
    await expect(settings.localPath(join(root, "missing"))).rejects.toThrow(
      "許可された保存ルートの外",
    );
    await expect(settings.suggestPaths(managed)).rejects.toThrow();
    await expect(settings.suggestPaths(join(disk, "linked"))).rejects.toThrow();
    await expect(settings.suggestPaths(join(disk, "linked", "missing"))).rejects.toThrow(
      "保存先のリンク",
    );
    await expect(settings.localPath(join(disk, "linked", "missing"))).rejects.toThrow(
      "保存先のリンク",
    );
    const nested = new RecordingSettings(store, [disk, join(disk, "video")]);
    expect((await nested.suggestPaths(disk)).items).toEqual([join(disk, "video"), album].sort());
    await expect(settings.suggestPaths(join(disk, ".hidden"))).rejects.toThrow();
    for (let i = 0; i < 25; i++) await mkdir(join(disk, `folder-${i}`));
    const bounded = await settings.suggestPaths(`${disk}${sep}folder-`);
    expect(bounded.items).toHaveLength(20);
    expect(bounded.truncated).toBe(true);
    const concurrent = await Promise.allSettled(
      Array.from({ length: 5 }, () => settings.suggestPaths(disk)),
    );
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("GUI preferences and immutable destinations stay account-scoped and within approved roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "vyline-recording-settings-"));
  const store = new CallRecordingStore(join(root, "index"));
  const disk = join(root, "mounted-external-disk");
  await mkdir(disk);
  const settings = new RecordingSettings(store, [disk]);
  try {
    expect(settings.get("owner")).toEqual({
      automatic: false,
      kind: "audio",
      retentionDays: 30,
      targetId: null,
      consentAccepted: false,
    });
    const target = await settings.addTarget("owner", {
      name: "外部ディスク",
      kind: "local",
      path: disk,
    });
    expect(settings.targets("owner")).toHaveLength(1);
    expect(settings.targets("other")).toEqual([]);
    expect(() => settings.target("other", target.id)).toThrow();
    expect(() => settings.save("owner", { ...settings.get("owner"), automatic: true })).toThrow();
    const saved = settings.save("owner", {
      automatic: true,
      kind: "video",
      retentionDays: 0,
      targetId: target.id,
      consentAccepted: true,
    });
    expect(saved.retentionDays).toBe(0);
    await expect(
      settings.addTarget("owner", { name: "escape", kind: "local", path: root }),
    ).rejects.toThrow();
    const dav = await settings.addTarget("owner", {
      name: "NAS",
      kind: "webdav",
      path: "https://192.168.128.20/recordings/",
      username: "synthetic",
      password: "test-password",
      allowPrivateNetwork: true,
    });
    expect(JSON.stringify(settings.targets("owner"))).not.toContain("test-password");
    expect((await settings.connection("owner", dav.id)).password).toBe("test-password");
    const recording = await store.create(
      "owner",
      {
        sessionId: "test",
        chatMid: `c${"1".repeat(32)}`,
        title: "generated",
        kind: "audio",
        mimeType: "audio/webm",
        retentionDays: 0,
      },
      10,
      { id: target.id, directory: await settings.localDirectory("owner", target.id) },
    );
    expect(() => settings.removeTarget("owner", target.id)).toThrow();
    await store.remove("owner", recording.id);
    settings.removeTarget("owner", target.id);
    expect(settings.get("owner").targetId).toBeNull();
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
