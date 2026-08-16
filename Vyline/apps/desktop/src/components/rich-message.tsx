import { useMemo, useState } from "react";
import type { RichMarkup } from "@/lib/flex/types";
import { openFlexAction } from "@/lib/flex/tokens";

type Hotspot = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  href?: string;
  label?: string;
};

function buildHotspots(markup: RichMarkup | null | undefined): {
  canvasW: number;
  canvasH: number;
  spots: Hotspot[];
} {
  const canvasW = Math.max(1, Number(markup?.canvas?.width ?? 1040));
  const canvasH = Math.max(1, Number(markup?.canvas?.height ?? 1040));
  const sceneName = markup?.canvas?.initialScene ?? "scene1";
  const scene = markup?.scenes?.[sceneName];
  const listeners = scene?.listeners ?? [];
  const spots: Hotspot[] = [];

  for (let i = 0; i < listeners.length; i++) {
    const lis = listeners[i]!;
    const params = lis.params ?? [];
    const x = Number(params[0] ?? 0);
    const y = Number(params[1] ?? 0);
    const w = Number(params[2] ?? canvasW);
    const h = Number(params[3] ?? canvasH);
    const action = lis.action ? markup?.actions?.[lis.action] : undefined;
    const href =
      action?.params?.linkUri && typeof action.params.linkUri === "string"
        ? action.params.linkUri
        : undefined;
    spots.push({
      id: `${lis.action ?? "a"}-${i}`,
      left: (x / canvasW) * 100,
      top: (y / canvasH) * 100,
      width: (w / canvasW) * 100,
      height: (h / canvasH) * 100,
      href,
      label: action?.text,
    });
  }

  // listener が無いが action が1つある場合は全面タップ
  if (spots.length === 0) {
    const first = markup?.actions && Object.values(markup.actions)[0];
    const href =
      first?.params?.linkUri && typeof first.params.linkUri === "string"
        ? first.params.linkUri
        : undefined;
    if (href) {
      spots.push({
        id: "full",
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        href,
        label: first?.text,
      });
    }
  }

  return { canvasW, canvasH, spots };
}

export function RichMessageView({
  imageUrl,
  markup,
  altText,
}: {
  imageUrl?: string;
  markup?: RichMarkup | null;
  altText?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { canvasW, canvasH, spots } = useMemo(() => buildHotspots(markup), [markup]);
  const aspect = canvasW / canvasH;

  if (!imageUrl || failed) {
    return (
      <div className="max-w-[300px] rounded-xl bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm">
        {altText || "リッチメッセージ"}
      </div>
    );
  }

  return (
    <div
      className="relative max-w-[300px] overflow-hidden rounded-xl bg-white shadow-sm"
      style={{ width: 300, aspectRatio: String(aspect) }}
    >
      <img
        src={imageUrl}
        alt={altText || "リッチメッセージ"}
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        draggable={false}
      />
      {spots.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-label={s.label || altText || "リンクを開く"}
          className="absolute border-0 bg-transparent p-0"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: `${s.width}%`,
            height: `${s.height}%`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (s.href) openFlexAction({ type: "uri", uri: s.href });
          }}
        />
      ))}
    </div>
  );
}
