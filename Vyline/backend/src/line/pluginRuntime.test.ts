import { describe, expect, it } from "bun:test";
import type { PluginContext, VylinePlugin } from "@vyline/plugin-sdk";
import { deactivatePluginsForAccount } from "./pluginManager.js";
import {
  activatePlugin,
  activePluginIdsFor,
  deactivatePlugin,
  isPluginActive,
  withPluginLifecycleTimeout,
} from "./pluginRuntime.js";

describe("plugin runtime lifecycle", () => {
  it("bounds a stuck plugin lifecycle without waiting forever", async () => {
    await expect(withPluginLifecycleTimeout(() => new Promise<void>(() => {}), 1)).rejects.toThrow(
      "plugin lifecycle timed out",
    );
  });

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
