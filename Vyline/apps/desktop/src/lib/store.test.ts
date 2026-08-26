import { describe, expect, it } from "bun:test";
import { useStore } from "./store.js";

describe("useStore account initialization", () => {
  it("keeps the last opened chat when the persisted account is initialized", () => {
    useStore.setState({
      accountId: null,
      activeChatId: "chat-last-opened",
    });

    useStore.getState().setAccountId("account-1");
    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBe("chat-last-opened");
  });

  it("clears the last opened chat when switching accounts", () => {
    useStore.setState({
      accountId: "account-1",
      activeChatId: "chat-account-1",
    });

    useStore.getState().setAccountId("account-2");

    expect(useStore.getState().activeChatId).toBeNull();
  });
});
