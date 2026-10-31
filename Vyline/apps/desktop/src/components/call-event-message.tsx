import { cn } from "@/lib/utils";
import type { CallMessageMeta } from "@/lib/store-types";
import { IconPhone, IconVideo } from "@/components/icons";
import { formatCallDuration } from "./message-bubble-helpers";

function labelFor(meta: CallMessageMeta): { title: string; detail?: string } {
  const kind = meta.group
    ? meta.video
      ? "グループビデオ通話"
      : "グループ通話"
    : meta.video
      ? "ビデオ通話"
      : "音声通話";
  const dur = formatCallDuration(meta.durationSec);
  switch (meta.outcome) {
    case "missed":
      return { title: `不在着信 · ${kind}` };
    case "declined":
      return { title: `拒否 · ${kind}` };
    case "busy":
      return { title: `応答なし · ${kind}` };
    default:
      return {
        title: kind,
        detail: dur ? `通話時間 ${dur}` : "通話が終了しました",
      };
  }
}

export function CallEventMessage({ meta, isMe }: { meta?: CallMessageMeta; isMe?: boolean }) {
  const resolved: CallMessageMeta = meta ?? {
    video: false,
    group: false,
    outcome: "ended",
  };
  const { title, detail } = labelFor(resolved);
  const missed =
    resolved.outcome === "missed" || resolved.outcome === "declined" || resolved.outcome === "busy";

  return (
    <div className="my-1 flex w-full justify-center px-2">
      <div
        className={cn(
          "inline-flex max-w-[min(100%,320px)] items-center gap-2 rounded-lg border px-3 py-2",
          missed
            ? "border-[color-mix(in_oklab,var(--vy-danger)_35%,var(--vy-border))] bg-[color-mix(in_oklab,var(--vy-danger)_10%,var(--vy-surface))]"
            : "border-[var(--vy-border)] bg-[var(--vy-surface)]",
        )}
        role="status"
        aria-label={title}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            missed
              ? "bg-[color-mix(in_oklab,var(--vy-danger)_22%,transparent)] text-[var(--vy-danger)]"
              : "bg-[color-mix(in_oklab,var(--vy-accent)_18%,transparent)] text-[var(--vy-accent)]",
          )}
        >
          {resolved.video ? <IconVideo size={17} /> : <IconPhone size={17} />}
        </span>
        <div className="min-w-0 text-left">
          <div className="text-sm font-semibold text-[var(--vy-text)]">{title}</div>
          {detail && (
            <div className="text-xs text-[var(--vy-text-dim)]">
              {isMe ? `あなた · ${detail}` : detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
