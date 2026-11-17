import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  IconBell,
  IconChat,
  IconMore,
  IconPaperclip,
  IconPhone,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconSmile,
  IconVideo,
} from "@/components/icons";

type Conversation = {
  id: string;
  name: string;
  avatar: string;
  tone: string;
  preview: string;
  time: string;
  unread?: number;
  group?: boolean;
  online?: boolean;
};

type PreviewMessage = {
  id: number;
  author: string;
  avatar: string;
  tone: string;
  text: string;
  time: string;
  own?: boolean;
};

const conversations: Conversation[] = [
  {
    id: "creative",
    name: "クリエイティブチーム",
    avatar: "C",
    tone: "lime",
    preview: "新しい画面、すごくいい感じ！",
    time: "14:32",
    unread: 2,
    group: true,
  },
  {
    id: "mio",
    name: "みお",
    avatar: "み",
    tone: "violet",
    preview: "週末のカフェ、ここにしない？",
    time: "13:18",
    online: true,
  },
  {
    id: "haru",
    name: "田中 遥",
    avatar: "遥",
    tone: "blue",
    preview: "ファイルを送信しました",
    time: "昨日",
  },
  {
    id: "product",
    name: "プロダクト相談室",
    avatar: "P",
    tone: "coral",
    preview: "次回のレビューは木曜日です",
    time: "昨日",
    group: true,
  },
  {
    id: "updates",
    name: "Vyline Updates",
    avatar: "V",
    tone: "mint",
    preview: "バージョン 1.2.3 を公開しました",
    time: "月曜",
  },
  {
    id: "sora",
    name: "そら",
    avatar: "そ",
    tone: "pink",
    preview: "ありがとう！また連絡するね",
    time: "日曜",
  },
];

const startingMessages: Record<string, PreviewMessage[]> = {
  creative: [
    {
      id: 1,
      author: "みお",
      avatar: "み",
      tone: "violet",
      text: "おつかれさま！チャットの新しいデザイン、見せてもらえる？",
      time: "14:26",
    },
    {
      id: 2,
      author: "あなた",
      avatar: "K",
      tone: "lime",
      text: "もちろん。会話に集中できるように、余白とコントラストから見直してみたよ。",
      time: "14:28",
      own: true,
    },
    {
      id: 3,
      author: "田中 遥",
      avatar: "遥",
      tone: "blue",
      text: "サイドバーがすっきりして、メッセージも読みやすいね。検索もすぐ使えそう。",
      time: "14:30",
    },
    {
      id: 4,
      author: "あなた",
      avatar: "K",
      tone: "lime",
      text: "ありがとう！一覧と会話の切り替えも、ここで試せるようにしてある。",
      time: "14:31",
      own: true,
    },
    {
      id: 5,
      author: "みお",
      avatar: "み",
      tone: "violet",
      text: "新しい画面、すごくいい感じ！",
      time: "14:32",
    },
  ],
  mio: [
    {
      id: 6,
      author: "みお",
      avatar: "み",
      tone: "violet",
      text: "週末のカフェ、ここにしない？駅から近くて雰囲気もよさそう。",
      time: "13:16",
    },
    {
      id: 7,
      author: "あなた",
      avatar: "K",
      tone: "lime",
      text: "いいね！写真も素敵。土曜日なら午後から行けるよ。",
      time: "13:18",
      own: true,
    },
  ],
  haru: [
    {
      id: 8,
      author: "田中 遥",
      avatar: "遥",
      tone: "blue",
      text: "レビュー用のファイルをまとめました。確認できるときに見てみてください。",
      time: "昨日 18:42",
    },
  ],
  product: [
    {
      id: 9,
      author: "田中 遥",
      avatar: "遥",
      tone: "blue",
      text: "次回のレビューは木曜日です。議題をこのスレッドに追加しておきます。",
      time: "昨日 16:08",
    },
  ],
  updates: [
    {
      id: 10,
      author: "Vyline Updates",
      avatar: "V",
      tone: "mint",
      text: "バージョン 1.2.3 を公開しました。詳しい変更点はこちらから確認できます。",
      time: "月曜 09:12",
    },
  ],
  sora: [
    {
      id: 11,
      author: "そら",
      avatar: "そ",
      tone: "pink",
      text: "今日はありがとう！また近いうちに連絡するね。",
      time: "日曜 20:04",
    },
  ],
};

export function LayoutPreviewPage() {
  const [activeId, setActiveId] = useState("creative");
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "groups">("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(true);
  const [messages, setMessages] = useState(startingMessages);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => {
      const matchesQuery =
        !normalizedQuery ||
        conversation.name.toLocaleLowerCase().includes(normalizedQuery) ||
        conversation.preview.toLocaleLowerCase().includes(normalizedQuery);
      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "unread" && Boolean(conversation.unread)) ||
        (activeFilter === "groups" && Boolean(conversation.group));
      return matchesQuery && matchesFilter;
    });
  }, [activeFilter, query]);
  const activeMessages = messages[activeId] ?? [];

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const nextMessage: PreviewMessage = {
      id: Date.now(),
      author: "あなた",
      avatar: "K",
      tone: "lime",
      text,
      time: new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date()),
      own: true,
    };
    setMessages((current) => ({ ...current, [activeId]: [...(current[activeId] ?? []), nextMessage] }));
    setDraft("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <main className="layout-preview" aria-label="Vyline UI プレビュー">
      <aside className="layout-rail" aria-label="メインナビゲーション">
        <a className="layout-brand" href="#chat" aria-label="Vyline ホーム">v</a>
        <div className="layout-rail-divider" />
        <button className="layout-rail-button is-active" type="button" aria-label="チャット" title="チャット">
          <IconChat size={19} />
          <span className="layout-rail-indicator" />
        </button>
        <button className="layout-rail-button" type="button" aria-label="通話" title="通話">
          <IconPhone size={19} />
        </button>
        <button className="layout-rail-button" type="button" aria-label="連絡先" title="連絡先">
          <span className="layout-people-icon" aria-hidden="true">•••</span>
        </button>
        <div className="layout-rail-spacer" />
        <button className="layout-rail-button" type="button" aria-label="設定" title="設定">
          <IconSettings size={19} />
        </button>
        <div className="layout-avatar layout-avatar-self" aria-label="プレビューユーザー">K</div>
      </aside>

      <section className={`layout-conversations${mobileChatOpen ? " mobile-chat-open" : ""}`} aria-label="会話一覧">
        <header className="layout-list-header">
          <div>
            <p className="layout-eyebrow">YOUR SPACE</p>
            <h1>メッセージ</h1>
          </div>
          <button className="layout-icon-button layout-new-chat" type="button" aria-label="新しい会話">
            <IconPlus size={18} />
          </button>
        </header>

        <label className="layout-search">
          <IconSearch size={17} />
          <input
            aria-label="会話を検索"
            placeholder="会話を検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>

        <div className="layout-filter-row" role="tablist" aria-label="会話の絞り込み">
          {([
            ["all", "すべて"],
            ["unread", "未読"],
            ["groups", "グループ"],
          ] as const).map(([filter, label]) => (
            <button
              key={filter}
              className={`layout-filter${activeFilter === filter ? " is-selected" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeFilter === filter}
              onClick={() => setActiveFilter(filter)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="layout-list-scroll">
          <p className="layout-section-label">最近の会話 <span>{visibleConversations.length.toString().padStart(2, "0")}</span></p>
          {visibleConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`layout-conversation${activeId === conversation.id ? " is-selected" : ""}`}
              aria-current={activeId === conversation.id ? "true" : undefined}
              onClick={() => {
                setActiveId(conversation.id);
                setMobileChatOpen(true);
              }}
            >
              <span className={`layout-avatar avatar-${conversation.tone}`}>
                {conversation.avatar}
                {conversation.online && <span className="layout-online-dot" />}
              </span>
              <span className="layout-conversation-copy">
                <span className="layout-conversation-topline">
                  <span className="layout-conversation-name">{conversation.name}</span>
                  <time>{conversation.time}</time>
                </span>
                <span className="layout-conversation-bottomline">
                  <span className="layout-conversation-preview">{conversation.preview}</span>
                  {conversation.unread ? <span className="layout-unread-count">{conversation.unread}</span> : null}
                </span>
              </span>
            </button>
          ))}
          {visibleConversations.length === 0 && (
            <p className="layout-no-results">一致する会話はありません</p>
          )}
        </div>

        <footer className="layout-list-footer">
          <span className="layout-sync-dot" />
          <span>すべて同期済み</span>
          <span className="layout-footer-divider" />
          <button type="button">ヘルプ</button>
        </footer>
      </section>

      <section className={`layout-chat${mobileChatOpen ? " mobile-chat-open" : ""}`} aria-label={`${activeConversation.name}との会話`}>
        <header className="layout-chat-header">
          <button
            className="layout-back-button"
            type="button"
            aria-label="会話一覧に戻る"
            onClick={() => setMobileChatOpen(false)}
          >
            ←
          </button>
          <span className={`layout-avatar layout-header-avatar avatar-${activeConversation.tone}`}>
            {activeConversation.avatar}
          </span>
          <div className="layout-chat-title">
            <h2>{activeConversation.name}</h2>
            <p>{activeConversation.group ? "メンバー 8人 · " : ""}{activeConversation.online ? "オンライン" : "前回の会話"}</p>
          </div>
          <div className="layout-chat-actions">
            <button className="layout-icon-button" type="button" aria-label="音声通話"><IconPhone size={18} /></button>
            <button className="layout-icon-button" type="button" aria-label="ビデオ通話"><IconVideo size={18} /></button>
            <span className="layout-action-divider" />
            <button className="layout-icon-button" type="button" aria-label="通知設定"><IconBell size={18} /></button>
            <button className="layout-icon-button" type="button" aria-label="その他の操作"><IconMore size={19} /></button>
          </div>
        </header>

        <div className="layout-chat-context">
          <span className="layout-context-mark" aria-hidden="true">✦</span>
          <span>ここはUI確認用のプレビューです。表示内容はすべてサンプルです。</span>
          <button type="button" aria-label="プレビュー案内を閉じる">×</button>
        </div>

        <div className="layout-message-scroll" aria-live="polite">
          <div className="layout-day-divider"><span>今日</span></div>
          {activeMessages.map((message) => (
            <article key={message.id} className={`layout-message-row${message.own ? " is-own" : ""}`}>
              {!message.own && <span className={`layout-avatar layout-message-avatar avatar-${message.tone}`}>{message.avatar}</span>}
              <div className="layout-message-content">
                {!message.own && <span className="layout-message-author">{message.author}</span>}
                <div className="layout-message-line">
                  <div className="layout-bubble">{message.text}</div>
                  <time className="layout-message-time">{message.time}</time>
                </div>
                {message.own && <span className="layout-read-status">既読</span>}
              </div>
            </article>
          ))}
        </div>

        <form className="layout-composer" onSubmit={sendMessage}>
          <div className="layout-composer-toolbar">
            <button className="layout-icon-button" type="button" aria-label="添付"><IconPaperclip size={18} /></button>
            <button className="layout-icon-button" type="button" aria-label="スタンプ"><span className="layout-sticker-icon" aria-hidden="true">▧</span></button>
            <button className="layout-icon-button" type="button" aria-label="絵文字"><IconSmile size={18} /></button>
            <span className="layout-composer-hint">Enterで送信 · Shift + Enterで改行</span>
          </div>
          <div className="layout-composer-input-row">
            <textarea
              aria-label="メッセージを入力"
              placeholder={`${activeConversation.name} にメッセージを送信`}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button className="layout-send-button" type="submit" disabled={!draft.trim()} aria-label="メッセージを送信">
              <IconSend size={18} />
            </button>
          </div>
        </form>
        <div className="layout-demo-badge"><span />PREVIEW · SAMPLE DATA</div>
      </section>
    </main>
  );
}
