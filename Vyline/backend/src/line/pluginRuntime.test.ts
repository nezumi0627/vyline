import { describe, expect, it } from "bun:test";
import type { PluginContext, VylinePlugin } from "@vyline/plugin-sdk";
import { deactivatePluginsForAccount } from "./pluginManager.js";
import {
  activatePlugin,
  activePluginIdsFor,
  dispatchPluginMessage,
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

  it("isolates rejected async message handlers", async () => {
    const accountId = `test-account-${crypto.randomUUID()}`;
    const pluginId = `test-plugin-${crypto.randomUUID()}`;
    let handled = false;
    const plugin: VylinePlugin = {
      manifest: { id: pluginId, name: "Async handler test", version: "1.0.0" },
      activate(context) {
        context.messages.on("message", async () => {
          handled = true;
          throw new Error("expected plugin failure");
        });
      },
      deactivate() {},
    };

    expect(
      await activatePlugin(accountId, pluginId, "unused", ["messages:read"], plugin),
    ).toBeTrue();
    dispatchPluginMessage(accountId, {
      id: "message-1",
      chatId: "chat-1",
      contentType: "NONE",
      createdAt: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handled).toBeTrue();
    await deactivatePlugin(accountId, pluginId);
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
