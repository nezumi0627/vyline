import { describe, expect, it } from "bun:test";
import { useStore } from "./store.js";

describe("useStore.resetAccountData", () => {
  it("keeps the last opened chat for startup restoration", () => {
    useStore.setState({
      activeChatId: "chat-last-opened",
    });

    useStore.getState().resetAccountData();

    expect(useStore.getState().activeChatId).toBe("chat-last-opened");
  });
});
