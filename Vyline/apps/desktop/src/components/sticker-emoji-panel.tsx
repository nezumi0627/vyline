import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { api } from "@/api/client";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";
import { cn } from "@/lib/utils";
import { copyText } from "@/utils/clipboard";
import { PremiumBadge } from "@/components/premium-badge";
import {
  lineStoreUrl,
  loadStickerFavorites,
  toggleStickerFavorite,
  type StickerFavorite,
} from "@/utils/stickerFavorites";
import {
  getCachedStickersCatalog,
  isStickersCatalogFresh,
  setCachedStickersCatalog,
  type StickersCatalogCache,
} from "@/lib/stickerCatalogCache";
import {
  COMBO_EDITOR_SIZE,
  COMBO_ITEM_MAX_SIZE,
  COMBO_ITEM_MIN_SIZE,
  type CombinationStickerPlacement,
} from "@/utils/combinationStickers";

export type CatalogItem = { id: string; url: string; alt?: string };
export type CatalogPack = {
  packageId: string;
  name: string;
  type: "sticker" | "emoji";
  tabUrl: string;
  items: CatalogItem[];
};

type Catalog = StickersCatalogCache;
type Tab = "sticker" | "emoji" | "favorite";
type DragPayload = {
  type: "sticker" | "emoji";
  packageId: string;
  stickerId: string;
  url: string;
  name?: string;
};
type ComboItem = CombinationStickerPlacement & { uid: string };
type MenuState = {
  x: number;
  y: number;
  fav: StickerFavorite;
  comboPayload?: DragPayload;
} | null;

const COMBO_LIMIT = 6;
// 正規座標空間 240x240 (backend の scale=512/240 前提と同期。表示枠も同サイズで固定)
const COMBO_SIZE = COMBO_EDITOR_SIZE;
const COMBO_ITEM_SIZE = 80;
const LONG_PRESS_MS = 480;
const MENU_MARGIN = 8;
const MENU_ESTIMATED_WIDTH = 192;
const MENU_ESTIMATED_HEIGHT = 208;
const DEMO_STICKER_CATALOG: Catalog = {
  premium: { active: false },
  stickerPacks: [
    {
      packageId: "demo-pack",
      name: "Vyline Demo",
      type: "sticker",
      tabUrl: "/demo/sticker-tab.svg",
      items: [
        { id: "sun", url: "/demo/sticker-sun.svg", alt: "サンプル太陽" },
        { id: "heart", url: "/demo/sticker-heart.svg", alt: "サンプルハート" },
        { id: "ok", url: "/demo/sticker-ok.svg", alt: "サンプルOK" },
      ],
    },
  ],
  emojiPacks: [
    {
      packageId: "demo-emoji",
      name: "Unicode Emoji",
      type: "emoji",
      tabUrl: "/demo/emoji-tab.svg",
      items: [
        { id: "sparkle", url: "/demo/emoji-sparkle.svg", alt: "✨" },
        { id: "smile", url: "/demo/emoji-smile.svg", alt: "😊" },
      ],
    },
  ],
};

function assetUrl(url: string): string {
  return url.startsWith("http") ? `/api/cdn/line?u=${encodeURIComponent(url)}` : url;
}

function prefetchImgs(urls: string[]): void {
  for (const u of urls) {
    const img = new Image();
    img.decoding = "async";
    img.src = assetUrl(u);
  }
}

function readDragPayload(ev: DragEvent): DragPayload | null {
  const raw = ev.dataTransfer.getData("application/x-vyline-sticker");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed.packageId || !parsed.stickerId || !parsed.url) return null;
    return parsed;
  } catch {
    return null;
  }
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function StickerEmojiPanel({
  accountId,
  onPickSticker,
  onPickEmoji,
  onSendCombinationSticker,
}: {
  accountId: string | null;
  onPickSticker: (packageId: string, stickerId: string, isPremium?: boolean) => void;
  onPickEmoji: (packageId: string, sticonId: string) => void;
  onSendCombinationSticker: (
    items: Array<{ packageId: string; stickerId: string; x?: number; y?: number; size?: number }>,
  ) => Promise<void> | void;
}) {
  const demoMode = typeof window !== "undefined" && window.location.pathname === "/pr-demo";
  const desktopInteraction = isDesktopInteraction();
  const [tab, setTab] = useState<Tab>("sticker");
  const [favorites, setFavorites] = useState<StickerFavorite[]>(() =>
    accountId && !demoMode ? loadStickerFavorites(accountId) : [],
  );
  const [menu, setMenu] = useState<MenuState>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(() =>
    demoMode ? DEMO_STICKER_CATALOG : accountId ? getCachedStickersCatalog(accountId) : null,
  );
  const [loading, setLoading] = useState(() =>
    demoMode ? false : accountId ? !getCachedStickersCatalog(accountId) : false,
  );
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean> | null>(null);
  const [packId, setPackId] = useState<string | null>(() => {
    if (demoMode) return DEMO_STICKER_CATALOG.stickerPacks[0]?.packageId ?? null;
    const cached = accountId ? getCachedStickersCatalog(accountId) : null;
    return cached?.stickerPacks[0]?.packageId ?? cached?.emojiPacks[0]?.packageId ?? null;
  });
  const [comboMode, setComboMode] = useState(false);
  const [comboItems, setComboItems] = useState<ComboItem[]>([]);
  const [comboBusy, setComboBusy] = useState(false);
  const [comboError, setComboError] = useState<string | null>(null);
  const [draggingComboId, setDraggingComboId] = useState<string | null>(null);
  const [resizingComboId, setResizingComboId] = useState<string | null>(null);
  const comboCanvasRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = useRef(0);

  useEffect(
    () => () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (demoMode || !accountId) return;
    let cancelled = false;
    const cached = getCachedStickersCatalog(accountId);
    if (cached) {
      setCatalog(cached);
      setLoading(false);
      setError(null);
      if (!packId) {
        setPackId(cached.stickerPacks[0]?.packageId ?? cached.emojiPacks[0]?.packageId ?? null);
      }
      if (isStickersCatalogFresh(accountId)) return;
    } else {
      setLoading(true);
    }
    setError(null);

    void api.line
      .getOwnedStickers(accountId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (!cached) setError(res.error || "取得に失敗しました");
          return;
        }
        const next: Catalog = {
          premium: res.premium ?? { active: false },
          stickerPacks: res.stickerPacks ?? [],
          emojiPacks: res.emojiPacks ?? [],
        };
        setCachedStickersCatalog(accountId, next);
        setCatalog(next);
        setPackId((prev) => {
          if (
            prev &&
            (next.stickerPacks.some((p) => p.packageId === prev) ||
              next.emojiPacks.some((p) => p.packageId === prev))
          ) {
            return prev;
          }
          return next.stickerPacks[0]?.packageId ?? next.emojiPacks[0]?.packageId ?? null;
        });
      })
      .catch((err) => {
        if (!cancelled && !cached) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, demoMode]);

  useEffect(() => {
    if (!catalog || (!accountId && !demoMode)) return;
    const tabIcons = [
      ...catalog.stickerPacks.map((p) => p.tabUrl),
      ...catalog.emojiPacks.map((p) => p.tabUrl),
    ];
    const active =
      catalog.stickerPacks.find((p) => p.packageId === packId) ??
      catalog.emojiPacks.find((p) => p.packageId === packId);
    const items = active ? active.items.map((i) => i.url) : [];
    prefetchImgs([...tabIcons, ...items]);
  }, [catalog, packId, accountId, demoMode]);

  useEffect(() => {
    if (demoMode) {
      setAvailability(
        Object.fromEntries((catalog?.stickerPacks ?? []).map((p) => [p.packageId, true])),
      );
      return;
    }
    if (!accountId || !catalog) return;
    let cancelled = false;
    const packageIds = catalog.stickerPacks.map((p) => p.packageId);
    if (packageIds.length === 0) {
      setAvailability({});
      return;
    }
    setAvailability(null);
    void Promise.all(
      packageIds.map(async (packageId) => {
        try {
          const res = await api.line.isStickerAvailableForCombinationSticker(accountId, packageId);
          return [packageId, Boolean(res.ok && res.availableForCombinationSticker)] as const;
        } catch {
          return [packageId, false] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAvailability(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, catalog, demoMode]);

  const packs = useMemo(() => {
    if (!catalog) return [];
    if (tab === "sticker") return catalog.stickerPacks;
    if (tab === "emoji") return catalog.emojiPacks;
    return [];
  }, [catalog, tab]);

  const activePack = packs.find((p) => p.packageId === packId) ?? packs[0];

  useEffect(() => {
    if (!packs.some((p) => p.packageId === packId)) {
      setPackId(packs[0]?.packageId ?? null);
    }
  }, [packs, packId]);

  function canCombineSticker(type: "sticker" | "emoji", packageId: string): boolean {
    if (type !== "sticker") return false;
    if (availability == null) return false;
    return Boolean(availability[packageId]);
  }

  function normalizePoint(x: number, y: number, size: number): { x: number; y: number } {
    return {
      x: Math.max(0, Math.min(COMBO_SIZE - size, x)),
      y: Math.max(0, Math.min(COMBO_SIZE - size, y)),
    };
  }

  function addComboItem(payload: DragPayload, at?: { x: number; y: number }): void {
    if (!canCombineSticker(payload.type, payload.packageId)) {
      setComboError("このスタンプは組み合わせに対応していません");
      return;
    }
    setComboMode(true);
    setComboError(null);
    setComboItems((prev) => {
      if (prev.length >= COMBO_LIMIT) {
        setComboError(`組み合わせは最大${COMBO_LIMIT}枚までです`);
        return prev;
      }
      const size = COMBO_ITEM_SIZE;
      const base = at ?? { x: COMBO_SIZE / 2 - size / 2, y: COMBO_SIZE / 2 - size / 2 };
      const pos = normalizePoint(base.x - size / 2, base.y - size / 2, size);
      return [
        ...prev,
        {
          ...payload,
          uid: uid(),
          x: pos.x,
          y: pos.y,
          size,
        },
      ];
    });
  }

  function clearCombo(): void {
    setComboItems([]);
    setComboMode(false);
    setComboError(null);
  }

  async function sendCombo(): Promise<void> {
    if (comboBusy) return;
    if (comboItems.length === 0) {
      setComboError("スタンプを1つ以上置いてください");
      return;
    }
    setComboBusy(true);
    setComboError(null);
    try {
      await onSendCombinationSticker(
        comboItems.map(({ packageId, stickerId, x, y, size }) => ({
          packageId,
          stickerId,
          x,
          y,
          size,
        })),
      );
      clearCombo();
    } catch (err) {
      setComboError(err instanceof Error ? err.message : String(err));
    } finally {
      setComboBusy(false);
    }
  }

  function handleComboDrop(ev: DragEvent<HTMLDivElement>): void {
    if (!desktopInteraction) return;
    ev.preventDefault();
    ev.stopPropagation();
    const payload = readDragPayload(ev);
    if (!payload) return;
    const rect = comboCanvasRef.current?.getBoundingClientRect();
    addComboItem(
      payload,
      rect ? { x: ev.clientX - rect.left, y: ev.clientY - rect.top } : undefined,
    );
  }

  function handleComboDragOver(ev: DragEvent<HTMLDivElement>): void {
    if (!desktopInteraction) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
  }

  function handleComboPointerDown(
    uidValue: string,
    ev: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const rect = comboCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const item = comboItems.find((x) => x.uid === uidValue);
    if (!item) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setDraggingComboId(uidValue);
    dragOffsetRef.current = {
      x: ev.clientX - rect.left - item.x,
      y: ev.clientY - rect.top - item.y,
    };
  }

  function handleComboPointerMove(ev: ReactPointerEvent<HTMLDivElement>): void {
    const rect = comboCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (resizingComboId) {
      const item = comboItems.find((x) => x.uid === resizingComboId);
      if (!item) return;
      const dist = Math.hypot(ev.clientX - rect.left - item.x, ev.clientY - rect.top - item.y);
      const size = Math.round(Math.max(COMBO_ITEM_MIN_SIZE, Math.min(COMBO_ITEM_MAX_SIZE, dist)));
      setComboItems((prev) =>
        prev.map((x) => {
          if (x.uid !== resizingComboId) return x;
          const pos = normalizePoint(x.x, x.y, size);
          return { ...x, size, ...pos };
        }),
      );
      return;
    }
    if (!draggingComboId) return;
    const item = comboItems.find((x) => x.uid === draggingComboId);
    if (!item) return;
    const next = normalizePoint(
      ev.clientX - rect.left - dragOffsetRef.current.x,
      ev.clientY - rect.top - dragOffsetRef.current.y,
      item.size,
    );
    setComboItems((prev) => prev.map((x) => (x.uid === draggingComboId ? { ...x, ...next } : x)));
  }

  function handleComboPointerUp(): void {
    setDraggingComboId(null);
    setResizingComboId(null);
  }

  function handleComboResizeDown(uidValue: string, ev: ReactPointerEvent<HTMLButtonElement>): void {
    const item = comboItems.find((x) => x.uid === uidValue);
    if (!item) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setResizingComboId(uidValue);
  }

  function favoriteFromPayload(payload: DragPayload): StickerFavorite {
    return {
      type: payload.type,
      packageId: payload.packageId,
      id: payload.stickerId,
      url: payload.url,
      name: payload.name,
    };
  }

  function openItemMenu(payload: DragPayload, x: number, y: number): void {
    const left =
      typeof window === "undefined"
        ? x
        : Math.max(
            MENU_MARGIN,
            Math.min(x, window.innerWidth - MENU_ESTIMATED_WIDTH - MENU_MARGIN),
          );
    const top =
      typeof window === "undefined"
        ? y
        : Math.max(
            MENU_MARGIN,
            Math.min(y, window.innerHeight - MENU_ESTIMATED_HEIGHT - MENU_MARGIN),
          );
    setMenu({
      x: left,
      y: top,
      fav: favoriteFromPayload(payload),
      comboPayload: canCombineSticker(payload.type, payload.packageId) ? payload : undefined,
    });
  }

  function closeItemMenu(): void {
    stopLongPress();
    suppressClickUntilRef.current = 0;
    setMenu(null);
  }

  function toggleFavoriteFromMenu(favorite: StickerFavorite): boolean {
    if (accountId) {
      const result = toggleStickerFavorite(accountId, favorite);
      setFavorites(result.favorites);
      return result.added;
    }

    const exists = favorites.some((item) => item.type === favorite.type && item.id === favorite.id);
    setFavorites((current) =>
      exists
        ? current.filter((item) => !(item.type === favorite.type && item.id === favorite.id))
        : [...current, favorite],
    );
    return !exists;
  }

  function startLongPress(payload: DragPayload, ev: ReactPointerEvent<HTMLButtonElement>): void {
    if (desktopInteraction) return;
    stopLongPress();
    const x = ev.clientX;
    const y = ev.clientY;
    longPressOriginRef.current = { x, y };
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOriginRef.current = null;
      suppressClickUntilRef.current = Date.now() + 750;
      window.getSelection()?.removeAllRanges();
      if (navigator.vibrate) navigator.vibrate(12);
      openItemMenu(payload, x, y);
    }, LONG_PRESS_MS);
  }

  function stopLongPress(): void {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressOriginRef.current = null;
  }

  function moveLongPress(ev: ReactPointerEvent<HTMLButtonElement>): void {
    const origin = longPressOriginRef.current;
    if (!origin) return;
    if (Math.abs(ev.clientX - origin.x) > 8 || Math.abs(ev.clientY - origin.y) > 8) {
      stopLongPress();
    }
  }

  function handleStickerClick(payload: DragPayload, action: () => void): void {
    if (Date.now() < suppressClickUntilRef.current) {
      suppressClickUntilRef.current = 0;
      return;
    }
    if (comboMode && payload.type === "sticker") {
      addComboItem(payload);
      return;
    }
    action();
  }

  function renderGridItem(item: CatalogItem, pack: CatalogPack) {
    const payload: DragPayload = {
      type: pack.type,
      packageId: pack.packageId,
      stickerId: item.id,
      url: item.url,
      name: item.alt || pack.name,
    };
    const canCombine = canCombineSticker(pack.type, pack.packageId);
    const draggable = desktopInteraction && canCombine;
    return (
      <button
        key={item.id}
        type="button"
        title={item.alt || item.id}
        draggable={draggable}
        onPointerDown={(ev) => startLongPress(payload, ev)}
        onPointerMove={moveLongPress}
        onPointerUp={stopLongPress}
        onPointerCancel={stopLongPress}
        onPointerLeave={stopLongPress}
        onDragStart={(ev) => {
          if (!desktopInteraction || !canCombine) {
            ev.preventDefault();
            return;
          }
          ev.dataTransfer.effectAllowed = "copy";
          ev.dataTransfer.setData("application/x-vyline-sticker", JSON.stringify(payload));
        }}
        onClick={() =>
          handleStickerClick(payload, () => {
            if (pack.type === "sticker") {
              onPickSticker(pack.packageId, item.id, catalog?.premium?.active);
            } else {
              onPickEmoji(pack.packageId, item.id);
            }
          })
        }
        onContextMenu={(e) => {
          e.preventDefault();
          if (!desktopInteraction) return;
          openItemMenu(payload, e.clientX, e.clientY);
        }}
        className={cn(
          "flex aspect-square w-full touch-manipulation items-center justify-center rounded-xl p-1 transition-colors hover:bg-[var(--vy-surface-2)] active:scale-95",
          desktopInteraction && canCombine && "cursor-grab active:cursor-grabbing",
          comboMode && pack.type === "sticker" && !canCombine && "opacity-55",
        )}
      >
        <img
          src={assetUrl(item.url)}
          alt={item.alt || ""}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
        />
      </button>
    );
  }

  return (
    <div className="vy-scale-in absolute bottom-full left-3 z-50 mb-2 flex h-[min(500px,72vh)] w-[min(460px,calc(100%_-_1.5rem))] flex-col overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl md:left-5 md:w-[min(460px,calc(100%_-_2.5rem))]">
      <div className="flex items-center gap-1 border-b border-[var(--vy-border)] px-1.5 pt-1.5">
        {(
          [
            ["sticker", "スタンプ"],
            ["emoji", "絵文字"],
            ["favorite", "★"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-t-lg px-2.5 py-1 text-[0.72rem] font-semibold transition-colors",
              tab === id
                ? "bg-[var(--vy-surface-2)] text-[var(--vy-text)]"
                : "text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 px-1.5 text-[0.6rem] text-[var(--vy-text-dim)]">
          {catalog?.premium.active && <PremiumBadge size={12} compact />}
          <span>
            {catalog?.premium.active
              ? catalog.premium.onFreeTrial
                ? "Premium お試し"
                : "Premium"
              : "Premium —"}
          </span>
        </span>
      </div>

      {tab !== "favorite" && (
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--vy-border)] px-1.5 py-1 [scrollbar-width:thin]">
          {packs.map((p) => (
            <button
              key={p.packageId}
              type="button"
              title={p.name}
              onClick={() => setPackId(p.packageId)}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                activePack?.packageId === p.packageId
                  ? "border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)]"
                  : "border-transparent hover:bg-[var(--vy-surface-2)]",
              )}
            >
              <img
                src={assetUrl(p.tabUrl)}
                alt=""
                className="h-6 w-6 object-contain"
                loading="lazy"
                draggable={false}
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {comboMode && activePack?.type === "sticker" && (
          <div className="mb-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-1.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[0.72rem] font-semibold text-[var(--vy-text)]">
                  {desktopInteraction ? "ドラッグで組み合わせ" : "タップで組み合わせ"}
                </p>
                <p className="mt-0.5 text-[0.62rem] text-[var(--vy-text-dim)]">
                  {desktopInteraction
                    ? "対応スタンプをここへドラッグし、自由に配置できます。"
                    : "対応スタンプをタップして追加し、指で自由に配置できます。"}
                </p>
              </div>
              <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-2 py-0.5 text-[0.6rem] text-[var(--vy-text-dim)]">
                {comboItems.length} 枚
              </span>
              <button
                type="button"
                onClick={clearCombo}
                className="rounded-full border border-[var(--vy-border)] px-2.5 py-1 text-[0.68rem] text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface)]"
              >
                クリア
              </button>
              <button
                type="button"
                onClick={() => void sendCombo()}
                disabled={comboBusy || comboItems.length === 0}
                className="rounded-full bg-[var(--vy-accent)] px-2.5 py-1 text-[0.68rem] font-semibold text-[var(--vy-accent-contrast)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {comboBusy ? "送信中…" : "送信"}
              </button>
            </div>

            <div
              ref={comboCanvasRef}
              className="relative mx-auto mt-2 overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--vy-surface-2)_82%,transparent),color-mix(in_oklab,var(--vy-surface)_94%,transparent))]"
              style={{ width: COMBO_SIZE, height: COMBO_SIZE }}
              onPointerMove={handleComboPointerMove}
              onPointerUp={handleComboPointerUp}
              onPointerLeave={handleComboPointerUp}
              onDragOver={desktopInteraction ? handleComboDragOver : undefined}
              onDrop={desktopInteraction ? handleComboDrop : undefined}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--vy-accent)_12%,transparent),transparent_38%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--vy-text)_8%,transparent),transparent_42%)]" />
              {comboItems.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                  <div className="rounded-full border border-dashed border-[var(--vy-border)] px-3 py-1.5 text-[0.68rem] text-[var(--vy-text-dim)]">
                    {desktopInteraction ? "スタンプをここへドラッグ" : "下のスタンプをタップ"}
                  </div>
                  <p className="max-w-[16rem] text-[0.62rem] text-[var(--vy-text-dim)]">
                    {desktopInteraction
                      ? "対応しているスタンプだけが入ります。置いたあとも掴んで動かせます。"
                      : "対応しているスタンプだけが入ります。置いたあとは指で動かせます。"}
                  </p>
                </div>
              ) : null}

              {comboItems.map((item) => {
                const dragging = draggingComboId === item.uid;
                return (
                  <div
                    key={item.uid}
                    className={cn(
                      "absolute rounded-2xl border border-transparent bg-transparent transition-transform",
                      dragging &&
                        "scale-105 border-[color-mix(in_oklab,var(--vy-accent)_65%,transparent)]",
                    )}
                    style={{ left: item.x, top: item.y, width: item.size, height: item.size }}
                  >
                    <button
                      type="button"
                      className="absolute inset-0 touch-none rounded-2xl"
                      onPointerDown={(ev) => handleComboPointerDown(item.uid, ev)}
                    >
                      <img
                        src={assetUrl(item.url)}
                        alt={item.name || item.stickerId}
                        className="pointer-events-none h-full w-full object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                        loading="lazy"
                        draggable={false}
                        referrerPolicy="no-referrer"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="サイズを変更"
                      title={desktopInteraction ? "ドラッグでサイズ変更" : "指でサイズ変更"}
                      className={cn(
                        "absolute touch-none cursor-nwse-resize rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface)] opacity-80 shadow-md transition-opacity hover:opacity-100",
                        desktopInteraction
                          ? "-bottom-1.5 -right-1.5 h-4 w-4"
                          : "-bottom-3 -right-3 h-7 w-7",
                      )}
                      onPointerDown={(ev) => handleComboResizeDown(item.uid, ev)}
                    >
                      <span className="pointer-events-none absolute inset-[3px] rounded-full bg-[var(--vy-text-dim)]" />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "absolute flex items-center justify-center rounded-full border border-[var(--vy-border)] bg-[var(--vy-surface-2)] text-[0.7rem] text-[var(--vy-text-dim)] shadow-lg",
                        desktopInteraction ? "-right-2 -top-2 h-5 w-5" : "-right-3 -top-3 h-7 w-7",
                      )}
                      onClick={() => {
                        setComboItems((prev) => prev.filter((x) => x.uid !== item.uid));
                        if (comboItems.length <= 1) setComboMode(false);
                      }}
                      aria-label="組み合わせから削除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            {comboError && <p className="mt-2 text-xs text-[var(--vy-danger)]">{comboError}</p>}
          </div>
        )}

        {loading && !catalog && (
          <p className="px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">読み込み中…</p>
        )}
        {error && !loading && !catalog && (
          <p className="px-2 py-6 text-center text-xs text-[var(--vy-danger)]">{error}</p>
        )}

        {tab === "favorite" ? (
          <div className="grid grid-cols-4 gap-1">
            {favorites.length === 0 && (
              <p className="col-span-4 px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">
                {desktopInteraction
                  ? "右クリックでスタンプ / 絵文字をお気に入りに追加できます"
                  : "長押しメニューからスタンプ / 絵文字をお気に入りに追加できます"}
              </p>
            )}
            {favorites.map((f) => {
              const payload: DragPayload = {
                type: f.type,
                packageId: f.packageId,
                stickerId: f.id,
                url: f.url,
                name: f.name || f.id,
              };
              const canCombine = canCombineSticker(f.type, f.packageId);
              const draggable = desktopInteraction && canCombine;
              return (
                <button
                  key={`${f.type}-${f.id}`}
                  type="button"
                  title={f.name || f.id}
                  draggable={draggable}
                  onPointerDown={(ev) => startLongPress(payload, ev)}
                  onPointerMove={moveLongPress}
                  onPointerUp={stopLongPress}
                  onPointerCancel={stopLongPress}
                  onPointerLeave={stopLongPress}
                  onDragStart={(ev) => {
                    if (!desktopInteraction || !canCombine) {
                      ev.preventDefault();
                      return;
                    }
                    ev.dataTransfer.effectAllowed = "copy";
                    ev.dataTransfer.setData(
                      "application/x-vyline-sticker",
                      JSON.stringify(payload),
                    );
                  }}
                  onClick={() =>
                    handleStickerClick(payload, () => {
                      if (f.type === "sticker") {
                        onPickSticker(f.packageId, f.id, catalog?.premium?.active);
                      } else {
                        onPickEmoji(f.packageId, f.id);
                      }
                    })
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!desktopInteraction) return;
                    openItemMenu(payload, e.clientX, e.clientY);
                  }}
                  className={cn(
                    "flex aspect-square w-full touch-manipulation items-center justify-center rounded-xl p-0.5 transition-colors hover:bg-[var(--vy-surface-2)] active:scale-95",
                    desktopInteraction && canCombine && "cursor-grab active:cursor-grabbing",
                    comboMode && f.type === "sticker" && !canCombine && "opacity-55",
                  )}
                >
                  <img
                    src={assetUrl(f.url)}
                    alt={f.name || ""}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                    draggable={false}
                    referrerPolicy="no-referrer"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {catalog && activePack ? (
              <div className={cn("grid gap-1", tab === "sticker" ? "grid-cols-4" : "grid-cols-6")}>
                {activePack.items.map((item) => {
                  const isFav = favorites.some(
                    (f) => f.type === activePack.type && f.id === item.id,
                  );
                  return (
                    <div key={item.id} className="relative">
                      {renderGridItem(item, activePack)}
                      {isFav && (
                        <span className="pointer-events-none absolute right-0.5 top-0.5 text-[0.6rem] text-[var(--vy-accent)]">
                          ★
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">
                パックがありません
              </p>
            )}
          </>
        )}
      </div>

      {menu && (accountId || demoMode) && (
        <>
          <div
            className="fixed inset-0 z-[119]"
            onClick={closeItemMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeItemMenu();
            }}
          />
          <div
            role="menu"
            aria-label="スタンプ操作"
            className="vy-context-menu fixed z-[120] flex min-w-44 flex-col overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.comboPayload && (
              <button
                type="button"
                role="menuitem"
                className="vy-touch-target flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
                onClick={() => {
                  if (menu.comboPayload) addComboItem(menu.comboPayload);
                  closeItemMenu();
                }}
              >
                ＋ 組み合わせに追加
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="vy-touch-target flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                const added = toggleFavoriteFromMenu(menu.fav);
                closeItemMenu();
                void copyText(added ? "お気に入りに追加しました" : "お気に入りから外しました");
              }}
            >
              {favorites.some((f) => f.type === menu.fav.type && f.id === menu.fav.id)
                ? "★ お気に入りから外す"
                : "☆ お気に入りに追加"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="vy-touch-target flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                void copyText(lineStoreUrl(menu.fav.type, menu.fav.packageId));
                closeItemMenu();
              }}
            >
              Store URL をコピー
            </button>
            <button
              type="button"
              role="menuitem"
              className="vy-touch-target flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                window.open(lineStoreUrl(menu.fav.type, menu.fav.packageId), "_blank", "noopener");
                closeItemMenu();
              }}
            >
              Store で開く
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export const StickerEmojiPanelMemo = memo(StickerEmojiPanel);
