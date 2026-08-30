import { describe, expect, it } from "bun:test";
import { parseImageMediaGroup, shareImageMediaGroup } from "./mediaGroup.js";
import type { Message } from "./store-types.js";

function image(id: string, mediaGroup?: Message["mediaGroup"]): Message {
  return {
    id,
    chatId: "c-test",
    authorId: "u-test",
    kind: "image",
    imageSrc: `/media/${id}`,
    mediaGroup,
    createdAt: Number(id),
    status: "sent",
    read: false,
    messageState: "normal",
  };
}

describe("image media groups", () => {
  it("parses a real LINE multi-image group", () => {
    expect(parseImageMediaGroup({ GID: "629629126478921814", GSEQ: "2", GTOTAL: "3" })).toEqual({
      id: "629629126478921814",
      sequence: 2,
      total: 3,
    });
  });

  it("rejects standalone and invalid group metadata", () => {
    expect(parseImageMediaGroup({})).toBeUndefined();
    expect(parseImageMediaGroup({ GID: "0", GSEQ: "1", GTOTAL: "3" })).toBeUndefined();
    expect(parseImageMediaGroup({ GID: "1", GSEQ: "1", GTOTAL: "1" })).toBeUndefined();
    expect(parseImageMediaGroup({ GID: "1", GSEQ: "4", GTOTAL: "3" })).toBeUndefined();
    expect(parseImageMediaGroup({ GID: "1", GSEQ: "x", GTOTAL: "3" })).toBeUndefined();
  });

  it("groups only messages with the same real GID", () => {
    const first = image("1", { id: "group-a", sequence: 1, total: 3 });
    const second = image("2", { id: "group-a", sequence: 2, total: 3 });
    const other = image("3", { id: "group-b", sequence: 3, total: 3 });
    expect(shareImageMediaGroup(first, second)).toBe(true);
    expect(shareImageMediaGroup(second, other)).toBe(false);
  });

  it("does not group consecutive standalone images", () => {
    expect(shareImageMediaGroup(image("1"), image("2"))).toBe(false);
  });
});
