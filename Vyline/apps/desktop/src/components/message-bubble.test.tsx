import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "bun:test";
import { deleteRevokedMessageFromDevice, MessageBubble } from "./message-bubble";
import { CallEventMessage } from "./call-event-message";
import type { Chat, Message } from "@/lib/store-types";
import { useStore } from "@/lib/store";
import { api } from "@/api/client";

const initialState = useStore.getState();
const originalDelete = api.line.deleteRevokedMessage;
const originalWindow = globalThis.window;
afterEach(() => {
  api.line.deleteRevokedMessage = originalDelete;
  globalThis.window = originalWindow;
  useStore.setState(initialState);
});

const chat: Chat = {
  id: "offline-chat", name: "Chat", type: "group", avatar: "C", color: "#000", status: "",
  unread: 0, lastMessagePreview: "", lastMessageTime: 0,
};
const message: Message = {
  id: "offline-message", chatId: chat.id, authorId: "peer", kind: "text", text: "Original text",
  createdAt: 1, status: "sent", read: false, messageState: "normal",
};
const membersById = new Map([
  ["peer", { id: "peer", name: "れんや", avatar: "R", color: "#000" }],
]);
function render(overrides: Partial<Message>, highlight?: string) {
  return renderToStaticMarkup(createElement(MessageBubble, {
    message: { ...message, ...overrides }, chat, membersById, showAvatar: false, showName: false, highlight,
  }));
}

test("images and videos omit the outer bubble framing while text keeps it", () => {
  for (const kind of ["image", "video"] as const) {
    const html = render({ kind, imageSrc: "/offline-media?preview=1" });
    expect(html).not.toContain("vy-bubble-pad");
    expect(html).not.toContain("background:var(--vy-msg-in)");
  }
  expect(render({})).toContain("vy-bubble-pad");
  expect(render({ messageState: "revoked-by-other", revokedSnapshot: {
    ...message, kind: "image", imageSrc: "/offline-media",
  } })).not.toContain("vy-bubble-pad");
});

test("video playback uses native controls outside a button and has no permanent play overlay", () => {
  const html = render({ kind: "video", imageSrc: "/offline-video?preview=1" });
  const videoIndex = html.indexOf("<video");
  expect(videoIndex).toBeGreaterThanOrEqual(0);
  expect(html.slice(videoIndex)).toContain('aria-label="動画を再生"');
  expect(html.slice(videoIndex)).toContain("controls");
  const beforeVideo = html.slice(0, videoIndex);
  const buttonOpen = beforeVideo.lastIndexOf("<button");
  expect(buttonOpen < 0 || beforeVideo.lastIndexOf("</button>") > buttonOpen).toBe(true);
  expect(html).not.toContain('aria-label="動画を拡大"');
  expect(html).not.toContain("pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35");
});

test("placeholder mentions render the matching member name, including search highlighting", () => {
  for (const query of [undefined, "search"]) {
    const html = render({ text: "@⠀", mentions: [{ mid: "peer", S: 0, E: 2 }] }, query);
    expect(html).toContain("れんや");
    expect(html).toContain("@れんや");
    expect(html).toContain('role="button"');
    expect(html).not.toContain("⠀");
  }
});

test("link preview keeps its URL and copy action visible in a compact card", () => {
  const url = "https://line.me/ti/g/7t6NgH3Scx";
  const html = render({
    text: url,
    linkPreview: { url, title: "Join LINE group chat", description: "", site: "line.me" },
  });

  expect(html).toContain("max-w-[360px]");
  expect(html).toContain(url);
  expect(html).toContain("Join LINE group chat");
  expect(html).toContain(">コピー</button>");
});

test("inline URLs use the bubble text color for readable contrast", () => {
  const html = render({ text: "https://line.me/ti/g/7t6NgH3Scx" });

  expect(html).toContain("font-medium text-current underline");
  expect(html).toContain("⧉ コピー");
});

test("revoked content has one status label and retains its snapshot", () => {
  const html = render({ messageState: "revoked-by-other", revokedSnapshot: message });
  expect(html).toContain("Original text");
  expect(html.match(/送信が取り消されました/g)).toHaveLength(1);
  expect(html).not.toContain("取り消し済み");
});

test("call event shows hours in a compact inline card", () => {
  const html = renderToStaticMarkup(createElement(CallEventMessage, {
    meta: { video: false, group: false, outcome: "ended", durationSec: 3661 },
  }));
  expect(html).toContain("通話時間 1時間1分01秒");
  expect(html).toContain("h-8 w-8");
  expect(html).not.toContain("h-11 w-11");
});

test("local deletion confirms irreversible DB deletion and removes only the matching message", async () => {
  let confirmation = "";
  let args: string[] = [];
  globalThis.window = {
    confirm: (text: string) => { confirmation = text; return true; },
    alert: () => { throw new Error("Unexpected alert"); },
  } as unknown as Window & typeof globalThis;
  api.line.deleteRevokedMessage = async (...values) => { args = values; return { ok: true }; };
  const otherChat = { ...message, chatId: "another-chat" };
  const otherMessage = { ...message, id: "another-message" };
  useStore.setState({ accountId: "offline-account", messages: [message, otherChat, otherMessage] });
  await deleteRevokedMessageFromDevice("offline-account", chat.id, message.id);
  expect(confirmation).toContain("ローカルDB");
  expect(confirmation).toContain("復元できません");
  expect(args).toEqual(["offline-account", chat.id, message.id]);
  expect(useStore.getState().messages).toEqual([otherChat, otherMessage]);
});

test("cancelled, failed and stale-account deletion preserve messages", async () => {
  let calls = 0;
  let alerts = 0;
  globalThis.window = { confirm: () => false, alert: () => { alerts++; } } as unknown as Window & typeof globalThis;
  api.line.deleteRevokedMessage = async () => { calls++; return { ok: false }; };
  useStore.setState({ accountId: "offline-account", messages: [message] });
  await deleteRevokedMessageFromDevice("offline-account", chat.id, message.id);
  expect(calls).toBe(0);
  window.confirm = () => true;
  await deleteRevokedMessageFromDevice("offline-account", chat.id, message.id);
  expect(alerts).toBe(1);
  expect(useStore.getState().messages).toEqual([message]);
  await deleteRevokedMessageFromDevice("stale-account", chat.id, message.id);
  expect(calls).toBe(1);
});

test("switching accounts during deletion leaves the new account's messages intact", async () => {
  globalThis.window = { confirm: () => true, alert: () => {} } as unknown as Window & typeof globalThis;
  api.line.deleteRevokedMessage = async () => {
    useStore.setState({ accountId: "new-account", messages: [message] });
    return { ok: true };
  };
  useStore.setState({ accountId: "offline-account", messages: [message] });
  await deleteRevokedMessageFromDevice("offline-account", chat.id, message.id);
  expect(useStore.getState().accountId).toBe("new-account");
  expect(useStore.getState().messages).toEqual([message]);
});
