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
}: {
  rows: VirtualRow<T>[];
  estimateHeight: (item: T) => number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const tickScheduled = useRef(false);
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const observers = useRef(new Map<string, ResizeObserver>());
  const anchorRef = useRef<{ key: string; center: boolean } | null>(null);
  const keepBottomRef = useRef(false);
  const autoScrollInFlightRef = useRef(false);

  const preserveInitialPosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (keepBottomRef.current && !autoScrollInFlightRef.current) {
      el.scrollTo({ top: Math.max(0, el.scrollHeight - el.clientHeight), behavior: "auto" });
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) return;
    const row = document.getElementById(anchor.key);
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
    let acc = 0;
    for (const r of rows) {
      arr.push(acc);
      acc += heights.current.get(r.key) ?? estimateHeight(r.item);
    }
    return { offsets: arr, total: acc };
  }, [rows, estimateHeight, measuredVersion]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // 自動で最下部を維持している最中でも、利用者が上へ動かしたら即座に解除する。
    // wheel/pointer イベントだけではスクロールバー操作を取りこぼすため、位置差分でも判定する。
    if (keepBottomRef.current && !autoScrollInFlightRef.current) {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop < maxScrollTop - 2) {
        anchorRef.current = null;
        keepBottomRef.current = false;
      }
    }
    setScrollTop(el.scrollTop);
  }, []);

  const releaseAutoPosition = useCallback(() => {
    anchorRef.current = null;
    keepBottomRef.current = false;
  }, []);

  // 可視ウィンドウを二分探索で算出
  const visible = useMemo(() => {
    const el = containerRef.current;
    const viewportH = el?.clientHeight ?? 600;
    const buffer = overscan * 60;
    const start = scrollTop - buffer;
    const end = scrollTop + viewportH + buffer;

    let lo = 0;
    let hi = offsets.offsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets.offsets[mid]! < start) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = lo;

    let endIdx = startIdx;
    while (endIdx < offsets.offsets.length && offsets.offsets[endIdx]! < end) endIdx++;
    endIdx = Math.min(endIdx + 1, offsets.offsets.length);

    return { startIdx, endIdx };
  }, [scrollTop, offsets, overscan]);

  const measure = useCallback(
    (key: string, el: HTMLElement | null) => {
      if (!el) return;
      const h = el.offsetHeight;
      const prev = heights.current.get(key);
      if (prev !== h) {
        heights.current.set(key, h);
        // 同一フレーム内の計測変更を 1 再描画に統合（画像遅延ロード時の再描画連鎖を抑制）
        if (tickScheduled.current) return;
        tickScheduled.current = true;
        requestAnimationFrame(() => {
          tickScheduled.current = false;
          setMeasuredVersion((version) => version + 1);
          requestAnimationFrame(preserveInitialPosition);
        });
      }
    },
    [preserveInitialPosition],
  );

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
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", releaseAutoPosition, { passive: true });
    el.addEventListener("touchstart", releaseAutoPosition, { passive: true });
    el.addEventListener("pointerdown", releaseAutoPosition, { passive: true });
    return () => {
      el.removeEventListener("wheel", releaseAutoPosition);
      el.removeEventListener("touchstart", releaseAutoPosition);
      el.removeEventListener("pointerdown", releaseAutoPosition);
    };
  }, [releaseAutoPosition]);

  useEffect(() => {
    return () => {
      for (const observer of observers.current.values()) observer.disconnect();
    };
  }, []);

  // 同期で行が追加されても、既存行の高さが変わらなければ measure は呼ばれない。
  // その場合も下部スペーサー更新後に最下部へ追従する。
  useLayoutEffect(() => {
    if (!keepBottomRef.current && !anchorRef.current) return;
    const frame = requestAnimationFrame(preserveInitialPosition);
    return () => cancelAnimationFrame(frame);
  }, [offsets, preserveInitialPosition, rows]);

  // 行キー → スクロール位置（center: 可視中央に寄せる）
  const scrollToKey = useCallback(
    (key: string, opts: { behavior?: ScrollBehavior; center?: boolean } = {}) => {
      const idx = rows.findIndex((r) => r.key === key);
      if (idx < 0) return;
      let top = offsets.offsets[idx] ?? 0;
      const el = containerRef.current;
      if (!el) return;
      if (opts.center) top = Math.max(0, top - el.clientHeight / 2);
      el.scrollTo({ top, behavior: opts.behavior ?? "smooth" });
    },
    [rows, offsets],
  );

  const scrollToMessagePosition = useCallback(
    (
      messageId: string,
      opts: { behavior?: ScrollBehavior; center?: boolean } = {},
      rowKey = `msg-${messageId}`,
    ) => {
      anchorRef.current = { key: rowKey, center: opts.center === true };
      keepBottomRef.current = false;
      scrollToKey(rowKey, opts);

      const correctToRenderedRow = () => {
        const el = containerRef.current;
        const row = document.getElementById(rowKey);
        if (!el || !row) return;
        const rowTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
        const desiredTop = opts.center ? el.clientHeight / 2 : 0;
        el.scrollTo({
          top: Math.max(0, el.scrollTop + rowTop - desiredTop),
          behavior: opts.behavior ?? "smooth",
        });
        preserveInitialPosition();
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(correctToRenderedRow);
        });
      });
    },
    [preserveInitialPosition, scrollToKey],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    anchorRef.current = null;
    keepBottomRef.current = true;
    const scroll = () => {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      autoScrollInFlightRef.current = true;
      el.scrollTo({ top: maxScrollTop, behavior });
      requestAnimationFrame(() => {
        autoScrollInFlightRef.current = false;
      });
    };
    scroll();
    requestAnimationFrame(() => requestAnimationFrame(scroll));
  }, []);

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
