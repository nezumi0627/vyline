import { afterEach, expect, test } from "bun:test";
import {
  clearTalkEvents,
  drainTalkEvents,
  restoreTalkEventBuffer,
} from "./talkEventBuffer.js";

afterEach(() => clearTalkEvents("offline-outbox-restore"));

test("restores persisted event sequence and resumes polling after restart", () => {
  restoreTalkEventBuffer("offline-outbox-restore", [
    { kind: "read", chatMid: "u-peer", seq: 8 },
    { kind: "revoke", chatMid: "u-peer", messageId: "9", seq: 9 },
  ], 9);

  expect(drainTalkEvents("offline-outbox-restore", 8)).toEqual({
    cursor: 9,
    events: [{ kind: "revoke", chatMid: "u-peer", messageId: "9", seq: 9 }],
    reset: false,
    seq: 9,
  });
});

test("detects a client cursor older than the retained event window", () => {
  restoreTalkEventBuffer("offline-outbox-restore", [
    { kind: "read", chatMid: "u-peer", seq: 600 },
  ], 800);

  expect(drainTalkEvents("offline-outbox-restore", 2)).toEqual({
    cursor: 800,
    events: [],
    reset: true,
    seq: 800,
  });
});
