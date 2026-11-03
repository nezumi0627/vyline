import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useStore } from "@/lib/store";
import { MessageInput } from "./message-input";

const initialState = { ...useStore.getInitialState() };
const originalState = useStore.getState();

afterEach(() => {
  Object.assign(useStore.getInitialState(), initialState);
  useStore.setState(originalState, true);
});

function renderInput(chatId = "shared-chat") {
  // Server rendering reads the initial snapshot rather than subscribing to updates.
  Object.assign(useStore.getInitialState(), useStore.getState());
  return renderToStaticMarkup(createElement(MessageInput, { chatId }));
}

test("keeps typed Japanese text visible using the draft writer's account key", () => {
  useStore.setState({ accountId: "account-1", drafts: {}, draftSticons: {} });
  useStore.getState().setDraft("shared-chat", "日本語の下書き");

  expect(renderInput()).toMatch(/<textarea\b[^>]*>日本語の下書き<\/textarea>/);
});

test("renders each account's own draft and sticon when returning to the same chat", () => {
  useStore.setState({ drafts: {}, draftSticons: {} });
  for (const accountId of ["account-1", "account-2", null]) {
    useStore.setState({ accountId });
    const text = accountId ?? "guest";
    useStore.getState().setDraft("shared-chat", `${text}\uFFFC`);
    useStore
      .getState()
      .setDraftSticons("shared-chat", [
        { productId: text, sticonId: "001", S: text.length, E: text.length + 1 },
      ]);
  }

  for (const accountId of ["account-2", "account-1", null]) {
    useStore.setState({ accountId });
    const html = renderInput();
    expect(html).toContain(`>${accountId ?? "guest"}\uFFFC</textarea>`);
    expect(html).toContain(`${accountId ?? "guest"}%2Fandroid%2F001.png`);
    expect(html).not.toContain(
      `${accountId === "account-1" ? "account-2" : "account-1"}%2Fandroid`,
    );
  }
});

test("does not expose an unscoped legacy draft or a different chat's draft", () => {
  useStore.setState({
    accountId: "account-2",
    drafts: { "shared-chat": "unscoped private text" },
    draftSticons: {},
  });
  useStore.getState().setDraft("other-chat", "other chat private text");

  const html = renderInput();
  expect(html).toMatch(/<textarea\b[^>]*><\/textarea>/);
  expect(html).not.toContain("private text");
  expect(useStore.getState().drafts["shared-chat"]).toBe("unscoped private text");
});
