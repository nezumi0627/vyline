import { expect, test } from "bun:test";
import { safeCliMessage } from "./cliOutput.js";

test("CLI message output omits encryption metadata and revoked-message snapshots", () => {
  const output = safeCliMessage({
    id: "1",
    chatMid: "chat",
    from: "peer",
    to: "me",
    text: "hello",
    contentType: "TEXT",
    createdTime: 1,
    isMyMessage: false,
    savedAt: "2026-01-01T00:00:00.000Z",
    contentMetadata: { keyMaterial: "secret" },
    readBy: ["user-id"],
    history: [{ state: "normal", text: "old secret", contentType: "TEXT", updatedTime: 1 }],
    revokedSnapshot: { id: "1", from: "peer", to: "me", text: "snapshot", contentType: "TEXT", createdTime: 1, isMyMessage: false },
  });

  expect(output).toMatchObject({ id: "1", text: "hello", contentType: "TEXT" });
  expect(JSON.stringify(output)).not.toContain("secret");
  expect(output).not.toHaveProperty("contentMetadata");
  expect(output).not.toHaveProperty("revokedSnapshot");
  expect(output).not.toHaveProperty("history");
  expect(output).not.toHaveProperty("readBy");
});
