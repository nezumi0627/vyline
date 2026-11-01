import type { Message } from "./store-types.js";

export type ImageMediaGroup = NonNullable<Message["mediaGroup"]>;

function parseInteger(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseImageMediaGroup(
  meta?: Record<string, unknown> | null,
): ImageMediaGroup | undefined {
  const id = typeof meta?.GID === "string" ? meta.GID.trim() : "";
  const total = parseInteger(meta?.GTOTAL);
  const sequence = parseInteger(meta?.GSEQ);
  if (!id || id === "0" || total == null || total <= 1 || sequence == null) return undefined;
  if (sequence < 1 || sequence > total) return undefined;
  return { id, sequence, total };
}

export function shareImageMediaGroup(left: Message, right: Message): boolean {
  const leftGroup = left.mediaGroup;
  const rightGroup = right.mediaGroup;
  return Boolean(
    left.kind === "image" &&
      right.kind === "image" &&
      left.imageSrc &&
      right.imageSrc &&
      !left.replyToId &&
      !right.replyToId &&
      leftGroup &&
      rightGroup &&
      leftGroup.id === rightGroup.id &&
      leftGroup.total === rightGroup.total &&
      left.authorId === right.authorId &&
      left.chatId === right.chatId,
  );
}
