export type CallMessageMeta = {
  video: boolean;
  group: boolean;
  durationSec?: number;
  outcome:
    | "started"
    | "ended"
    | "unknown"
    | "missed"
    | "declined"
    | "busy"
    | "cancelled"
    | "no-answer";
};

export function parseCallMeta(
  contentType: string,
  meta: Record<string, unknown> | null,
  outgoing: boolean,
): CallMessageMeta {
  const u = contentType.toUpperCase();
  const typeHint = String(meta?.CALL_TYPE ?? meta?.TYPE ?? "").toUpperCase();
  const video =
    String(meta?.GC_MEDIA_TYPE ?? "").toUpperCase() === "VIDEO" ||
    (u.includes("VIDEO") && u.includes("CALL")) ||
    typeHint.includes("VIDEO") ||
    typeHint === "1";
  const group = typeHint === "G" || u.includes("GROUP") || Boolean(meta?.GC_DURATION);
  const groupEvent = String(meta?.GC_EVT_TYPE ?? "").toUpperCase();
  const durationMillisRaw = meta?.DURATION ?? meta?.GC_DURATION ?? meta?.voipDuration;
  const durationRaw = durationMillisRaw ?? meta?.duration;
  let durationSec: number | undefined;
  if (typeof durationRaw === "string" || typeof durationRaw === "number") {
    const n = Number(durationRaw);
    if (Number.isFinite(n) && n > 0) {
      durationSec =
        durationMillisRaw !== undefined
          ? Math.floor(n / 1000)
          : Math.round(n > 10_000 ? n / 1000 : n);
    }
  }
  const result = String(meta?.RESULT ?? meta?.voipResult ?? meta?.eventType ?? "").toLowerCase();
  let outcome: CallMessageMeta["outcome"] = "ended";
  if (group && (groupEvent || result === "info")) {
    outcome = groupEvent === "S" ? "started" : groupEvent === "E" ? "ended" : "unknown";
  } else if (result.includes("cancel") || result.includes("miss") || result === "3") {
    outcome = outgoing ? "cancelled" : "missed";
  } else if (result.includes("decline") || result.includes("reject") || result === "2") {
    outcome = outgoing ? "no-answer" : "declined";
  } else if (
    result.includes("busy") ||
    result.includes("no_response") ||
    result.includes("no response") ||
    result.includes("info") ||
    result.includes("fail")
  ) {
    outcome = outgoing ? "no-answer" : "missed";
  } else if (!durationSec && !result) {
    outcome = "ended";
  }
  return { video, group, ...(durationSec !== undefined ? { durationSec } : {}), outcome };
}
