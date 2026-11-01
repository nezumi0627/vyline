import { describe, expect, it } from "bun:test";
import type { Message } from "@vyline/types";
import { mapMessage } from "./mappers";

function postNotification(contentMetadata: Message["contentMetadata"]): Message {
  return {
    id: "1",
    from: "u-peer",
    to: "c-chat",
    text: null,
    contentType: "POSTNOTIFICATION",
    createdTime: 1,
    isMyMessage: false,
    contentMetadata,
  };
}

describe("POSTNOTIFICATION mapping", () => {
  it("extracts a note target from the GB notification URL", () => {
    const result = mapMessage(
      postNotification({
        serviceType: "GB",
        postEndUrl:
          "https://line.me/R/group/home/posts/post?homeId=c-home&postId=p-note&noteEntryType=post_noti",
        cafeId: "0",
      }),
      "c-chat",
      "account",
    );

    expect(result.postNotification).toEqual({
      kind: "note",
      homeId: "c-home",
      postId: "p-note",
    });
  });

  it("extracts an albumIdV2 target", () => {
    const result = mapMessage(
      postNotification({
        serviceType: "AB",
        postEndUrl: "line://album?albumIdV2=a-album&homeId=c-home",
      }),
      "c-chat",
      "account",
    );

    expect(result.postNotification).toMatchObject({
      kind: "album",
      homeId: "c-home",
      albumId: "a-album",
    });
  });
});
