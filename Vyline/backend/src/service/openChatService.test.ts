import { describe, expect, test } from "bun:test";
import { mapOpenChatMember, mapOpenChatMessage } from "./openChatService.js";

describe("OpenChat event mapping", () => {
  test("maps a SquareMessage and marks the active square member as self", () => {
    const message = mapOpenChatMessage(
      {
        message: {
          id: "123",
          from: "p-self",
          to: "c-openchat",
          text: "hello",
          contentType: "NONE",
          createdTime: "1720000000000",
          contentMetadata: {},
        },
        messageReactionStatus: {
          myReaction: {
            reactionType: 3,
            createdAt: "1720000000100",
            reactor: { squareMemberMid: "p-self" },
          },
        },
      },
      "p-self",
    );

    expect(message).toMatchObject({
      id: "123",
      from: "p-self",
      to: "c-openchat",
      text: "hello",
      isMyMessage: true,
      relatedMessageId: null,
    });
    expect(message.reactions).toEqual([{ fromMid: "p-self", atMillis: 1720000000100, type: 3 }]);
  });

  test("does not invent reactions when Square provides no reaction status", () => {
    const message = mapOpenChatMessage({
      message: { id: "1", from: "p1", to: "c1", contentType: "NONE", createdTime: 1 },
    });
    expect(message.reactions).toBeUndefined();
  });

  test("converts SquareMember BigInt fields to JSON-safe values", () => {
    const member = mapOpenChatMember({
      squareMemberMid: "p-member",
      squareMid: "s-square",
      displayName: "Test Member",
      revision: 2n,
      createdAt: 1_720_000_000_000n,
    });

    expect(member).toMatchObject({ revision: "2", createdAt: 1_720_000_000_000 });
    expect(() => JSON.stringify(member)).not.toThrow();
  });
});
