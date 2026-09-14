import { expect, test } from "bun:test";
import type { Chat, Message } from "@/lib/store-types";
import { createKmpMessageProjector, messageDelta, panePatches } from "./kmp-model";
import type { KmpPaneSnapshot } from "./compose-contract";
import { buildPreviewMap, filterChatList } from "@/lib/chatListPresentation";

const chat: Chat = {
  id: "group",
  type: "group",
  name: "チーム",
  avatar: "T",
  color: "#007aff",
  status: "2人",
  unread: 1,
  members: [{ id: "member", name: "あおい", avatar: "A", color: "#d00000" }],
};
const message = (id: string, extra: Partial<Message> = {}): Message => ({
  id,
  chatId: chat.id,
  authorId: "member",
  kind: "text",
  text: `本文${id}`,
  createdAt: 100,
  status: "sent",
  read: false,
  messageState: "normal",
  ...extra,
});
const projectKmpMessages = createKmpMessageProjector();

test("call events use native centered presentation without losing duration or joining", () => {
  const calls = createKmpMessageProjector()([
    message("started", { kind: "call", callMeta: { group: true, video: true, outcome: "started" } }),
    message("ended", { kind: "call", authorId: "me", callMeta: { group: false, video: false, outcome: "ended", durationSec: 65 } }),
  ], chat, false);
  expect(calls.find((call) => call.id === "started")).toMatchObject({ hostContent: false, text: "グループビデオ通話が開始されました", callVideo: true, callJoin: true });
  expect(calls.find((call) => call.id === "ended")).toMatchObject({ hostContent: false, callDetail: "通話時間 1分05秒" });
});

test("message actions expose only supported retries and current reaction eligibility", () => {
  const project = createKmpMessageProjector();
  const current = message("current", { createdAt: Date.now() });
  const retry = { kind: "text" as const, text: "再送" };
  const source = [
    current,
    message("expired", { createdAt: Date.now() - 15 * 86400000 }),
    { ...current, id: "pending_1" },
    { ...current, id: "sending", status: "sending" as const },
    { ...current, id: "revoked", messageState: "revoked-by-other" as const },
    { ...current, id: "failed", authorId: "me", status: "failed" as const },
    { ...current, id: "retry", authorId: "me", status: "failed" as const, retry },
  ];
  const result = project(source, chat, false);
  expect(result.filter((entry) => entry.canReact).map((entry) => entry.id)).toEqual(["current"]);
  expect(result.filter((entry) => entry.canRetry).map((entry) => entry.id)).toEqual(["retry"]);
  expect(
    project(source, { ...chat, isOfficial: true }, false).some((entry) => entry.canReact),
  ).toBe(false);
  expect(
    project([{ ...current, reactions: [{ type: 3, fromMid: "", atMillis: 1 }] }], chat, false)[0]
      ?.reactions[0]?.selected,
  ).toBe(true);
});

test("pane patches keep other chat histories out of keystrokes and incoming deltas", () => {
  const composer = {
    text: "",
    pending: [],
    recording: false,
    recordingSeconds: 0,
    sending: false,
    enterToSend: true,
    voiceEnabled: true,
    mute: false,
  };
  const first: KmpPaneSnapshot = {
    id: "first",
    chat: null,
    composer,
    messages: projectKmpMessages([message("1")], chat, false),
  };
  const second: KmpPaneSnapshot = { ...first, id: "second" };
  expect(
    panePatches([first, second], [{ ...first, composer: { ...composer, text: "draft" } }, second]),
  ).toEqual({ first: { composer: { ...composer, text: "draft" } } });
  const updated = { ...second, messages: [{ ...second.messages[0]!, readCount: 2 }] };
  expect(panePatches([first, second], [first, updated])).toEqual({
    second: { messageDelta: { updates: updated.messages } },
  });
  expect(panePatches([first, second], [first, second])).toEqual({});
});

test("native media selects playable URLs and reader times stay source-backed", () => {
  const source = [
    message("1", {
      kind: "video",
      imageSrc: "/api/line/account/media/chat/1?preview=1",
      readBy: ["member"],
      readByAt: { member: 500, u01234567890123456789012345678901: 900 },
    }),
    message("2", {
      kind: "sticker",
      stickerAnimated: true,
      sticker:
        "/api/cdn/line?u=https%3A%2F%2Fstickershop.line-scdn.net%2Fstickershop%2Fv1%2Fsticker%2F12%2Fandroid%2Fsticker.png",
    }),
  ];
  const [video, sticker] = createKmpMessageProjector()(source, chat, false);
  expect(video?.mediaUrl).toBe("/api/line/account/media/chat/1?preview=0");
  expect(video?.readCount).toBe(2);
  expect(video?.readers?.[0]).toEqual({ id: "member", name: "あおい", readAt: 500 });
  expect(video?.readers?.[1]?.name).not.toContain("u0123");
  expect(sticker?.mediaUrl).toContain("%2FANDROID%2Fsticker_animation.png");
  expect(sticker?.stickerAnimated).toBe(true);
});

test("native text uses the existing safe URL parser without swallowing punctuation", () => {
  const projected = createKmpMessageProjector()(
    [message("link", { text: "確認 www.example.com/path。" })],
    chat,
    false,
  );
  expect(projected[0]?.segments).toEqual([
    { type: "text", value: "確認 " },
    { type: "link", value: "www.example.com/path", url: "https://www.example.com/path" },
    { type: "text", value: "。" },
  ]);
});

test("KMP consumes the same ordered messages with reply, status, grouping and reaction semantics", () => {
  const source = [
    message("10", { authorId: "me", replyToId: "9", status: "sending" }),
    message("9", { reactions: [
      { fromMid: "self", type: 3, atMillis: 10 },
      { fromMid: "member", type: 3, atMillis: 20 },
    ] }),
  ];
  const result = projectKmpMessages(source, chat, false, "self");
  expect(result.map((entry) => entry.id)).toEqual(["9", "10"]);
  expect(result[0]).toMatchObject({
    authorName: "あおい",
    groupStart: true,
    groupEnd: true,
    reactions: [{
      type: 3,
      count: 2,
      selected: true,
      reactors: [
        { id: "self", name: "自分", atMillis: 10 },
        { id: "member", name: "あおい", atMillis: 20 },
      ],
    }],
  });
  expect(result[1]).toMatchObject({ replyText: "本文9", status: "sending", authorName: "自分" });
  expect(source.map((entry) => entry.id)).toEqual(["10", "9"]);
});

test("incoming deltas retain unchanged records, refresh grouping and encode removals", () => {
  const project = createKmpMessageProjector();
  const a = message("1");
  const b = message("2");
  const c = message("3");
  const initial = project([a, b], chat, false);
  const appended = project([a, b, c], chat, false);
  expect(appended[0]).toBe(initial[0]);
  expect(appended[1]).not.toBe(initial[1]);
  expect(messageDelta(initial, appended).updates.map((item) => item.id)).toEqual(["2", "3"]);
  expect(messageDelta(initial, appended).ids).toEqual(["1", "2", "3"]);
  expect(messageDelta(appended, [appended[0]!]).ids).toEqual(["1"]);
  expect(messageDelta(appended, appended)).toEqual({ updates: [] });
  const edited = project([a, { ...b, text: "編集後" }, c], chat, false);
  expect(messageDelta(appended, edited).updates.some((item) => item.text === "編集後")).toBe(true);
});

test("streamer and revoked views do not expose media or unresolved member identifiers", () => {
  const media = message("11", {
    kind: "image",
    imageSrc: "/private-image",
    authorId: "unknown-mid",
  });
  expect(projectKmpMessages([media], chat, true)[0]).toMatchObject({
    mediaUrl: undefined,
    authorName: "メンバー",
    avatar: "•",
  });
  expect(
    projectKmpMessages([{ ...media, messageState: "revoked-by-other" }], chat, false)[0],
  ).toMatchObject({ mediaUrl: undefined, text: "取り消されたメッセージ", authorName: "メンバー" });
});

test("both renderers share hidden/group filtering and latest-message previews", () => {
  const hidden = { ...chat, id: "hidden", hidden: true };
  expect(
    filterChatList([chat, hidden], [], "all", "", "recent", []).map((entry) => entry.id),
  ).toEqual([chat.id]);
  expect(
    filterChatList([chat, hidden], [], "hidden", "", "recent", []).map((entry) => entry.id),
  ).toEqual([hidden.id]);
  expect(buildPreviewMap([message("20", { authorId: "me" })], [chat]).get(chat.id)?.text).toBe(
    "あなた: 本文20",
  );
});

test("all specialist message cards retain their renderer while revoked cards cannot expose content", () => {
  const project = createKmpMessageProjector();
  const source = [
    message("flex", { kind: "flex" }),
    message("rich", { kind: "rich" }),
    message("album", { postNotification: { kind: "album", albumId: "album", title: "旅行" } }),
    message("note", { postNotification: { kind: "note", postId: "note" } }),
    message("unknown", { postNotification: { kind: "unknown" } }),
    message("plain"),
    message("contact", { kind: "contact" }),
    message("file", { kind: "file", file: { name: "資料.pdf", size: 12058624 } }),
    message("location", { kind: "location", location: { latitude: 35, longitude: 139 } }),
    message("emoji", { kind: "emoji" }),
    message("combination", { kind: "sticker", combinationStickerId: "combo" }),
    message("preview", { linkPreview: { url: "https://example.com", site: "Example", title: "リンク", description: "説明", thumb: "E" } }),
    message("revoked", { kind: "rich", messageState: "revoked-by-other" }),
  ];
  const result = project(source, chat, false);
  expect(result.filter((entry) => entry.hostRichContent).map((entry) => entry.id).sort()).toEqual([
    "album", "combination", "contact", "emoji", "file", "flex", "location", "note", "preview", "rich", "unknown",
  ]);
  expect(result.filter((entry) => entry.hostRichContent).every((entry) => entry.hostContent)).toBe(true);
  expect(result.find((entry) => entry.id === "revoked")).toMatchObject({
    hostContent: false, hostRichContent: false, text: "取り消されたメッセージ",
  });
  const updated = project(source.map((entry) => entry.id === "flex"
    ? { ...entry, messageState: "revoked-by-other" as const } : entry), chat, false);
  expect(messageDelta(result, updated).updates.find((entry) => entry.id === "flex"))
    .toMatchObject({ hostContent: false, hostRichContent: false });
  expect(updated.find((entry) => entry.id === "flex")?.hostRichContent).toBe(false);
});


test("incoming direct messages use the contact photo without leaking group/self photos", () => {
  const project = createKmpMessageProjector();
  const contact = { ...chat, type: "friend" as const, members: undefined, avatarUrl: "/demo/contact.svg" };
  const incoming = message("incoming");
  expect(project([incoming], contact, false)[0]?.avatarUrl).toContain(encodeURIComponent("/demo/contact.svg"));
  expect(project([incoming], { ...contact, avatarUrl: "/demo/updated.svg" }, false)[0]?.avatarUrl).toContain(encodeURIComponent("/demo/updated.svg"));
  expect(project([incoming], contact, true)[0]?.avatarUrl).toBeUndefined();
  expect(project([message("self", { authorId: "me" })], contact, false)[0]?.avatarUrl).toBeUndefined();
  expect(project([incoming], { ...contact, type: "group" }, false)[0]?.avatarUrl).toBeUndefined();
  expect(project([incoming], { ...contact, members: [{ ...chat.members![0]!, avatarUrl: "/demo/member.svg" }] }, false)[0]?.avatarUrl).toContain(encodeURIComponent("/demo/member.svg"));
});
