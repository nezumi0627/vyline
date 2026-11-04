import { describe, expect, it } from "bun:test";
import { advanceUnreadBacklogPages, type UnreadBacklogPages } from "./unreadBacklogPages";

describe("unread backlog page limit", () => {
  it("resets the page count when the same chat is opened again", () => {
    const limit = 2;
    let state: UnreadBacklogPages = { chatId: null, count: 0 };

    for (let page = 0; page < limit; page++) {
      const result = advanceUnreadBacklogPages(state, "chat-1", limit);
      expect(result.shouldLoad).toBe(true);
      state = result.state;
    }
    expect(advanceUnreadBacklogPages(state, "chat-1", limit).shouldLoad).toBe(false);

    state = advanceUnreadBacklogPages(state, null, limit).state;
    const reopened = advanceUnreadBacklogPages(state, "chat-1", limit);
    expect(reopened.shouldLoad).toBe(true);
    expect(reopened.state.count).toBe(1);
  });
});
