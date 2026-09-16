import { useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { isComposeMode, useDesignSystemStore } from "./design-system-store";

export type ControllerConfirmOptions = {
  title?: string;
  acceptLabel?: string;
  /** Opt in to initially focusing cancellation; omission preserves existing focus. */
  cancelFirst?: boolean;
};
export type ControllerDialog = { id: string; text: string; prompt: boolean; value: string } & ControllerConfirmOptions;
let current: { snapshot: ControllerDialog; accountId: string | null; resolve: (value: string | null) => void } | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const snapshot = () => current?.accountId === useStore.getState().accountId ? current?.snapshot ?? null : null;
export function useControllerDialogSnapshot() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot, () => null);
}
export function closeControllerDialog(id?: string, value: string | null = null): void {
  const dialog = current;
  if (!dialog || id !== undefined && dialog.snapshot.id !== id) return;
  current = null;
  // Settle (and remove cancellation listeners) before synchronous notifications
  // can publish a newer dialog or change accounts.
  dialog.resolve(dialog.accountId === useStore.getState().accountId ? value : null);
  notify();
}
function ask(text: string, prompt: boolean, value = "", options?: ControllerConfirmOptions, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const requestGeneration = ++generation;
  closeControllerDialog();
  // Closing the old dialog can synchronously open a newer, unrelated request.
  if (requestGeneration !== generation || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = `dialog-${requestGeneration}`;
    const abort = () => closeControllerDialog(id);
    current = {
      snapshot: {
        id, text, prompt, value,
        ...(options?.title !== undefined ? { title: options.title } : {}),
        ...(options?.acceptLabel !== undefined ? { acceptLabel: options.acceptLabel } : {}),
        ...(options?.cancelFirst !== undefined ? { cancelFirst: options.cancelFirst } : {}),
      },
      accountId: useStore.getState().accountId,
      resolve: (result) => {
        signal?.removeEventListener("abort", abort);
        resolve(result);
      },
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    else notify();
  });
}
export async function requestControllerConfirm(text: string, options?: ControllerConfirmOptions, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  // DOM modes render the same snapshot via LegacyControllerDialogHost; Compose
  // modes render it in Kotlin. Never fall back to blocking window.confirm here:
  // callers already run inside the mode-appropriate UI runtime.
  if (!isComposeMode(useDesignSystemStore.getState().mode))
    return await ask(text, false, "", options, signal) !== null && !signal?.aborted;
  return await ask(text, false, "", options, signal) !== null;
}
export function requestControllerPrompt(text: string, value = ""): Promise<string | null> {
  return ask(text, true, value);
}
