import { describe, expect, it } from "bun:test";
import type { PluginContext, VylinePlugin } from "@vyline/plugin-sdk";
import { deactivatePluginsForAccount } from "./pluginManager.js";
import {
  activatePlugin,
  activePluginIdsFor,
  deactivatePlugin,
  isPluginActive,
} from "./pluginRuntime.js";

describe("plugin runtime lifecycle", () => {
  it("keeps the activation context and calls deactivate when disabled", async () => {
    const accountId = `test-account-${crypto.randomUUID()}`;
    const pluginId = `test-plugin-${crypto.randomUUID()}`;
    let activatedContext: PluginContext | undefined;
    let deactivatedContext: PluginContext | undefined;
    const plugin: VylinePlugin = {
      manifest: { id: pluginId, name: "Lifecycle test", version: "1.0.0" },
      activate(context) {
        activatedContext = context;
      },
      deactivate(context) {
        deactivatedContext = context;
      },
    };

    expect(await activatePlugin(accountId, pluginId, "unused", [], plugin)).toBeTrue();
    expect(isPluginActive(accountId, pluginId)).toBeTrue();

    await deactivatePlugin(accountId, pluginId);

    expect(isPluginActive(accountId, pluginId)).toBeFalse();
    expect(deactivatedContext).toBe(activatedContext);
  });

  it("shares concurrent activation for the same account and plugin", async () => {
    const accountId = `test-account-${crypto.randomUUID()}`;
    const pluginId = `test-plugin-${crypto.randomUUID()}`;
    let activateCount = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plugin: VylinePlugin = {
      manifest: { id: pluginId, name: "Concurrent activation test", version: "1.0.0" },
      async activate() {
        activateCount += 1;
        await gate;
      },
      deactivate() {},
    };

    const first = activatePlugin(accountId, pluginId, "unused", [], plugin);
    const second = activatePlugin(accountId, pluginId, "unused", [], plugin);
    release();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(activateCount).toBe(1);
    await deactivatePlugin(accountId, pluginId);
  });

  it("lists only active plugins for an account so logout can release them", async () => {
    const accountId = `test-account-${crypto.randomUUID()}`;
    const pluginId = `test-plugin-${crypto.randomUUID()}`;
    const plugin: VylinePlugin = {
      manifest: { id: pluginId, name: "Active list test", version: "1.0.0" },
      activate() {},
      deactivate() {},
    };

    expect(await activatePlugin(accountId, pluginId, "unused", [], plugin)).toBeTrue();
    expect(activePluginIdsFor(accountId)).toEqual([pluginId]);
    await deactivatePluginsForAccount(accountId);
    expect(activePluginIdsFor(accountId)).toEqual([]);
  });
});
