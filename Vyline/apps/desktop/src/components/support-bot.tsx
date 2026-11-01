import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { IconChat, IconSend, IconSpark } from "@/components/icons";
import { useStore } from "@/lib/store";
import { buildSupportPrompt, SUPPORT_CATEGORIES, type SupportCategory } from "./supportWorkflow";

type Turn = { role: "user" | "assistant"; text: string };

export function SupportBot() {
  const accountId = useStore((state) => state.accountId);
  const accountGeneration = useRef(0);
  const [category, setCategory] = useState<SupportCategory>("other");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [steps, setSteps] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [authMode, setAuthMode] = useState<"anonymous" | "authenticated">("anonymous");
  const [cookie, setCookie] = useState("");
  const [cookieConfigured, setCookieConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    accountGeneration.current += 1;
    let cancelled = false;
    setTurns([]);
    setAuthMode("anonymous");
    setCookie("");
    setCookieConfigured(false);
    setBusy(false);
    setError("");
    if (!accountId)
      return () => {
        cancelled = true;
        accountGeneration.current += 1;
      };
    void api.agentI
      .credentialStatus(accountId)
      .then((result) => {
        if (!cancelled && result.ok) setCookieConfigured(result.yahooCookieConfigured === true);
      })
      .catch(() => {
        if (!cancelled) setCookieConfigured(false);
      });
    return () => {
      cancelled = true;
      accountGeneration.current += 1;
    };
  }, [accountId]);

  const send = async () => {
    if (!accountId || !question.trim() || busy) return;
    if (authMode === "authenticated" && !cookieConfigured) {
      setError("ログイン済みモードを使うには、Yahoo Cookieを一時登録してください");
      return;
    }
    const generation = accountGeneration.current;
    const reportPrompt = buildSupportPrompt({ category, title, details, steps });
    const text = `${reportPrompt}\n\n追加の質問\n${question.trim()}`;
    if (text.length > 4_000) {
      setError("相談内容が長すぎます。症状や再現手順を短くしてください。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.agentI.chat(accountId, text, turns, authMode);
      if (!response.ok || !response.text)
        throw new Error(response.error ?? "回答を受け取れませんでした");
      if (generation !== accountGeneration.current) return;
      setTurns((items) => [
        ...items,
        { role: "user", text: question.trim() },
        { role: "assistant", text: response.text! },
      ]);
      setQuestion("");
    } catch (cause) {
      if (generation !== accountGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Botへの送信に失敗しました");
    } finally {
      if (generation === accountGeneration.current) setBusy(false);
    }
  };

  const registerCookie = async () => {
    if (!accountId || !cookie.trim()) return;
    const generation = accountGeneration.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.agentI.setYahooCookie(accountId, cookie.trim());
      if (!result.ok) throw new Error(result.error ?? "Cookieを登録できませんでした");
      if (generation !== accountGeneration.current) return;
      setCookieConfigured(true);
      setCookie("");
    } catch (cause) {
      if (generation !== accountGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Cookieを登録できませんでした");
    } finally {
      if (generation === accountGeneration.current) setBusy(false);
    }
  };

  const clearCookie = async () => {
    if (!accountId) return;
    const generation = accountGeneration.current;
    setBusy(true);
    try {
      await api.agentI.clearYahooCookie(accountId);
      if (generation !== accountGeneration.current) return;
      setCookieConfigured(false);
      setAuthMode("anonymous");
    } catch (cause) {
      if (generation !== accountGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Cookieを削除できませんでした");
    } finally {
      if (generation === accountGeneration.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--vy-border)] pb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <IconSpark size={17} />
            Agent I サポートBot
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--vy-text-dim)]">
            症状と再現手順をもとに、原因の切り分けと次の確認方法を案内します。実行や設定変更は行いません。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTurns([])}
          disabled={!turns.length || busy}
          className="text-xs text-[var(--vy-text-dim)] underline underline-offset-4 disabled:opacity-40"
        >
          相談をリセット
        </button>
      </div>

      <div className="grid min-w-0 gap-5">
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <label className="block text-xs font-semibold">
            相談カテゴリ
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as SupportCategory)}
              className="mt-1.5 block w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm"
            >
              {Object.entries(SUPPORT_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold">
            何に困っていますか？
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="例：起動するたびにログインを求められる"
              className="mt-1.5 block w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm"
            />
          </label>
          <label className="block min-w-0 text-xs font-semibold">
            起きていること
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={1500}
              rows={4}
              placeholder="いつから、どの画面で、何をすると起きるかを書いてください"
              className="mt-1.5 block w-full resize-y rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm leading-relaxed"
            />
          </label>
          <label className="block min-w-0 text-xs font-semibold">
            再現手順（任意）
            <textarea
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="1. 設定を開く&#10;2. …"
              className="mt-1.5 block w-full resize-y rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm leading-relaxed"
            />
          </label>
        </div>

        <section
          aria-label="Botとの相談履歴"
          className="flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 sm:p-4"
        >
          <div className="flex items-center gap-2 border-b border-[var(--vy-border)] pb-3 text-xs font-semibold">
            <IconChat size={16} />
            相談履歴
          </div>
          <div
            className="vy-scroll flex max-h-[min(52dvh,640px)] min-h-[220px] flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto py-3"
            aria-live="polite"
          >
            {!turns.length && (
              <p className="py-8 text-center text-xs leading-relaxed text-[var(--vy-text-dim)]">
                相談内容を入力して送信すると、ここに回答が表示されます。
              </p>
            )}
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={`w-fit min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg px-3 py-2.5 text-sm leading-relaxed ${turn.role === "assistant" ? "border border-[var(--vy-border)] bg-[var(--vy-surface)]" : "ml-auto bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]"}`}
              >
                <p className="mb-1 text-[10px] font-semibold opacity-70">
                  {turn.role === "assistant" ? "Agent I" : "あなた"}
                </p>
                {turn.text}
              </div>
            ))}
            {busy && (
              <p role="status" className="text-xs text-[var(--vy-text-dim)]">
                回答を確認しています…
              </p>
            )}
          </div>
          <label className="block border-t border-[var(--vy-border)] pt-3 text-xs font-semibold">
            質問・追加情報
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send();
              }}
              maxLength={1200}
              rows={3}
              placeholder="まずは症状を入力してください。Ctrl+Enterで送信"
              className="mt-1.5 block w-full resize-y rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm font-normal leading-relaxed"
            />
          </label>
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !question.trim()}
            className="mt-2 inline-flex items-center justify-center gap-2 self-end rounded-lg px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-45"
            style={{ background: "var(--vy-accent)" }}
          >
            <IconSend size={15} />
            {busy ? "送信中…" : "Botに相談"}
          </button>
        </section>
      </div>

      <details className="border-t border-[var(--vy-border)] pt-3">
        <summary className="cursor-pointer text-xs font-medium">接続方法とプライバシー</summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed text-[var(--vy-text-dim)]">
          <p>
            相談文と入力内容は回答生成のためYahooのAgent
            Iへ送信されます。チャット履歴、画像、診断ZIPはBotへ送信しません。Yahoo Web
            APIの匿名／ログイン別上限は未公開です。
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="接続モード">
            <button
              type="button"
              onClick={() => setAuthMode("anonymous")}
              aria-pressed={authMode === "anonymous"}
              className={`rounded-lg border px-3 py-1.5 ${authMode === "anonymous" ? "border-[var(--vy-accent)] text-[var(--vy-text)]" : "border-[var(--vy-border)]"}`}
            >
              匿名
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("authenticated")}
              aria-pressed={authMode === "authenticated"}
              className={`rounded-lg border px-3 py-1.5 ${authMode === "authenticated" ? "border-[var(--vy-accent)] text-[var(--vy-text)]" : "border-[var(--vy-border)]"}`}
            >
              Yahooログイン済み
            </button>
            <span className="self-center">
              {cookieConfigured ? "Cookie登録済み（この起動中のみ）" : "匿名接続"}
            </span>
          </div>
          {authMode === "authenticated" && (
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={cookie}
                onChange={(event) => setCookie(event.target.value)}
                aria-label="Yahoo認証Cookie"
                placeholder="Yahoo認証Cookie"
                className="min-w-0 flex-1 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2"
              />
              <button
                type="button"
                disabled={busy || !cookie.trim()}
                onClick={() => void registerCookie()}
                className="rounded-lg border border-[var(--vy-border)] px-3 py-2 disabled:opacity-40"
              >
                一時登録
              </button>
              {cookieConfigured && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearCookie()}
                  className="rounded-lg border border-[var(--vy-border)] px-3 py-2"
                >
                  削除
                </button>
              )}
            </div>
          )}
          <p>
            Cookieはバックエンドのメモリに一時保持し、再起動で消去します。VylineのLINE認証情報とは別です。入力欄にメッセージ本文やパスワード、tokenを貼らないでください。
          </p>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-[var(--vy-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
