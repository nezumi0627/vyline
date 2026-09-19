import { expect, test } from "bun:test";
import { isAllowedWebSocketOrigin } from "./remoteAccess.js";

test("allows same-origin WebSocket requests behind a TLS reverse proxy", () => {
  const request = new Request("http://127.0.0.1:3001/line/main/call/ws", {
    headers: {
      host: "vyline.example",
      origin: "https://vyline.example",
    },
  });

  expect(isAllowedWebSocketOrigin(request, new Set(["http://localhost:5173"]))).toBe(true);
});

test("rejects cross-site WebSocket origins", () => {
  const request = new Request("http://127.0.0.1:3001/line/main/call/ws", {
    headers: {
      host: "vyline.example",
      origin: "https://attacker.example",
    },
  });

  expect(isAllowedWebSocketOrigin(request, new Set(["http://localhost:5173"]))).toBe(false);
});
