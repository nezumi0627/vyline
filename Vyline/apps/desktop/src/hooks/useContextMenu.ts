/**
 * hooks/useContextMenu.ts
 *
 * 右クリックコンテキストメニューの表示状態を管理するフック。
 */

import { useCallback, useEffect, useState } from "react";
import type { MessageMenuState } from "../types/index.js";

export function useContextMenu() {
  const [menu, setMenu] = useState<MessageMenuState | null>(null);

  const open = useCallback((x: number, y: number, message: MessageMenuState["message"]) => {
    setMenu({ x, y, message });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", close);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", close);
    };
  }, [menu, close]);

  return { menu, open, close };
}
