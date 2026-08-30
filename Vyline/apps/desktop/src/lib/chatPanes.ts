export const CHAT_PANE_DRAG_TYPE = "application/x-vyline-chat";
export const CHAT_PANE_SOURCE_TYPE = "application/x-vyline-chat-pane-index";
export const MAX_CHAT_PANES = 4;

export type ChatPaneState = {
  ids: string[];
  sizes: number[];
  focusedIndex: number;
};

export function equalChatPaneSizes(count: number): number[] {
  if (count <= 0) return [];
  const share = 100 / count;
  return Array.from({ length: count }, () => share);
}

export function normalizeChatPaneSizes(count: number, sizes: readonly number[]): number[] {
  if (count <= 0) return [];
  if (sizes.length !== count || sizes.some((value) => !Number.isFinite(value) || value <= 0)) {
    return equalChatPaneSizes(count);
  }
  const total = sizes.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return equalChatPaneSizes(count);
  return sizes.map((value) => (value / total) * 100);
}

function appendPaneSize(sizes: readonly number[], previousCount: number): number[] {
  if (previousCount <= 0) return [100];
  const current = normalizeChatPaneSizes(previousCount, sizes);
  const nextShare = 100 / (previousCount + 1);
  const scale = (100 - nextShare) / 100;
  return [...current.map((value) => value * scale), nextShare];
}

export function addChatPane(
  currentIds: readonly string[],
  currentSizes: readonly number[],
  chatId: string,
  maxPanes = MAX_CHAT_PANES,
): ChatPaneState & { added: boolean; full: boolean } {
  const ids = currentIds.filter(Boolean);
  const existingIndex = ids.indexOf(chatId);
  if (existingIndex >= 0) {
    return {
      ids: [...ids],
      sizes: normalizeChatPaneSizes(ids.length, currentSizes),
      focusedIndex: existingIndex,
      added: false,
      full: false,
    };
  }
  if (ids.length >= maxPanes) {
    return {
      ids: [...ids],
      sizes: normalizeChatPaneSizes(ids.length, currentSizes),
      focusedIndex: Math.max(0, Math.min(ids.length - 1, ids.length - 1)),
      added: false,
      full: true,
    };
  }
  return {
    ids: [...ids, chatId],
    sizes: appendPaneSize(currentSizes, ids.length),
    focusedIndex: ids.length,
    added: true,
    full: false,
  };
}

export function replaceFocusedChatPane(
  currentIds: readonly string[],
  currentSizes: readonly number[],
  focusedIndex: number,
  chatId: string,
): ChatPaneState {
  const ids = currentIds.filter(Boolean);
  if (ids.length === 0) {
    return { ids: [chatId], sizes: [100], focusedIndex: 0 };
  }
  const existingIndex = ids.indexOf(chatId);
  if (existingIndex >= 0) {
    return {
      ids: [...ids],
      sizes: normalizeChatPaneSizes(ids.length, currentSizes),
      focusedIndex: existingIndex,
    };
  }
  const index = Math.max(0, Math.min(ids.length - 1, focusedIndex));
  const next = [...ids];
  next[index] = chatId;
  return {
    ids: next,
    sizes: normalizeChatPaneSizes(next.length, currentSizes),
    focusedIndex: index,
  };
}

export function closeChatPaneAt(
  currentIds: readonly string[],
  currentSizes: readonly number[],
  focusedIndex: number,
  index: number,
): ChatPaneState {
  const ids = currentIds.filter(Boolean);
  if (index < 0 || index >= ids.length) {
    return {
      ids: [...ids],
      sizes: normalizeChatPaneSizes(ids.length, currentSizes),
      focusedIndex: Math.max(0, Math.min(ids.length - 1, focusedIndex)),
    };
  }
  const nextIds = ids.filter((_, itemIndex) => itemIndex !== index);
  if (nextIds.length === 0) return { ids: [], sizes: [], focusedIndex: 0 };
  let nextFocused = focusedIndex;
  if (index < focusedIndex) nextFocused -= 1;
  else if (index === focusedIndex) nextFocused = Math.min(index, nextIds.length - 1);
  const nextSizes = normalizeChatPaneSizes(
    nextIds.length,
    normalizeChatPaneSizes(ids.length, currentSizes).filter((_, itemIndex) => itemIndex !== index),
  );
  return {
    ids: nextIds,
    sizes: nextSizes,
    focusedIndex: Math.max(0, nextFocused),
  };
}

export function resizeAdjacentChatPanes(
  currentSizes: readonly number[],
  dividerIndex: number,
  deltaPercent: number,
  minPercent: number,
): number[] {
  const sizes = normalizeChatPaneSizes(currentSizes.length, currentSizes);
  if (dividerIndex < 0 || dividerIndex >= sizes.length - 1 || !Number.isFinite(deltaPercent)) {
    return sizes;
  }
  const left = sizes[dividerIndex]!;
  const right = sizes[dividerIndex + 1]!;
  const lower = minPercent - left;
  const upper = right - minPercent;
  const delta = Math.max(lower, Math.min(upper, deltaPercent));
  const next = [...sizes];
  next[dividerIndex] = left + delta;
  next[dividerIndex + 1] = right - delta;
  return next;
}


export type ChatPaneLayoutMode = "columns" | "split-left" | "split-right" | "grid";

export type ChatPaneRect = { x: number; y: number; width: number; height: number };

export function normalizeChatPaneLayout(count: number, mode: ChatPaneLayoutMode): ChatPaneLayoutMode {
  if (count <= 2) return "columns";
  if (count === 3) return mode === "split-left" || mode === "split-right" ? mode : "columns";
  if (count === 4) return mode === "grid" ? "grid" : "columns";
  return "columns";
}

export function chatPaneRects(
  count: number,
  mode: ChatPaneLayoutMode,
  mainRatio = 50,
  crossRatio = 50,
): ChatPaneRect[] {
  const normalized = normalizeChatPaneLayout(count, mode);
  const main = Math.max(22, Math.min(78, mainRatio));
  const cross = Math.max(22, Math.min(78, crossRatio));
  if (count <= 0) return [];
  if (normalized === "columns") {
    const width = 100 / count;
    return Array.from({ length: count }, (_, index) => ({ x: width * index, y: 0, width, height: 100 }));
  }
  if (count === 3 && normalized === "split-left") {
    return [
      { x: 0, y: 0, width: main, height: cross },
      { x: 0, y: cross, width: main, height: 100 - cross },
      { x: main, y: 0, width: 100 - main, height: 100 },
    ];
  }
  if (count === 3 && normalized === "split-right") {
    return [
      { x: 0, y: 0, width: main, height: 100 },
      { x: main, y: 0, width: 100 - main, height: cross },
      { x: main, y: cross, width: 100 - main, height: 100 - cross },
    ];
  }
  return [
    { x: 0, y: 0, width: main, height: cross },
    { x: main, y: 0, width: 100 - main, height: cross },
    { x: 0, y: cross, width: main, height: 100 - cross },
    { x: main, y: cross, width: 100 - main, height: 100 - cross },
  ].slice(0, count);
}

export function chatPaneDropPlan(
  countAfterDrop: number,
  xRatio: number,
  yRatio: number,
): { mode: ChatPaneLayoutMode; slot: number; label: string } {
  const x = Math.max(0, Math.min(0.999999, xRatio));
  const y = Math.max(0, Math.min(0.999999, yRatio));
  if (countAfterDrop <= 1) return { mode: "columns", slot: 0, label: "ここに表示" };
  if (countAfterDrop === 2) {
    const slot = x < 0.5 ? 0 : 1;
    return { mode: "columns", slot, label: slot === 0 ? "左に追加" : "右に追加" };
  }
  if (countAfterDrop === 3) {
    if (y > 0.27 && y < 0.73) {
      const slot = Math.min(2, Math.floor(x * 3));
      return { mode: "columns", slot, label: `左から${slot + 1}番目に追加` };
    }
    if (x < 0.5) {
      const slot = y < 0.5 ? 0 : 1;
      return { mode: "split-left", slot, label: y < 0.5 ? "左上に追加" : "左下に追加" };
    }
    const slot = y < 0.5 ? 1 : 2;
    return { mode: "split-right", slot, label: y < 0.5 ? "右上に追加" : "右下に追加" };
  }
  if (y > 0.30 && y < 0.70) {
    const slot = Math.min(3, Math.floor(x * 4));
    return { mode: "columns", slot, label: `左から${slot + 1}番目に追加` };
  }
  const left = x < 0.5;
  const top = y < 0.5;
  const slot = top ? (left ? 0 : 1) : left ? 2 : 3;
  const label = top ? (left ? "左上に追加" : "右上に追加") : left ? "左下に追加" : "右下に追加";
  return { mode: "grid", slot, label };
}

export function placeChatPane(ids: readonly string[], chatId: string, slot: number): string[] {
  const without = ids.filter((id) => id && id !== chatId);
  const index = Math.max(0, Math.min(without.length, slot));
  const next = [...without];
  next.splice(index, 0, chatId);
  return next.slice(0, MAX_CHAT_PANES);
}
