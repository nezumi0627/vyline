import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";
import { hideBrokenMedia } from "@/utils/lineMedia";
import { useControllerPortalTarget } from "@/ui/native-controller-surface";

export function MediaLightbox({
  src,
  fullSrc,
  kind = "image",
  alt = "メディア",
  onClose,
}: {
  src: string;
  /** フル解像度（無ければ src） */
  fullSrc?: string;
  kind?: "image" | "video";
  alt?: string;
  onClose: () => void;
}) {
  const url = fullSrc || src.replace(/([?&])preview=1(?=&|#|$)/, "$1preview=0");
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const clampView = (scale: number, x: number, y: number) => {
    const bounds = viewport.current?.getBoundingClientRect();
    const image = viewport.current?.querySelector("img");
    const maxX = Math.max(0, ((image?.clientWidth ?? 0) * scale - (bounds?.width ?? 0)) / 2);
    const maxY = Math.max(0, ((image?.clientHeight ?? 0) * scale - (bounds?.height ?? 0)) / 2);
    return { scale, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const toggleZoom = () => setView(current => ({ scale: current.scale > 1 ? 1 : 2, x: 0, y: 0 }));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controllerTarget = useControllerPortalTarget();

  useLayoutEffect(() => {
    if (controllerTarget) return;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = prev;
    };
  }, [controllerTarget]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      open={controllerTarget ? true : undefined}
      ref={dialogRef}
      className="vy-fade-in fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/85 p-4 backdrop-blur-sm backdrop:bg-transparent"
      aria-label={alt}
      onClick={onClose}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <IconClose size={20} />
      </button>
      <div
        ref={viewport}
        className="flex h-[86dvh] w-[96vw] items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {kind === "video" ? (
          <video src={url} playsInline controls autoPlay={!controllerTarget} data-native-autoplay={controllerTarget ? "true" : undefined} preload={controllerTarget ? "none" : undefined} className="max-h-[92dvh] max-w-full bg-black" />
        ) : (
          <button
            type="button"
            aria-label={`${alt}（クリック・ピンチでズーム、${Math.round(view.scale * 100)}%）`}
            data-zoom={view.scale}
            className="flex h-full w-full items-center justify-center border-0 bg-transparent p-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ touchAction: "none", transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, cursor: view.scale > 1 ? "grab" : "zoom-in" }}
            onClick={event => { if (event.detail === 0 || !moved.current) toggleZoom(); }}
            onKeyDown={event => {
              if (event.key.startsWith("Arrow") && view.scale > 1) {
                event.preventDefault();
                setView(current => clampView(current.scale, current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0)));
              }
            }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              if (pointers.current.size === 0) moved.current = false;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const before = [...pointers.current.values()];
              const last = pointers.current.get(event.pointerId);
              if (!last) return;
              const dx = event.clientX - last.x;
              const dy = event.clientY - last.y;
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
              if (before.length === 2) {
                moved.current = true;
                const after = [...pointers.current.values()];
                const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
                const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
                setView(current => clampView(Math.max(1, Math.min(4, current.scale * distance / Math.max(1, oldDistance))), current.x + dx / 2, current.y + dy / 2));
              } else setView(current => clampView(current.scale, current.x + dx, current.y + dy));
            }}
            onPointerUp={event => pointers.current.delete(event.pointerId)}
            onPointerCancel={event => { pointers.current.delete(event.pointerId); moved.current = true; }}
            onLostPointerCapture={event => pointers.current.delete(event.pointerId)}
          >
            <img src={url} alt={alt} onError={hideBrokenMedia} draggable={false} data-zoom={view.scale} className="max-h-full max-w-full object-contain pointer-events-none" />
          </button>
        )}
      </div>
    </dialog>,
    controllerTarget ?? document.body,
  );
}
