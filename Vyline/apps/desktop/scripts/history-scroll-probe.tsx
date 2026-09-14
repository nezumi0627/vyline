// Isolated browser fixture: real chat/virtual list, deferred local data, no LINE account.
import { createRoot } from "react-dom/client";
import { ChatArea } from "../src/components/chat-area";
import { useStore, type Message } from "../src/lib/store";
import { emitAppEvent, onAppEvent } from "../src/lib/appEvents";
import "../src/index.css";
import "../src/ui/design-system.css";

const chatId = "history-scroll-fixture";
const message = (index: number): Message => ({
  id: String(1000 + index),
  chatId,
  authorId: "peer",
  kind: "text",
  text: `履歴 ${index}\n${"読み込み中のスクロール確認。".repeat(1 + (Math.abs(index) % 5))}`,
  createdAt: 1_789_344_000_000 + index * 1000,
  status: "read",
  read: true,
  messageState: "normal",
});

let finishSync = () => {};
let historyPending = false;
let nextOlder = 0;
let nextLatest = 180;
useStore.setState({
  accountId: null,
  demoMode: false,
  activeChatId: chatId,
  chats: [
    {
      id: chatId,
      type: "friend",
      name: "履歴スクロール検証",
      avatar: "T",
      color: "#aaa",
      status: "",
      unread: 0,
    },
  ],
  messages: Array.from({ length: 180 }, (_, index) => message(index)),
  refreshMessages: async (_chatId, options) => {
    if (!options?.force) return;
    await new Promise<void>((resolve) => {
      finishSync = () => {
        useStore.setState((state) => ({ messages: [...state.messages, message(nextLatest++)] }));
        finishSync = () => {};
        resolve();
      };
    });
  },
  markChatRead: async () => {},
});

onAppEvent("history:load-older", () => {
  historyPending = true;
  emitAppEvent("history:state", { chatMid: chatId, hasMore: true, loading: true });
});

function finishHistory() {
  if (!historyPending) throw new Error("Expected a pending history request");
  historyPending = false;
  const older = Array.from({ length: 40 }, (_, index) => message(nextOlder - 40 + index));
  nextOlder -= 40;
  useStore.setState((state) => ({ messages: [...older, ...state.messages] }));
  emitAppEvent("history:state", { chatMid: chatId, hasMore: true, loading: false });
}

function resizeHistory() {
  // An overscanned row above the viewport grows after its content arrives.
  useStore.setState((state) => ({
    messages: state.messages.map((entry) =>
      entry.id === "1001"
        ? { ...entry, text: `${entry.text}\n${"追加の履歴内容。\n".repeat(40)}` }
        : entry,
    ),
  }));
}

createRoot(document.getElementById("root")!).render(
  <div className="flex flex-col" style={{ height: "100vh" }}>
    <div className="flex shrink-0 gap-4 p-2">
      <button type="button" onClick={() => finishSync()}>
        Finish sync
      </button>
      <button type="button" onClick={finishHistory}>
        Finish history
      </button>
      <button type="button" onClick={resizeHistory}>
        Resize history
      </button>
    </div>
    <div className="min-h-0 flex-1">
      <ChatArea />
    </div>
  </div>,
);
