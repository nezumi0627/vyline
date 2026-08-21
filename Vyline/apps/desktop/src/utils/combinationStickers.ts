export type CombinationStickerItem = {
  packageId: string;
  stickerId: string;
  url: string;
  name?: string;
};

export type CombinationStickerPlacement = CombinationStickerItem & {
  x: number;
  y: number;
  size: number;
};

const STORAGE_KEY = (accountId: string) => `vyline:combinationStickerPreviews:${accountId}`;

function loadPreviewStore(accountId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function savePreviewStore(accountId: string, store: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY(accountId), JSON.stringify(store));
  } catch {
    /* ignore quota/private mode */
  }
}

export function getCombinationStickerPreview(accountId: string, comboId: string): string | null {
  const store = loadPreviewStore(accountId);
  return store[comboId] ?? null;
}

export function setCombinationStickerPreview(
  accountId: string,
  comboId: string,
  dataUrl: string,
): void {
  const store = loadPreviewStore(accountId);
  store[comboId] = dataUrl;
  savePreviewStore(accountId, store);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src.startsWith("http") ? `/api/cdn/line?u=${encodeURIComponent(src)}` : src;
  });
}

export async function renderCombinationStickerPreview(
  items: CombinationStickerPlacement[],
  canvasSize = 512,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  const loaded = await Promise.all(
    items.map(async (item) => {
      try {
        const img = await loadImage(item.url);
        return { item, img };
      } catch {
        return null;
      }
    }),
  );

  for (const entry of loaded) {
    if (!entry) continue;
    const { item, img } = entry;
    const box = item.size;
    const x = item.x;
    const y = item.y;
    const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight, 1);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const dx = x + (box - w) / 2;
    const dy = y + (box - h) / 2;
    ctx.drawImage(img, dx, dy, w, h);
  }

  return canvas.toDataURL("image/png");
}
