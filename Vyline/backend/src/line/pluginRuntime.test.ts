import { describe, expect, it } from "bun:test";
import type { PluginContext, VylinePlugin } from "@vyline/plugin-sdk";
import { activatePlugin, deactivatePlugin, isPluginActive } from "./pluginRuntime.js";

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
});
