import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Bun's mock.module replacements outlive mock.restore(). Keep them in a child
// process, so importing this test never replaces React or the real app stores.
function isolatedDialogTest(assertions: string): void {
  const moduleUrl = new URL("./controller-dialog.ts", import.meta.url).href;
  const storePath = fileURLToPath(new URL("../lib/store.ts", import.meta.url));
  const designPath = fileURLToPath(new URL("./design-system-store.ts", import.meta.url));
  const result = Bun.spawnSync([
    process.execPath,
    "--eval",
    `
      import { expect, mock } from "bun:test";
      let accountId = "test-account-a";
      let mode = "apple";
      let confirmResult = true;
      let promptResult = "browser input";
      const confirmCalls = [];
      const promptCalls = [];
      globalThis.window = {
        confirm: (text) => { confirmCalls.push(text); return confirmResult; },
        prompt: (text, value) => { promptCalls.push([text, value]); return promptResult; },
      };
      let onDialogChange = () => {};
      let subscribed = false;
      mock.module("react", () => ({ useSyncExternalStore: (subscribe, snapshot) => {
        if (!subscribed) { subscribed = true; subscribe(() => onDialogChange()); }
        return snapshot();
      } }));
      function trackedAbort() {
        const controller = new AbortController();
        const signal = controller.signal;
        const active = new Set();
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);
        signal.addEventListener = (type, listener, options) => {
          if (type === "abort") active.add(listener);
          add(type, listener, options);
        };
        signal.removeEventListener = (type, listener, options) => {
          if (type === "abort") active.delete(listener);
          remove(type, listener, options);
        };
        return { controller, signal, active };
      }
      mock.module(${JSON.stringify(storePath)}, () => ({ useStore: { getState: () => ({ accountId }) } }));
      mock.module(${JSON.stringify(designPath)}, () => ({
        isComposeMode: (value) => ["apple", "fluent", "miuix"].includes(value),
        useDesignSystemStore: { getState: () => ({ mode }) },
      }));
      const { requestControllerConfirm, requestControllerPrompt, closeControllerDialog, useControllerDialogSnapshot } = await import(${JSON.stringify(moduleUrl)});
      ${assertions}
    `,
  ], { cwd: fileURLToPath(new URL("../../", import.meta.url)) });
  expect({
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }).toEqual({ exitCode: 0, stderr: "", stdout: "" });
}

describe("controller dialog", () => {
  test("confirm remains unresolved until the matching accept in every Compose mode", () => {
    isolatedDialogTest(`
      for (mode of ["apple", "fluent", "miuix"]) {
        let settled = false;
        const result = requestControllerConfirm("Continue?").then(value => { settled = true; return value; });
        const dialog = useControllerDialogSnapshot();
        expect(dialog).not.toBeNull();
        await Promise.resolve();
        expect(settled).toBe(false);
        closeControllerDialog("stale-dialog", "");
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(useControllerDialogSnapshot()).toBe(dialog);
        closeControllerDialog(dialog.id, "");
        expect(await result).toBe(true);
        expect(useControllerDialogSnapshot()).toBeNull();
      }
      expect(confirmCalls).toEqual([]);
    `);
  });

  test("omitted confirm options preserve the existing snapshot", () => {
    isolatedDialogTest(`
      const result = requestControllerConfirm("Continue?");
      expect(useControllerDialogSnapshot()).toEqual({ id: "dialog-1", text: "Continue?", prompt: false, value: "" });
      closeControllerDialog();
      expect(await result).toBe(false);
    `);
  });

  test("confirm snapshots copy optional title, accept label and cancel-first focus", () => {
    isolatedDialogTest(`
      const options = { title: "Confirm action", acceptLabel: "Continue", cancelFirst: true };
      const result = requestControllerConfirm("Continue?", options);
      options.title = "changed after request";
      expect(useControllerDialogSnapshot()).toEqual({
        id: "dialog-1", text: "Continue?", prompt: false, value: "",
        title: "Confirm action", acceptLabel: "Continue", cancelFirst: true,
      });
      closeControllerDialog("dialog-1", "");
      expect(await result).toBe(true);
      const next = requestControllerConfirm("Again?", { cancelFirst: false });
      expect(useControllerDialogSnapshot()).toEqual({ id: "dialog-2", text: "Again?", prompt: false, value: "", cancelFirst: false });
      closeControllerDialog();
      expect(await next).toBe(false);
    `);
  });

  test("cancellation resolves false and cannot be changed by a late accept", () => {
    isolatedDialogTest(`
      const result = requestControllerConfirm("Continue?", { cancelFirst: true });
      const { id } = useControllerDialogSnapshot();
      closeControllerDialog(id);
      closeControllerDialog(id, "");
      expect(await result).toBe(false);
      expect(useControllerDialogSnapshot()).toBeNull();
    `);
  });

  test("superseding cancels the previous request and ignores its late response", () => {
    isolatedDialogTest(`
      const first = requestControllerConfirm("First?");
      const firstId = useControllerDialogSnapshot().id;
      let secondSettled = false;
      const second = requestControllerConfirm("Second?").then(value => { secondSettled = true; return value; });
      const secondDialog = useControllerDialogSnapshot();
      expect(secondDialog.id).not.toBe(firstId);
      expect(await first).toBe(false);
      closeControllerDialog(firstId, "");
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      expect(useControllerDialogSnapshot()).toBe(secondDialog);
      closeControllerDialog(secondDialog.id, "");
      expect(await second).toBe(true);
    `);
  });

  test("abort immediately closes and settles only its confirmation, with listener cleanup", () => {
    isolatedDialogTest(`
      const { controller, signal, active } = trackedAbort();
      const result = requestControllerConfirm("Call?", { cancelFirst: true }, signal);
      const dialog = useControllerDialogSnapshot();
      expect(active.size).toBe(1);
      expect(Object.keys(dialog)).not.toContain("signal");
      controller.abort();
      expect(useControllerDialogSnapshot()).toBeNull();
      expect(active.size).toBe(0);
      closeControllerDialog(dialog.id, "");
      expect(await result).toBe(false);
    `);
  });

  test("aborting a superseded confirmation cannot close a newer unrelated prompt", () => {
    isolatedDialogTest(`
      const { controller, signal, active } = trackedAbort();
      const old = requestControllerConfirm("Call?", undefined, signal);
      const oldId = useControllerDialogSnapshot().id;
      const next = requestControllerPrompt("Unrelated?", "Keep");
      const nextDialog = useControllerDialogSnapshot();
      expect(await old).toBe(false);
      expect(active.size).toBe(0);
      controller.abort();
      closeControllerDialog(oldId, "");
      expect(useControllerDialogSnapshot()).toBe(nextDialog);
      closeControllerDialog(nextDialog.id, "Edited");
      expect(await next).toBe("Edited");
    `);
  });

  test("every confirmation resolution removes its abort listener", () => {
    isolatedDialogTest(`
      for (const reason of ["accept", "cancel", "account", "replace"]) {
        accountId = "test-account-a";
        const { controller, signal, active } = trackedAbort();
        const result = requestControllerConfirm("Continue?", undefined, signal);
        const id = useControllerDialogSnapshot().id;
        expect(active.size).toBe(1);
        let replacement;
        if (reason === "replace") replacement = requestControllerConfirm("Next?");
        else {
          if (reason === "account") accountId = "test-account-b";
          closeControllerDialog(id, reason === "cancel" ? null : "");
        }
        expect(active.size).toBe(0);
        expect(await result).toBe(reason === "accept");
        controller.abort();
        if (replacement) {
          expect(useControllerDialogSnapshot().text).toBe("Next?");
          closeControllerDialog();
          expect(await replacement).toBe(false);
        }
      }
    `);
  });

  test("an already-aborted request neither replaces a dialog nor opens browser confirmation", () => {
    isolatedDialogTest(`
      const current = requestControllerPrompt("Keep?", "Keep");
      const dialog = useControllerDialogSnapshot();
      const { controller, signal, active } = trackedAbort();
      controller.abort();
      for (mode of ["apple", "legacy"]) {
        expect(await requestControllerConfirm("Aborted?", undefined, signal)).toBe(false);
        expect(useControllerDialogSnapshot()).toBe(dialog);
        expect(active.size).toBe(0);
      }
      expect(confirmCalls).toEqual([]);
      closeControllerDialog(dialog.id, "Keep");
      expect(await current).toBe("Keep");
    `);
  });

  test("synchronous publication abort settles and cleans up before a newer request", () => {
    isolatedDialogTest(`
      useControllerDialogSnapshot();
      const { controller, signal, active } = trackedAbort();
      let next;
      onDialogChange = () => {
        if (useControllerDialogSnapshot()?.text !== "Call?") return;
        onDialogChange = () => {};
        controller.abort();
        next = requestControllerPrompt("Next?");
      };
      const result = requestControllerConfirm("Call?", undefined, signal);
      expect(await result).toBe(false);
      expect(active.size).toBe(0);
      expect(useControllerDialogSnapshot().text).toBe("Next?");
      closeControllerDialog(undefined, "Kept");
      expect(await next).toBe("Kept");
    `);
  });

  test("a newer request opened by replacement notification cannot be orphaned", () => {
    isolatedDialogTest(`
      const first = requestControllerConfirm("First?");
      useControllerDialogSnapshot();
      let newest;
      onDialogChange = () => {
        if (useControllerDialogSnapshot() !== null) return;
        onDialogChange = () => {};
        newest = requestControllerPrompt("Newest?");
      };
      const { signal, active } = trackedAbort();
      const middle = requestControllerConfirm("Middle?", undefined, signal);
      expect(await first).toBe(false);
      expect(await middle).toBe(false);
      expect(active.size).toBe(0);
      expect(useControllerDialogSnapshot().text).toBe("Newest?");
      closeControllerDialog(undefined, "Kept");
      expect(await newest).toBe("Kept");
    `);
  });

  test("account mismatch hides a request and rejects its accept", () => {
    isolatedDialogTest(`
      const result = requestControllerConfirm("Continue?");
      const { id } = useControllerDialogSnapshot();
      accountId = "test-account-b";
      expect(useControllerDialogSnapshot()).toBeNull();
      closeControllerDialog(id, "");
      expect(await result).toBe(false);
      const next = requestControllerConfirm("New account?");
      expect(useControllerDialogSnapshot().text).toBe("New account?");
      closeControllerDialog(useControllerDialogSnapshot().id, "");
      expect(await next).toBe(true);
    `);
  });

  test("prompts preserve default/value snapshots, accepted input and cancellation", () => {
    isolatedDialogTest(`
      const empty = requestControllerPrompt("Name?");
      expect(useControllerDialogSnapshot()).toEqual({ id: "dialog-1", text: "Name?", prompt: true, value: "" });
      closeControllerDialog("dialog-1", "");
      expect(await empty).toBe("");
      const input = requestControllerPrompt("Name?", "Initial");
      expect(useControllerDialogSnapshot()).toEqual({ id: "dialog-2", text: "Name?", prompt: true, value: "Initial" });
      closeControllerDialog("dialog-2", "Edited");
      expect(await input).toBe("Edited");
      const cancelled = requestControllerPrompt("Name?", "Initial");
      closeControllerDialog();
      expect(await cancelled).toBeNull();
      expect(promptCalls).toEqual([]);
    `);
  });

  test("DOM modes queue a snapshot for the in-app dialog instead of browser confirm", () => {
    isolatedDialogTest(`
      for (mode of ["legacy", "nezu"]) {
        let settled = false;
        const pending = requestControllerConfirm("Continue?", { title: "Title", acceptLabel: "Go", cancelFirst: true }).then(value => { settled = true; return value; });
        const dialog = useControllerDialogSnapshot();
        expect(dialog).not.toBeNull();
        expect(dialog.text).toBe("Continue?");
        await Promise.resolve();
        expect(settled).toBe(false);
        closeControllerDialog(dialog.id, "");
        expect(await pending).toBe(true);
        expect(useControllerDialogSnapshot()).toBeNull();
        const input = requestControllerPrompt("Name?", "Initial");
        expect(useControllerDialogSnapshot()).toEqual({ id: dialog.id.replace(/\\d+/, (n) => String(Number(n) + 1)), text: "Name?", prompt: true, value: "Initial" });
        closeControllerDialog(useControllerDialogSnapshot().id, "typed");
        expect(await input).toBe("typed");
        expect(useControllerDialogSnapshot()).toBeNull();
      }
      expect(confirmCalls).toEqual([]);
      expect(promptCalls).toEqual([]);
    `);
  });
});
