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

  it("serializes concurrent settings updates for one plugin", async () => {
    const accountId = `test-account-${crypto.randomUUID()}`;
    const pluginId = `test-plugin-${crypto.randomUUID()}`;
    let context: PluginContext | undefined;
    const plugin: VylinePlugin = {
      manifest: { id: pluginId, name: "Settings lock test", version: "1.0.0" },
      activate(next) {
        context = next;
      },
      deactivate() {},
    };

    expect(
      await activatePlugin(
        accountId,
        pluginId,
        "unused",
        ["settings:read", "settings:write"],
        plugin,
      ),
    ).toBeTrue();
    await Promise.all([context!.settings.set("first", 1), context!.settings.set("second", 2)]);
    await expect(context!.settings.get("first", 0)).resolves.toBe(1);
    await expect(context!.settings.get("second", 0)).resolves.toBe(2);
    await deactivatePlugin(accountId, pluginId);
  });
});
