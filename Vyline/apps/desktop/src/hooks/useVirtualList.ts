import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { adjustScrollTopForAnchor, isAtScrollEnd } from "./virtualScrollAnchor.js";

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

export function calculateVisibleRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { startIdx: number; endIdx: number } {
  const buffer = overscan * 60;
  const start = scrollTop - buffer;
  const end = scrollTop + viewportHeight + buffer;
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= start) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = Math.max(0, lo - 1);
  let endIdx = startIdx;
  while (endIdx < offsets.length && offsets[endIdx]! < end) endIdx++;
  endIdx = Math.min(endIdx + 1, offsets.length);
  return { startIdx, endIdx };
}

export function useVirtualList<T>({
  rows,
  estimateHeight,
  overscan = 10,
}: {
  rows: VirtualRow<T>[];
  estimateHeight: (item: T) => number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const heights = useRef(new Map<string, number>());
  const previousAnchor = useRef<{ key: string; offset: number; atBottom: boolean } | null>(null);
  const previousLayout = useRef<{ rows: VirtualRow<T>[]; offsets: number[] } | null>(null);
  const [, setMeasuredTick] = useState(0);
  const measuredTick = useRef(0);
  const tickScheduled = useRef(false);
  const measurementFrame = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const pendingScrollTop = useRef(0);
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observers = useRef(new Map<string, ResizeObserver>());
  const offsets = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const r of rows) {
      arr.push(acc);
      acc += heights.current.get(r.key) ?? estimateHeight(r.item);
    }
    return { offsets: arr, total: acc };
  }, [rows, estimateHeight, measuredTick.current]);
  const rowIndices = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows]);

  // Preserve the first visible row when rows are prepended or earlier rows resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const previous = previousAnchor.current;
    const priorLayout = previousLayout.current;
    const layoutChanged =
      priorLayout !== null &&
      (priorLayout.rows !== rows || priorLayout.offsets !== offsets.offsets);
    if (layoutChanged && previous?.atBottom) {
      const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
      if (Math.abs(el.scrollTop - bottom) > 1) el.scrollTop = bottom;
    } else if (layoutChanged && previous) {
      const nextIndex = rowIndices.get(previous.key);
      if (nextIndex != null) {
        el.scrollTop = adjustScrollTopForAnchor(
          el.scrollTop,
          previous.offset,
          offsets.offsets[nextIndex] ?? 0,
        );
      }
    }

    const top = el.scrollTop;
    let lo = 0;
    let hi = offsets.offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rowBottom = offsets.offsets[mid + 1] ?? offsets.total;
      if (rowBottom <= top) lo = mid + 1;
      else hi = mid;
    }
    const key = rows[lo]?.key;
    previousAnchor.current = key
      ? {
          key,
          offset: offsets.offsets[lo] ?? 0,
          atBottom: isAtScrollEnd(el.scrollHeight, el.clientHeight, el.scrollTop),
        }
      : null;
    previousLayout.current = { rows, offsets: offsets.offsets };
  }, [rows, rowIndices, offsets, scrollTop]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateViewportHeight = () => {
      const nextHeight = el.clientHeight;
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    updateViewportHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    pendingScrollTop.current = e.currentTarget.scrollTop;
    if (scrollFrame.current != null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      setScrollTop(pendingScrollTop.current);
    });
  }, []);

  // 可視ウィンドウを二分探索で算出
  const visible = useMemo(() => {
    const el = containerRef.current;
    const viewportH = viewportHeight || el?.clientHeight || 600;
    return calculateVisibleRange(offsets.offsets, scrollTop, viewportH, overscan);
  }, [scrollTop, viewportHeight, offsets, overscan]);

  const measure = useCallback((key: string, el: HTMLElement | null) => {
    if (!el) return;
    const h = el.offsetHeight;
    const prev = heights.current.get(key);
    if (prev !== h) {
      heights.current.set(key, h);
      // 同一フレーム内の計測変更を 1 再描画に統合（画像遅延ロード時の再描画連鎖を抑制）
      if (tickScheduled.current) return;
      tickScheduled.current = true;
      measurementFrame.current = requestAnimationFrame(() => {
        measurementFrame.current = null;
        tickScheduled.current = false;
        measuredTick.current++;
        setMeasuredTick((t) => t + 1);
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
          if (!el) return;
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
    return () => {
      if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current);
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      for (const observer of observers.current.values()) observer.disconnect();
    };
  }, []);

  // 行キー → スクロール位置（center: 可視中央に寄せる）
  const scrollToKey = useCallback(
    (key: string, opts: { behavior?: ScrollBehavior; center?: boolean } = {}) => {
      const idx = rows.findIndex((r) => r.key === key);
      if (idx < 0) return;
      let top = offsets.offsets[idx] ?? 0;
      const el = containerRef.current;
      if (!el) return;
      if (opts.center) {
        const rowBottom = offsets.offsets[idx + 1] ?? offsets.total;
        top = Math.max(0, top + (rowBottom - top - el.clientHeight) / 2);
      }
      el.scrollTo({ top, behavior: opts.behavior ?? "smooth" });
    },
    [rows, offsets],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    if (Math.abs(el.scrollTop - bottom) <= 1) return;
    el.scrollTo({ top: bottom, behavior });
  }, []);

  const visibleRows = useMemo(() => rows.slice(visible.startIdx, visible.endIdx), [rows, visible]);
  const topSpacer = offsets.offsets[visible.startIdx] ?? 0;
  const bottomSpacer = offsets.total - (offsets.offsets[visible.endIdx] ?? offsets.total);

  return {
    containerRef,
    onScroll,
    visibleRows,
    topSpacer,
    bottomSpacer,
    measure,
    rowRef,
    scrollToKey,
    scrollToBottom,
  };
}
