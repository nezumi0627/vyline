import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";

type AgentAction = { label: string; prompt: (source: string) => string };

const ACTIONS: AgentAction[] = [
  {
    label: "文章を校正",
    prompt: (s) =>
      `次の文章を校正してください。誤字脱字を直し、自然な日本語にしてください。修正後の本文だけ返してください。\n\n${s}`,
  },
  {
    label: "丁寧にする",
    prompt: (s) =>
      `次の文章を丁寧で感じのよい表現に直してください。本文だけ返してください。\n\n${s}`,
  },
  {
    label: "カジュアルにする",
    prompt: (s) =>
      `次の文章を親しい相手向けの自然な表現に直してください。本文だけ返してください。\n\n${s}`,
  },
  {
    label: "英語に翻訳",
    prompt: (s) => `次の文章を自然な英語に翻訳してください。翻訳結果だけ返してください。\n\n${s}`,
  },
  {
    label: "Flexを生成",
    prompt: (s) =>
      `次の要件のLINE Flex Message JSONを生成してください。JSONだけ返してください。\n\n${s}`,
  },
  {
    label: "テーマ案を生成",
    prompt: (s) =>
      `次の要望に合うVyThemeのCSS変数案を生成してください。コードブロックで返してください。\n\n${s}`,
  },
  {
    label: "プラグイン案を生成",
    prompt: (s) =>
      `次の要望をVyline plugin-sdk向けTypeScriptプラグインとして実装してください。コードと短い使い方を返してください。\n\n${s}`,
  },
];

export function AgentIBetaPanel() {
  const accountId = useStore((state) => state.accountId);
  const chats = useStore((state) => state.chats);
  const messages = useStore((state) => state.messages);
  const setDraft = useStore((state) => state.setDraft);
  const sendMessage = useStore((state) => state.sendMessage);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [chatId, setChatId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedChatName = useMemo(
    () => chats.find((chat) => chat.id === chatId)?.name ?? "",
    [chats, chatId],
  );

  const sourceForChat = (id: string) =>
    messages
      .filter((message) => message.chatId === id && message.text?.trim())
      .slice(-40)
      .map((message) => message.text!.trim().slice(0, 800))
      .join("\n");

  const ask = async (text: string) => {
    if (!accountId || !text.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.agentI.chat(accountId, text.trim());
      if (!response.ok || !response.text)
        throw new Error(response.error ?? "回答を返しませんでした");
      setResult(response.text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent Iへの問い合わせに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const summarize = () => {
    const transcript = sourceForChat(chatId);
    if (!chatId || !transcript) return setError("要約できるテキストメッセージがありません");
    void ask(
      `次の「${selectedChatName}」の会話を日本語で5行以内に要約してください。重要な決定とTODOを含めてください。\n\n${transcript}`,
    );
  };

  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">Agent I AIアシスタント</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
        質問、文章校正、翻訳、トーク要約、Flex・テーマ・プラグイン案の生成に使えます。
      </p>
      <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        入力内容と明示的に選択したトーク本文は、回答生成のためYahooのAgent
        Iへ送信されます。LINEへ自動送信はしません。
      </div>
      <div className="mt-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={4000}
          placeholder="質問や文章を入力…"
          className="min-h-24 w-full resize-y rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={!prompt.trim() || loading}
              onClick={() => void ask(action.prompt(prompt))}
              className="rounded-full border border-[var(--vy-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            disabled={!prompt.trim() || loading}
            onClick={() => void ask(prompt)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
            style={{ background: "var(--vy-accent)" }}
          >
            {loading ? "回答中…" : "質問する"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            className="min-w-48 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-2 py-2 text-xs"
          >
            <option value="">要約するトークを選択</option>
            {chats.map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!chatId || loading}
            onClick={summarize}
            className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs disabled:opacity-50"
          >
            トークを要約
          </button>
          {result && chatId && (
            <>
              <button
                type="button"
                onClick={() => setDraft(chatId, result)}
                className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs"
              >
                下書きに挿入
              </button>
              <button
                type="button"
                onClick={() => void sendMessage(chatId, result)}
                className="rounded-lg border border-red-400/50 px-3 py-2 text-xs text-red-300"
              >
                この内容を送信
              </button>
            </>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        {result && (
          <div className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--vy-surface-2)] p-3 text-sm leading-relaxed">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
