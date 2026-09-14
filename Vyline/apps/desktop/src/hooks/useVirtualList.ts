import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * 可変高さリストのウィンドウ仮想化
 *
 * 行の実測高さ（ref 経由）を蓄積し、スクロール位置から可視ウィンドウを算出。
 * 高さ未測定の行は estimateHeight で近似する（初回のみ若干のズレが生じる）。
 */

export type VirtualRow<T> = {
  key: string;
  item: T;
};

export function useVirtualList<T>({
  rows,
  estimateHeight,
  overscan = 10,
  resetKey,
}: {
  rows: VirtualRow<T>[];
  estimateHeight: (item: T) => number;
  overscan?: number;
  /** 値が変わるとスクロール位置を初期化する（チャット切替など）。 */
  resetKey?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const measurementFrameRef = useRef<number | null>(null);
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observers = useRef(new Map<string, ResizeObserver>());
  const elements = useRef(new Map<string, HTMLElement>());
  const anchorRef = useRef<{ key: string; center: boolean } | null>(null);
  const viewportAnchorRef = useRef<{
    rows: { key: string; top: number; listOffset: number }[];
    scrollTop: number;
    scope: typeof resetKey;
  } | null>(null);
  const keepBottomRef = useRef(false);
  const bottomCorrectionFrameRef = useRef<number | null>(null);
  const bottomCorrectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBottomCorrection = useCallback(() => {
    if (bottomCorrectionFrameRef.current != null) {
      cancelAnimationFrame(bottomCorrectionFrameRef.current);
      bottomCorrectionFrameRef.current = null;
    }
    if (bottomCorrectionTimerRef.current != null) {
      clearTimeout(bottomCorrectionTimerRef.current);
      bottomCorrectionTimerRef.current = null;
    }
  }, []);

  const preserveInitialPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el || el.clientHeight === 0) return;

    if (keepBottomRef.current) {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - maxScrollTop) > 0.5) {
        el.scrollTo({ top: maxScrollTop, behavior: "auto" });
      }
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) return;
    const row = elements.current.get(anchor.key);
    if (!row) return;

    const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    const desiredTop = anchor.center ? el.clientHeight / 2 : 0;
    const nextTop = Math.max(0, el.scrollTop + rowTop - desiredTop);
    if (Math.abs(nextTop - el.scrollTop) > 0.5) {
      el.scrollTo({ top: nextTop, behavior: "auto" });
    }
  }, []);

  const offsets = useMemo(() => {
    const arr: number[] = [];
    const byKey = new Map<string, number>();
    let acc = 0;
    for (const r of rows) {
      arr.push(acc);
      byKey.set(r.key, acc);
      acc += heights.current.get(r.key) ?? estimateHeight(r.item);
    }
    return { offsets: arr, byKey, total: acc };
  }, [rows, estimateHeight, measuredVersion]);
  const layoutRef = useRef({ offsets, resetKey });

  // Keep the row the user is viewing, not the position at which a request began.
  const captureViewportAnchor = useCallback(() => {
    viewportAnchorRef.current = null;
    const el = containerRef.current;
    if (!el || el.clientHeight === 0 || keepBottomRef.current || anchorRef.current) return;
    const viewport = el.getBoundingClientRect();
    const candidates: { key: string; top: number; listOffset: number }[] = [];
    for (const [key, row] of elements.current) {
      const rect = row.getBoundingClientRect();
      const listOffset = layoutRef.current.offsets.byKey.get(key);
      if (listOffset === undefined || rect.bottom <= viewport.top || rect.top >= viewport.bottom)
        continue;
      candidates.push({ key, top: rect.top - viewport.top, listOffset });
    }
    candidates.sort((left, right) => left.top - right.top);
    viewportAnchorRef.current = {
      rows: candidates,
      scrollTop: el.scrollTop,
      scope: layoutRef.current.resetKey,
    };
  }, []);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (e.currentTarget.clientHeight === 0) return;
      captureViewportAnchor();
      setScrollTop(e.currentTarget.scrollTop);
    },
    [captureViewportAnchor],
  );

  const releaseAutoPosition = useCallback(() => {
    cancelBottomCorrection();
    anchorRef.current = null;
    keepBottomRef.current = false;
    captureViewportAnchor();
  }, [cancelBottomCorrection, captureViewportAnchor]);

  // 可視ウィンドウを二分探索で算出
  const visible = useMemo(() => {
    if (rows.length === 0) return { startIdx: 0, endIdx: 0 };
    const viewportH = viewportHeight || containerRef.current?.clientHeight || 600;
    const buffer = overscan * 60;
    // 行が入れ替わった直後は scrollTop が前のチャットの値のまま残ることがある。
    // クランプしないとウィンドウが末尾を越え、一件も描画されない。
    const anchor = viewportAnchorRef.current;
    // Date headings can disappear when a page is prepended. Use the first surviving row.
    const anchorRow =
      anchor?.scope === resetKey
        ? anchor?.rows.find((row) => offsets.byKey.has(row.key))
        : undefined;
    const anchorOffset = anchorRow ? offsets.byKey.get(anchorRow.key) : undefined;
    // Materialize the same window before committing a prepend or new measurements.
    const shiftedTop =
      scrollTop +
      (anchorOffset !== undefined && anchorRow ? anchorOffset - anchorRow.listOffset : 0);
    const clampedTop = Math.min(Math.max(0, shiftedTop), Math.max(0, offsets.total - viewportH));
    const start = clampedTop - buffer;
    const end = clampedTop + viewportH + buffer;

    let lo = 0;
    let hi = offsets.offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets.offsets[mid]! < start) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = Math.max(0, Math.min(lo - 1, offsets.offsets.length - 1));

    let endIdx = startIdx;
    while (endIdx < offsets.offsets.length && offsets.offsets[endIdx]! < end) endIdx++;
    endIdx = Math.min(Math.max(endIdx + 1, startIdx + 1), offsets.offsets.length);

    return { startIdx, endIdx };
  }, [scrollTop, offsets, overscan, rows.length, viewportHeight, resetKey]);

  const measure = useCallback((key: string, el: HTMLElement | null) => {
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    // Settings retain the chat runtime in a hidden container. A hidden row's
    // zero height is not a new measurement and must not collapse the window.
    if (height === 0) return;
    const style = getComputedStyle(el);
    const h =
      height +
      (Number.parseFloat(style.marginTop) || 0) +
      (Number.parseFloat(style.marginBottom) || 0);
    const prev = heights.current.get(key);
    if (prev !== h) {
      heights.current.set(key, h);
      // 同一フレーム内の計測変更を 1 再描画に統合（画像遅延ロード時の再描画連鎖を抑制）
      if (measurementFrameRef.current != null) return;
      measurementFrameRef.current = requestAnimationFrame(() => {
        measurementFrameRef.current = null;
        setMeasuredVersion((version) => version + 1);
      });
    }
  }, []);

  // 行キーごとに安定した ref を返す（毎レンダーの ref 再アタッチ → 再計測の連鎖を防ぐ）
  const rowRef = useCallback(
    (key: string) => {
      let cb = refCache.current.get(key);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          observers.current.get(key)?.disconnect();
          observers.current.delete(key);
          elements.current.delete(key);
          if (!el) return;
          elements.current.set(key, el);
          measure(key, el);
          if (typeof ResizeObserver === "undefined") return;
          const observer = new ResizeObserver(() => measure(key, el));
          observer.observe(el);
          observers.current.set(key, observer);
        };
        refCache.current.set(key, cb);
      }
      return cb;
    },
    [measure],
  );

  useEffect(() => {
    const keys = new Set(rows.map((row) => row.key));
    for (const key of heights.current.keys()) {
      if (!keys.has(key)) heights.current.delete(key);
    }
    for (const key of refCache.current.keys()) {
      if (keys.has(key)) continue;
      observers.current.get(key)?.disconnect();
      observers.current.delete(key);
      refCache.current.delete(key);
    }
  }, [rows]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      if (el.clientHeight > 0) setViewportHeight(el.clientHeight);
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [resetKey]);

  // 行が丸ごと入れ替わるときは前のスクロール位置を持ち越さない。
  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    cancelBottomCorrection();
    anchorRef.current = null;
    viewportAnchorRef.current = null;
    keepBottomRef.current = false;
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [resetKey, cancelBottomCorrection]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", releaseAutoPosition, { passive: true });
    el.addEventListener("touchstart", releaseAutoPosition, { passive: true });
    el.addEventListener("pointerdown", releaseAutoPosition, { passive: true });
    const releaseForScrollKey = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "PageUp" ||
        event.key === "PageDown" ||
        event.key === "Home" ||
        event.key === "End" ||
        event.key === " "
      ) {
        releaseAutoPosition();
      }
    };
    el.addEventListener("keydown", releaseForScrollKey);
    return () => {
      el.removeEventListener("wheel", releaseAutoPosition);
      el.removeEventListener("touchstart", releaseAutoPosition);
      el.removeEventListener("pointerdown", releaseAutoPosition);
      el.removeEventListener("keydown", releaseForScrollKey);
    };
  }, [resetKey, releaseAutoPosition]);

  useEffect(() => {
    return () => {
      cancelBottomCorrection();
      if (measurementFrameRef.current != null) cancelAnimationFrame(measurementFrameRef.current);
      for (const observer of observers.current.values()) observer.disconnect();
    };
  }, [cancelBottomCorrection]);

  // Correct before paint; browser anchoring is disabled on the virtual viewport.
  // Input since the last capture is included, so an in-flight gesture is not undone.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const anchor = viewportAnchorRef.current;
    if (el && el.clientHeight > 0) {
      if (keepBottomRef.current || anchorRef.current) preserveInitialPosition();
      else if (anchor && anchor.scope === resetKey) {
        const candidate = anchor.rows.find((row) => elements.current.has(row.key));
        const row = candidate && elements.current.get(candidate.key);
        if (candidate && row) {
          const desiredTop = candidate.top - (el.scrollTop - anchor.scrollTop);
          const delta =
            row.getBoundingClientRect().top - el.getBoundingClientRect().top - desiredTop;
          if (Math.abs(delta) > 0.5) el.scrollTop += delta;
        }
      }
      setScrollTop(el.scrollTop);
    }
    layoutRef.current = { offsets, resetKey };
    captureViewportAnchor();
    // Margin changes (e.g. day/author grouping) do not trigger ResizeObserver.
    for (const [key, row] of elements.current) measure(key, row);
    // Commit new row measurements with the corrected scroll position. Re-rendering
    // against stale estimates can oscillate between two windows before the RAF runs.
    if (measurementFrameRef.current != null) {
      cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = null;
      setMeasuredVersion((version) => version + 1);
    }
  }, [
    offsets,
    rows,
    resetKey,
    viewportHeight,
    visible.startIdx,
    visible.endIdx,
    preserveInitialPosition,
    captureViewportAnchor,
    measure,
  ]);

  // 行キー → スクロール位置（center: 可視中央に寄せる）
  const scrollToKey = useCallback(
    (key: string, opts: { behavior?: ScrollBehavior; center?: boolean } = {}) => {
      let top = layoutRef.current.offsets.byKey.get(key);
      if (top === undefined) return;
      const el = containerRef.current;
      if (!el) return;
      if (opts.center) top = Math.max(0, top - el.clientHeight / 2);
      el.scrollTo({ top, behavior: opts.behavior ?? "smooth" });
    },
    [],
  );

  const scrollToMessagePosition = useCallback(
    (
      messageId: string,
      opts: { behavior?: ScrollBehavior; center?: boolean } = {},
      rowKey = `msg-${messageId}`,
    ) => {
      cancelBottomCorrection();
      const anchor = { key: rowKey, center: opts.center === true };
      anchorRef.current = anchor;
      viewportAnchorRef.current = null;
      keepBottomRef.current = false;
      scrollToKey(rowKey, opts);
      requestAnimationFrame(() => {
        if (anchorRef.current === anchor) preserveInitialPosition();
      });
    },
    [cancelBottomCorrection, preserveInitialPosition, scrollToKey],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = containerRef.current;
      if (!el) return;
      cancelBottomCorrection();
      anchorRef.current = null;
      viewportAnchorRef.current = null;
      keepBottomRef.current = true;

      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: maxScrollTop, behavior });

      // 仮想行が入れ替わり、画像サイズが確定するまで数フレームにわたり最下端を再計算する。
      // その後の遅延リサイズも preserveInitialPosition が keepBottomRef を見て追従する。
      const settle = (remaining: number, previousMax: number, stableFrames: number) => {
        bottomCorrectionFrameRef.current = null;
        if (!keepBottomRef.current || !containerRef.current) return;
        const current = containerRef.current;
        const nextMax = Math.max(0, current.scrollHeight - current.clientHeight);
        if (Math.abs(current.scrollTop - nextMax) > 0.5) {
          current.scrollTo({ top: nextMax, behavior: "auto" });
        }
        const nextStable =
          Math.abs(previousMax - nextMax) <= 0.5 && Math.abs(current.scrollTop - nextMax) <= 0.5
            ? stableFrames + 1
            : 0;
        if (remaining <= 0 || nextStable >= 4) return;
        bottomCorrectionFrameRef.current = requestAnimationFrame(() =>
          settle(remaining - 1, nextMax, nextStable),
        );
      };

      const beginSettle = () => {
        bottomCorrectionTimerRef.current = null;
        bottomCorrectionFrameRef.current = requestAnimationFrame(() => settle(36, maxScrollTop, 0));
      };
      if (behavior === "smooth") {
        bottomCorrectionTimerRef.current = setTimeout(beginSettle, 320);
      } else {
        beginSettle();
      }
    },
    [cancelBottomCorrection],
  );

  const visibleRows = useMemo(() => rows.slice(visible.startIdx, visible.endIdx), [rows, visible]);
  const topSpacer = offsets.offsets[visible.startIdx] ?? 0;
  const bottomSpacer = Math.max(
    0,
    offsets.total - (offsets.offsets[visible.endIdx] ?? offsets.total),
  );

  return {
    containerRef,
    onScroll,
    visibleRows,
    hasMeasured: measuredVersion > 0,
    topSpacer,
    bottomSpacer,
    measure,
    rowRef,
    scrollToKey,
    scrollToMessagePosition,
    scrollToBottom,
    releaseAutoPosition,
  };
}
