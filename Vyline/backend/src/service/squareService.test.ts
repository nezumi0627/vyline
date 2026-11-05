import { describe, expect, test } from "bun:test";
import {
  buildSquareReadRequest,
  buildSquareReactionRequest,
  buildSquareCreateOptions,
  buildSquareStickerContent,
  buildSquareThreadTextRequest,
  buildSquareInvitationRequest,
  buildSquareAnnouncementRequest,
} from "./squareService.js";

describe("Square read and reaction request builders", () => {
  test("keeps room and thread read scope explicit", () => {
    expect(buildSquareReadRequest("room", "message")).toEqual({
      request: { squareChatMid: "room", messageId: "message" },
    });
    expect(buildSquareReadRequest("room", "message", "thread")).toEqual({
      request: { squareChatMid: "room", messageId: "message", threadMid: "thread" },
    });
  });

  test("builds the supported reaction request in room or thread scope", () => {
    expect(buildSquareReactionRequest("room", "message", "NICE", "thread")).toEqual({
      request: {
        reqSeq: 0,
        squareChatMid: "room",
        messageId: "message",
        reactionType: 2,
        threadMid: "thread",
      },
    });
  });
});

describe("Square private room creation options", () => {
  test("trims user input and keeps the test room out of public search", () => {
    expect(buildSquareCreateOptions("  Vyline test  ", "owner", " private test ")).toEqual({
      squareName: "Vyline test",
      displayName: "owner",
      description: "private test",
      searchable: false,
      squareJoinMethodType: "CODE",
    });
  });

  test("rejects empty names before a Square creation RPC", () => {
    expect(() => buildSquareCreateOptions("  ", "owner")).toThrow("invalid Square name");
  });
});

describe("Square sticker wire payload", () => {
  test("matches the captured sendMessage content type and metadata keys", () => {
    expect(buildSquareStickerContent("11537", "52002734")).toEqual({
      contentType: 7,
      contentMetadata: { STKPKGID: "11537", STKID: "52002734", STKVER: "1", STKOPT: "" },
    });
    expect(buildSquareStickerContent("11537", "52002734", true)).toEqual({
      contentType: 7,
      contentMetadata: {
        STKPKGID: "11537",
        STKID: "52002734",
        STKVER: "100",
        STKOPT: "A",
      },
    });
  });

  test("rejects non-numeric sticker identifiers before an RPC can be built", () => {
    expect(() => buildSquareStickerContent("../host", "42")).toThrow(
      "invalid Square sticker identity",
    );
  });
});

describe("Square thread wire request", () => {
  test("matches the captured text-message shape used by SquareThreadMessage", () => {
    expect(buildSquareThreadTextRequest(7, "room", "thread", "hello")).toEqual({
      reqSeq: 7,
      chatMid: "room",
      threadMid: "thread",
      threadMessage: {
        message: {
          to: "room",
          text: "hello",
          contentType: "NONE",
          toType: "SQUARE_THREAD",
        },
      },
    });
  });
});

describe("HAR-backed Square room controls", () => {
  test("uses the Square mid as the invitation ticket request identity", () => {
    expect(buildSquareInvitationRequest("square-mid")).toEqual({ request: { mid: "square-mid" } });
  });

  test("builds announcement requests from an existing room message", () => {
    expect(
      buildSquareAnnouncementRequest("room", "member", {
        id: "message",
        text: "announcement",
        createdTime: 123,
      }),
    ).toEqual({
      squareChatMid: "room",
      senderMid: "member",
      messageId: "message",
      text: "announcement",
      createdAt: 123,
    });
  });
});
