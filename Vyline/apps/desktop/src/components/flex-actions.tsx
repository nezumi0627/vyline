import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { hideBrokenMedia } from "@/utils/lineMedia";

type Detected =
  | { type: "schedule"; eventKey: string }
  | { type: "poll"; questionId: string }
  | { type: "ladder"; hash: string }
  | null;

function detectFlexType(json: unknown): Detected {
  const s = typeof json === "string" ? json : JSON.stringify(json ?? {});
  // スケジュール: 予定を確認 / 予定を作成しました + calendar/event/{key} または event/detail/{key}
  const evt = /calendar\/event\/([A-Za-z0-9_-]+)/.exec(s);
  if (evt) return { type: "schedule", eventKey: evt[1] };
  const detail = /event\/detail\/([A-Za-z0-9_-]+)/.exec(s);
  if (detail) return { type: "schedule", eventKey: detail[1] };
  if (s.includes("予定を作成しました") || s.includes("日程を回答してください")) {
    const key =
      /calendar\/event\/([A-Za-z0-9_-]+)/.exec(s)?.[1] ??
      /event\/detail\/([A-Za-z0-9_-]+)/.exec(s)?.[1];
    if (key) return { type: "schedule", eventKey: key };
  }
  // アンケート: 投票 / view/{questionId}
  const pollView = /view\/(\d+)/.exec(s);
  if (pollView) return { type: "poll", questionId: pollView[1] };
  if (s.includes("[投票") || s.includes("投票する")) {
    const qid = /view\/(\d+)/.exec(s)?.[1];
    if (qid) return { type: "poll", questionId: qid };
  }
  // あみだくじ: hash=...
  const ladder = /hash=([A-Za-z0-9]+)/.exec(s);
  if (ladder && s.includes("あみだくじ")) {
    return { type: "ladder", hash: ladder[1] };
  }
  return null;
}

const statusLabel: Record<string, string> = { YES: "参加", MAYBE: "未定", NO: "不参加" };

export function FlexActions({ flexJson, chatId }: { flexJson: unknown; chatId: string }) {
  const accountId = useStore((s) => s.accountId);
  const detected = useMemo(() => detectFlexType(flexJson), [flexJson]);
  const [open, setOpen] = useState(false);
  if (!detected || !accountId) return null;

  const label =
    detected.type === "schedule"
      ? "回答する"
      : detected.type === "poll"
        ? "投票する"
        : "結果を見る";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-1.5 text-xs font-semibold text-[var(--vy-text)] hover:bg-[var(--vy-surface)]"
      >
        {label}
      </button>
      {open && accountId && (
        <ActionModal
          detected={detected}
          accountId={accountId}
          chatId={chatId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ActionModal({
  detected,
  accountId,
  chatId,
  onClose,
}: {
  detected: Exclude<Detected, null>;
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {detected.type === "schedule" && (
          <ScheduleAnswer
            accountId={accountId}
            chatId={chatId}
            eventKey={detected.eventKey}
            onClose={onClose}
          />
        )}
        {detected.type === "poll" && (
          <PollVote
            accountId={accountId}
            chatId={chatId}
            questionId={detected.questionId}
            onClose={onClose}
          />
        )}
        {detected.type === "ladder" && (
          <LadderResult
            accountId={accountId}
            chatId={chatId}
            hash={detected.hash}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[var(--vy-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--vy-text)]">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3 text-sm text-[var(--vy-text)]">{children}</div>
    </>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>;
}

// ── スケジュール回答 ────────────────────────────────────────

function ScheduleAnswer({
  accountId,
  chatId,
  eventKey,
  onClose,
}: {
  accountId: string;
  chatId: string;
  eventKey: string;
  onClose: () => void;
}) {
  const [event, setEvent] = useState<{
    name?: string;
    candidates?: number[];
    myStatus?: Record<string, string>;
  } | null>(null);
  const [status, setStatus] = useState<Record<number, string>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMemo(() => {
    void api.line.schedule.event(accountId, chatId, eventKey).then((res) => {
      if (!res.ok || !res.data) return;
      const d = res.data as {
        name?: string;
        candidates?: Array<number | { epochSeconds?: number; label?: string }>;
      };
      const candidates = (d.candidates ?? []).map((c) =>
        typeof c === "number" ? c : (c.epochSeconds ?? 0),
      );
      setEvent({ name: d.name, candidates });
      const st: Record<number, string> = {};
      for (const c of candidates) {
        if (c) st[c] = "YES";
      }
      setStatus(st);
    });
  }, [accountId, chatId, eventKey]);

  const answer = async () => {
    setBusy(true);
    setError(null);
    try {
      const answers = Object.entries(status)
        .map(([c, v]) => ({
          candidate: Number(c),
          status: v ?? "MAYBE",
        }))
        .filter((a) => Number.isFinite(a.candidate) && a.candidate > 0);
      const res = await api.line.schedule.answer(accountId, chatId, eventKey, answers, comment);
      if (!res.ok) throw new Error((res as { error?: string }).error || "回答に失敗しました");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "回答に失敗しました");
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`回答: ${event?.name ?? "イベント"}`} onClose={onClose}>
      <ErrorText error={error} />
      {!event ? (
        <p className="py-4 text-center text-xs text-[var(--vy-text-dim)]">読み込み中…</p>
      ) : (
        <>
          <div className="mb-3 space-y-2">
            {(event.candidates ?? []).map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-[var(--vy-surface-2)] px-3 py-2"
              >
                <span>{new Date(c * 1000).toLocaleString("ja-JP")}</span>
                <select
                  value={status[c] ?? "NO"}
                  onChange={(e) => setStatus((p) => ({ ...p, [c]: e.target.value }))}
                  className="rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] px-2 py-1 text-xs"
                >
                  {Object.entries(statusLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <input
            className="mb-3 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-1.5 text-sm"
            placeholder="コメント（任意）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={answer}
            className="w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          >
            {busy ? "回答中…" : "回答する"}
          </button>
        </>
      )}
    </ModalShell>
  );
}

// ── アンケート投票 ─────────────────────────────────────────

function PollVote({
  accountId,
  chatId,
  questionId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  questionId: string;
  onClose: () => void;
}) {
  const [poll, setPoll] = useState<{
    title?: string;
    choiceList?: { oid?: string; text?: string }[];
    alreadyVoted?: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMemo(() => {
    void api.line.poll.question(accountId, chatId, questionId).then((res) => {
      if (!res.ok || !res.data) return;
      const d = res.data as {
        question?: { title?: string; choiceList?: { oid?: string; text?: string }[] };
      };
      const q = (d.question ?? d) as {
        title?: string;
        choiceList?: { oid?: string; text?: string }[];
      };
      setPoll({ title: q.title, choiceList: q.choiceList });
    });
  }, [accountId, chatId, questionId]);

  const vote = async () => {
    if (selected.length === 0) return setError("選択肢を選んでください");
    setBusy(true);
    setError(null);
    try {
      const res = await api.line.poll.vote(accountId, chatId, questionId, selected);
      if (!res.ok) throw new Error("投票に失敗しました");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "投票に失敗しました");
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`投票: ${poll?.title ?? "アンケート"}`} onClose={onClose}>
      <ErrorText error={error} />
      {!poll ? (
        <p className="py-4 text-center text-xs text-[var(--vy-text-dim)]">読み込み中…</p>
      ) : (
        <>
          <div className="mb-3 space-y-1">
            {(poll.choiceList ?? []).map((c, i) => (
              <label
                key={i}
                className="flex items-center gap-2 rounded-lg bg-[var(--vy-surface-2)] px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.oid ?? "")}
                  onChange={(e) =>
                    setSelected((p) =>
                      e.target.checked ? [...p, c.oid ?? ""] : p.filter((x) => x !== c.oid),
                    )
                  }
                />
                <span>{c.text}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={vote}
            className="w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          >
            {busy ? "投票中…" : "投票する"}
          </button>
        </>
      )}
    </ModalShell>
  );
}

// ── あみだくじ結果 ─────────────────────────────────────────

type LadderResultItem = {
  start: string;
  end: string;
  displayName: string;
  pictureUrl: string;
  isCurrentUser: boolean;
};

type LadderResultData = {
  personalPath: LadderResultItem[];
};

/** end が空文字なら「X」(結果なし) として表示する */
function resolveEnd(end: string): string {
  return end || "X";
}

function LadderResult({
  accountId,
  chatId,
  hash,
  onClose,
}: {
  accountId: string;
  chatId: string;
  hash: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<LadderResultData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useStore((s) => s.chats.find((c) => c.id === chatId)?.members ?? []);

  useMemo(() => {
    void api.line.ladder.result(accountId, chatId, hash).then((res) => {
      if (!res.ok || !res.data) return;
      setResult((res.data as LadderResultData) ?? null);
    });
  }, [accountId, chatId, hash]);

  const nameOf = (mid: string) => members.find((m) => m.id === mid)?.name ?? mid;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.line.ladder.message(accountId, chatId, hash);
      if (!res.ok) throw new Error("送信に失敗しました");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
      setBusy(false);
    }
  };

  return (
    <ModalShell title="あみだくじの結果" onClose={onClose}>
      <ErrorText error={error} />
      {!result ? (
        <p className="py-4 text-center text-xs text-[var(--vy-text-dim)]">読み込み中…</p>
      ) : (
        <>
          <div className="mb-3 space-y-1">
            {(result.personalPath ?? []).map((p, i) => {
              const isMe = p.isCurrentUser;
              const resultText = resolveEnd(p.end);
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                    isMe
                      ? "bg-[var(--vy-accent)]/10 ring-1 ring-[var(--vy-accent)]"
                      : "bg-[var(--vy-surface-2)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {p.pictureUrl ? (
                      <img
                        src={p.pictureUrl}
                        alt=""
                        onError={hideBrokenMedia}
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : null}
                    <span className="font-medium">{p.displayName || nameOf(p.start)}</span>
                    {isMe && (
                      <span className="rounded bg-[var(--vy-accent)]/20 px-1.5 py-0.5 text-xs font-semibold text-[var(--vy-accent-contrast)]">
                        自分
                      </span>
                    )}
                  </div>
                  <span className="font-semibold text-[var(--vy-accent)]">{resultText}</span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={send}
            className="w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          >
            {busy ? "送信中…" : "結果を送信"}
          </button>
        </>
      )}
    </ModalShell>
  );
}
