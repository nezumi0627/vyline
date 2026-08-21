import { memo, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
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

export type CatalogItem = { id: string; url: string; alt?: string };
export type CatalogPack = {
  packageId: string;
  name: string;
  type: "sticker" | "emoji";
  tabUrl: string;
  items: CatalogItem[];
};

type Catalog = StickersCatalogCache;
type CombinationPick = { packageId: string; stickerId: string; url: string; name?: string };

/** 絵文字/スタンプ画像を先読みしてブラウザ＋CDNキャッシュを温める */
function prefetchImgs(urls: string[]): void {
  for (const u of urls) {
    const src = u.startsWith("http") ? `/api/cdn/line?u=${encodeURIComponent(u)}` : u;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}

function CombinationPreview({ items }: { items: CombinationPick[] }) {
  const count = items.length;
  const tiles = (() => {
    switch (count) {
      case 1:
        return [{ x: 18, y: 18, w: 64, h: 64 }];
      case 2:
        return [
          { x: 4, y: 18, w: 38, h: 64 },
          { x: 58, y: 18, w: 38, h: 64 },
        ];
      case 3:
        return [
          { x: 22, y: 4, w: 52, h: 44 },
          { x: 6, y: 50, w: 30, h: 36 },
          { x: 58, y: 50, w: 30, h: 36 },
        ];
      case 4:
        return [
          { x: 6, y: 6, w: 36, h: 36 },
          { x: 50, y: 6, w: 36, h: 36 },
          { x: 6, y: 50, w: 36, h: 36 },
          { x: 50, y: 50, w: 36, h: 36 },
        ];
      case 5:
        return [
          { x: 10, y: 6, w: 28, h: 28 },
          { x: 50, y: 6, w: 28, h: 28 },
          { x: 4, y: 42, w: 24, h: 24 },
          { x: 30, y: 42, w: 24, h: 24 },
          { x: 56, y: 42, w: 24, h: 24 },
        ];
      default:
        return [
          { x: 6, y: 8, w: 24, h: 24 },
          { x: 32, y: 8, w: 24, h: 24 },
          { x: 58, y: 8, w: 24, h: 24 },
          { x: 6, y: 42, w: 24, h: 24 },
          { x: 32, y: 42, w: 24, h: 24 },
          { x: 58, y: 42, w: 24, h: 24 },
        ];
    }
  })();

  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-inner">
      {count === 0 ? (
        <div className="flex h-full items-center justify-center text-[0.65rem] text-[var(--vy-text-dim)]">
          追加したスタンプがここに並びます
        </div>
      ) : (
        tiles.map((tile, i) => {
          const item = items[i]!;
          return (
            <img
              key={`${item.packageId}-${item.stickerId}-${i}`}
              src={
                item.url.startsWith("http")
                  ? `/api/cdn/line?u=${encodeURIComponent(item.url)}`
                  : item.url
              }
              alt={item.name || item.stickerId}
              className="absolute object-contain"
              style={{
                left: `${tile.x}%`,
                top: `${tile.y}%`,
                width: `${tile.w}%`,
                height: `${tile.h}%`,
              }}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          );
        })
      )}
      {count > 6 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--vy-surface)_32%,transparent)] text-xs font-semibold">
          +{count - 6}
        </div>
      )}
    </div>
  );
}

const UNICODE_EMOJI = [
  "😀",
  "😂",
  "🥹",
  "😊",
  "😍",
  "🤔",
  "😎",
  "😴",
  "🥳",
  "😇",
  "🙌",
  "👍",
  "🙏",
  "👏",
  "🔥",
  "💯",
  "✨",
  "🎉",
  "❤️",
  "💙",
  "💚",
  "💛",
  "🧡",
  "💜",
  "😭",
  "😤",
  "🥺",
  "😘",
  "🤝",
  "👀",
];

type Tab = "sticker" | "emoji" | "unicode" | "favorite";

type MenuState = { x: number; y: number; fav: StickerFavorite } | null;

export function StickerEmojiPanel({
  accountId,
  onPickSticker,
  onPickEmoji,
  onPickUnicode,
}: {
  accountId: string | null;
  onPickSticker: (packageId: string, stickerId: string, isPremium?: boolean) => void;
  onPickEmoji: (packageId: string, sticonId: string) => void;
  onPickUnicode: (glyph: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("sticker");
  const [favorites, setFavorites] = useState<StickerFavorite[]>(() =>
    accountId ? loadStickerFavorites(accountId) : [],
  );
  const [menu, setMenu] = useState<MenuState>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(() =>
    accountId ? getCachedStickersCatalog(accountId) : null,
  );
  const [loading, setLoading] = useState(() =>
    accountId ? !getCachedStickersCatalog(accountId) : false,
  );
  const [error, setError] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(() => {
    const cached = accountId ? getCachedStickersCatalog(accountId) : null;
    return cached?.stickerPacks[0]?.packageId ?? cached?.emojiPacks[0]?.packageId ?? null;
  });
  const [comboMode, setComboMode] = useState(false);
  const [comboItems, setComboItems] = useState<CombinationPick[]>([]);
  const [comboBusy, setComboBusy] = useState(false);
  const [comboError, setComboError] = useState<string | null>(null);
  const [comboCreatedId, setComboCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
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
      .stickers(accountId)
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
  }, [accountId]);

  const packs = useMemo(() => {
    if (!catalog) return [];
    if (tab === "sticker") return catalog.stickerPacks;
    if (tab === "emoji") return catalog.emojiPacks;
    return [];
  }, [catalog, tab]);

  const activePack = packs.find((p) => p.packageId === packId) ?? packs[0];
  const selectedCountText = `${comboItems.length} 枚選択中`;

  useEffect(() => {
    if (tab === "unicode") return;
    if (!packs.some((p) => p.packageId === packId)) {
      setPackId(packs[0]?.packageId ?? null);
    }
  }, [tab, packs, packId]);

  // カタログ／選択パックが変わったら画像を先読み（開く前にキャッシュを温める）
  useEffect(() => {
    if (!catalog) return;
    const tabIcons = [
      ...catalog.stickerPacks.map((p) => p.tabUrl),
      ...catalog.emojiPacks.map((p) => p.tabUrl),
    ];
    const active =
      catalog.stickerPacks.find((p) => p.packageId === packId) ??
      catalog.emojiPacks.find((p) => p.packageId === packId);
    const items = active ? active.items.map((i) => i.url) : [];
    prefetchImgs([...tabIcons, ...items]);
  }, [catalog, packId]);

  function toggleComboMode(): void {
    setComboMode((next) => {
      const enabled = !next;
      if (!enabled) {
        setComboError(null);
      }
      return enabled;
    });
  }

  function addComboItem(item: CombinationPick): void {
    setComboError(null);
    setComboCreatedId(null);
    setComboItems((prev) => {
      const exists = prev.some(
        (x) => x.packageId === item.packageId && x.stickerId === item.stickerId,
      );
      if (exists) {
        return prev.filter(
          (x) => !(x.packageId === item.packageId && x.stickerId === item.stickerId),
        );
      }
      if (prev.length >= 6) {
        setComboError("組み合わせは最大6枚までです");
        return prev;
      }
      return [...prev, item];
    });
  }

  async function createComboSticker(): Promise<void> {
    if (!accountId) return;
    if (comboItems.length === 0) {
      setComboError("スタンプを1つ以上選んでください");
      return;
    }
    setComboBusy(true);
    setComboError(null);
    try {
      const packageIds = [...new Set(comboItems.map((item) => item.packageId))];
      const canCreate = await api.line.canCreateCombinationSticker(accountId, packageIds);
      if (!canCreate.ok || !canCreate.canCreate) {
        setComboError("この組み合わせは作成できません");
        return;
      }
      const created = await api.line.createCombinationSticker(
        accountId,
        comboItems.map((item) => ({ packageId: item.packageId, stickerId: item.stickerId })),
      );
      if (!created.ok) {
        setComboError(created.error || "作成に失敗しました");
        return;
      }
      setComboCreatedId(created.id);
      setComboItems([]);
      void copyText(`組み合わせスタンプを作成しました: ${created.id}`);
    } catch (err) {
      setComboError(String(err));
    } finally {
      setComboBusy(false);
    }
  }

  return (
    <div className="vy-scale-in absolute bottom-full left-3 mb-2 flex h-[320px] w-[min(380px,92vw)] flex-col overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-2xl md:left-5">
      <div className="flex items-center gap-1 border-b border-[var(--vy-border)] px-2 pt-2">
        {(
          [
            ["sticker", "スタンプ"],
            ["emoji", "絵文字"],
            ["favorite", "★"],
            ["unicode", "Unicode"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-t-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              tab === id
                ? "bg-[var(--vy-surface-2)] text-[var(--vy-text)]"
                : "text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 px-2 text-[0.65rem] text-[var(--vy-text-dim)]">
          {catalog?.premium.active && <PremiumBadge size={12} compact />}
          <span>
            {catalog?.premium.active
              ? catalog.premium.onFreeTrial
                ? "Premium お試し"
                : "Premium"
              : "Premium —"}
          </span>
        </span>
        {tab === "sticker" && (
          <button
            type="button"
            onClick={toggleComboMode}
            className={cn(
              "mb-1 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold transition-colors",
              comboMode
                ? "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]"
                : "bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]",
            )}
          >
            {comboMode ? "組み合わせ中" : "組み合わせ作成"}
          </button>
        )}
      </div>

      {tab !== "unicode" && (
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--vy-border)] px-2 py-1.5 [scrollbar-width:thin]">
          {packs.map((p) => (
            <button
              key={p.packageId}
              type="button"
              title={p.name}
              onClick={() => setPackId(p.packageId)}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                activePack?.packageId === p.packageId
                  ? "border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)]"
                  : "border-transparent hover:bg-[var(--vy-surface-2)]",
              )}
            >
              <img
                src={p.tabUrl}
                alt=""
                className="h-7 w-7 object-contain"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {comboMode && tab === "sticker" && (
          <div className="mb-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2">
            <div className="flex items-start gap-3">
              <CombinationPreview items={comboItems} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-[var(--vy-text)]">組み合わせ作成</p>
                  <span className="rounded-full bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] px-2 py-0.5 text-[0.65rem] text-[var(--vy-text-dim)]">
                    {selectedCountText}
                  </span>
                </div>
                <p className="mt-1 text-[0.7rem] text-[var(--vy-text-dim)]">
                  スタンプを最大6枚まで選んで、作成ボタンを押してください。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {comboItems.map((item) => (
                    <button
                      key={`${item.packageId}-${item.stickerId}`}
                      type="button"
                      onClick={() => addComboItem(item)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--vy-border)] px-2 py-1 text-[0.65rem] text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface)]"
                    >
                      <span className="max-w-24 truncate">{item.name || item.stickerId}</span>
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void createComboSticker()}
                    disabled={comboBusy || comboItems.length === 0}
                    className="rounded-full bg-[var(--vy-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {comboBusy ? "作成中…" : "作成"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComboItems([]);
                      setComboError(null);
                      setComboCreatedId(null);
                    }}
                    className="rounded-full border border-[var(--vy-border)] px-3 py-1.5 text-xs text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface)]"
                  >
                    クリア
                  </button>
                </div>
                {comboCreatedId && (
                  <div className="mt-2 rounded-xl border border-[color-mix(in_oklab,var(--vy-accent)_35%,var(--vy-border))] bg-[color-mix(in_oklab,var(--vy-accent)_10%,transparent)] px-3 py-2 text-xs">
                    <span className="font-semibold text-[var(--vy-text)]">作成済み</span>
                    <span className="ml-2 break-all text-[var(--vy-text-dim)]">
                      {comboCreatedId}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyText(comboCreatedId)}
                      className="ml-2 rounded-full bg-[var(--vy-surface)] px-2 py-0.5 font-medium text-[var(--vy-text)]"
                    >
                      コピー
                    </button>
                  </div>
                )}
                {comboError && <p className="mt-2 text-xs text-[var(--vy-danger)]">{comboError}</p>}
              </div>
            </div>
          </div>
        )}
        {loading && !catalog && (
          <p className="px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">読み込み中…</p>
        )}
        {error && !loading && !catalog && (
          <p className="px-2 py-6 text-center text-xs text-[var(--vy-danger)]">{error}</p>
        )}
        {!error && tab === "unicode" && (
          <div className="grid grid-cols-8 gap-1">
            {UNICODE_EMOJI.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onPickUnicode(g)}
                className="flex h-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-110 hover:bg-[var(--vy-surface-2)]"
              >
                {g}
              </button>
            ))}
          </div>
        )}
        {tab === "favorite" && (
          <div className="grid grid-cols-4 gap-1">
            {favorites.length === 0 && (
              <p className="col-span-4 px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">
                右クリックでスタンプ / 絵文字をお気に入りに追加できます
              </p>
            )}
            {favorites.map((f) => (
              <button
                key={`${f.type}-${f.id}`}
                type="button"
                title={f.name || f.id}
                onClick={() => {
                  if (comboMode && f.type === "sticker") {
                    addComboItem({
                      packageId: f.packageId,
                      stickerId: f.id,
                      url: f.url,
                      name: f.name || f.id,
                    });
                  } else if (f.type === "sticker")
                    onPickSticker(f.packageId, f.id, catalog?.premium?.active);
                  else onPickEmoji(f.packageId, f.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, fav: f });
                }}
                className="flex aspect-square items-center justify-center rounded-xl p-1 transition-colors hover:bg-[var(--vy-surface-2)] active:scale-95"
              >
                <img
                  src={
                    f.url.startsWith("http")
                      ? `/api/cdn/line?u=${encodeURIComponent(f.url)}`
                      : f.url
                  }
                  alt={f.name || ""}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </button>
            ))}
          </div>
        )}
        {catalog && tab !== "unicode" && tab !== "favorite" && activePack && (
          <div className={cn("grid gap-1", tab === "sticker" ? "grid-cols-4" : "grid-cols-6")}>
            {activePack.items.map((item) => {
              const isFav = favorites.some((f) => f.type === activePack.type && f.id === item.id);
              return (
                <div key={item.id} className="relative">
                  <button
                    type="button"
                    title={item.alt || item.id}
                    onClick={() => {
                      if (comboMode && activePack.type === "sticker") {
                        addComboItem({
                          packageId: activePack.packageId,
                          stickerId: item.id,
                          url: item.url,
                          name: item.alt || activePack.name,
                        });
                      } else if (activePack.type === "sticker") {
                        onPickSticker(activePack.packageId, item.id, catalog?.premium?.active);
                      } else {
                        onPickEmoji(activePack.packageId, item.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        fav: {
                          type: activePack.type,
                          packageId: activePack.packageId,
                          id: item.id,
                          url: item.url,
                          name: item.alt || activePack.name,
                        },
                      });
                    }}
                    className="flex aspect-square items-center justify-center rounded-xl p-1 transition-colors hover:bg-[var(--vy-surface-2)] active:scale-95"
                  >
                    <img
                      src={
                        item.url.startsWith("http")
                          ? `/api/cdn/line?u=${encodeURIComponent(item.url)}`
                          : item.url
                      }
                      alt={item.alt || ""}
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  {isFav && (
                    <span className="pointer-events-none absolute right-0.5 top-0.5 text-[0.6rem] text-[var(--vy-accent)]">
                      ★
                    </span>
                  )}
                  {comboMode && activePack.type === "sticker" && (
                    <span className="pointer-events-none absolute left-0.5 top-0.5 rounded-full bg-[var(--vy-accent)] px-1 py-0.5 text-[0.55rem] font-bold text-[var(--vy-accent-contrast)]">
                      +
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {catalog && tab !== "unicode" && tab !== "favorite" && !activePack && (
          <p className="px-2 py-6 text-center text-xs text-[var(--vy-text-dim)]">
            パックがありません
          </p>
        )}
      </div>

      {menu && accountId && (
        <>
          <div
            className="fixed inset-0 z-[119]"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-[120] flex min-w-44 flex-col overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                const { favorites: next, added } = toggleStickerFavorite(accountId, menu.fav);
                setFavorites(next);
                setMenu(null);
                void copyText(added ? "お気に入りに追加しました" : "お気に入りから外しました");
              }}
            >
              {favorites.some((f) => f.type === menu.fav.type && f.id === menu.fav.id)
                ? "★ お気に入りから外す"
                : "☆ お気に入りに追加"}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                void copyText(lineStoreUrl(menu.fav.type, menu.fav.packageId));
                setMenu(null);
              }}
            >
              Store URL をコピー
            </button>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)]"
              onClick={() => {
                window.open(lineStoreUrl(menu.fav.type, menu.fav.packageId), "_blank", "noopener");
                setMenu(null);
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
