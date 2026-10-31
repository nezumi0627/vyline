import { expect, test } from "bun:test";
import { consumeCallWsTicket, createCallWsTicket } from "./callWsTicket.js";

test("call websocket tickets are scoped and single-use", () => {
  const ticket = createCallWsTicket("account-a", "session-a");
  expect(consumeCallWsTicket(ticket, "account-b", "session-a")).toBe(false);
  expect(consumeCallWsTicket(ticket, "account-a", "session-a")).toBe(true);
  expect(consumeCallWsTicket(ticket, "account-a", "session-a")).toBe(false);
});
