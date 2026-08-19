import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { mapMember } from "@/lib/mappers";
import type { Member } from "@/lib/store";
import { cn } from "@/lib/utils";
import { IconClose } from "@/components/icons";

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | "timeout"> => {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout" as const), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve("timeout" as const);
      },
    );
  });
};

const PLUS_KEYFRAMES = `
@keyframes vy-pop { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes vy-bounce-in { 0% { transform: rotate(0) scale(1); } 40% { transform: rotate(180deg) scale(1.25); } 100% { transform: rotate(225deg) scale(1); } }
`;

/** LINE の日時入力 → エポック ms（candidate 用） */
function toEpochMs(isoLocal: string): number {
  if (!isoLocal) return 0;
  const d = new Date(isoLocal);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--vy-border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--vy-text)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-sm text-[var(--vy-text)]">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-[var(--vy-text-dim)]">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-1.5 text-sm text-[var(--vy-text)] outline-none focus:border-[var(--vy-accent)]";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>;
}

// ── あみだくじ ──────────────────────────────────────────────

function LadderModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const storeMembers = chat?.members ?? [];
  // 参加者一覧はグループと同じ処理（VylineCache + バッチプロフィール）で取得する。
  // ストアの members が空/未解決の場合は専用 API で取得して安定化する。
  const [members, setMembers] = useState<Member[]>(storeMembers);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const needFetch =
      storeMembers.length === 0 || storeMembers.some((m) => /^u[0-9a-f]{32}$/i.test(m.name));
    if (!needFetch) {
      setMembers(storeMembers);
      return;
    }
    (async () => {
      setMembersLoading(true);
      try {
        const res = await withTimeout(api.line.chatMembers(accountId, chatId), 10_000);
        if (cancelled || res === "timeout" || !res.ok || !res.members?.length) return;
        const fetched = res.members.map((m) => mapMember(m.mid, m.displayName, m.thumbnailUrl));
        setMembers(fetched);
      } catch {
        /* 取得失敗はストアの members をそのまま使う */
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId, storeMembers]);

  // 作成/共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "ladder", chatId);
  }, [accountId, chatId]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const memberIds = members.map((m) => m.id);
  const selectedIds = memberIds.filter((id) => selected[id]);

  const allSelected = () => {
    const o: Record<string, boolean> = {};
    for (const m of members) o[m.id] = true;
    setSelected(o);
  };

  useEffect(() => {
    setOptions((prev) => {
      const next = [...prev];
      while (next.length > selectedIds.length) next.pop();
      while (next.length < selectedIds.length) next.push("");
      return next;
    });
  }, [selectedIds.length]);

  const generate = async () => {
    if (selectedIds.length < 2) {
      setError("参加者を 2 人以上選択してください");
      return;
    }
    const filled = selectedIds.length;
    if (options.filter((o) => o.trim()).length < filled) {
      setError(`選択肉を${filled}個入力してください`);
      return;
    }
    onClose();
    // 生成はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.ladder.generate(
          accountId,
          chatId,
          selectedIds,
          options.slice(0, selectedIds.length),
        );
        if (!res.ok) throw new Error("生成に失敗しました");
        const r = res.data as { ladderHash?: string };
        // 生成後は自動で flex を送信
        if (r?.ladderHash) {
          await api.line.ladder.message(accountId, chatId, r.ladderHash);
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "あみだくじの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="あみだくじ" onClose={onClose}>
      <ErrorText error={error} />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--vy-text-dim)]">参加者（{selectedIds.length}人）</span>
        <button
          type="button"
          className="text-xs text-[var(--vy-accent)] disabled:opacity-40"
          onClick={allSelected}
          disabled={membersLoading}
        >
          全員選択
        </button>
      </div>
      {membersLoading ? (
        <p className="mb-3 py-6 text-center text-xs text-[var(--vy-text-dim)]">
          参加者を読み込み中…
        </p>
      ) : (
        <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--vy-surface-2)]"
            >
              <input
                type="checkbox"
                checked={!!selected[m.id]}
                onChange={(e) => setSelected((p) => ({ ...p, [m.id]: e.target.checked }))}
              />
              <span className="flex-1 truncate">{m.name}</span>
            </div>
          ))}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs text-[var(--vy-text-dim)] mb-1">
            選択肉 ({selectedIds.length}個の結果を入力)
          </label>
          <div className="space-y-1">
            {selectedIds.map((_, i) => (
              <input
                key={i}
                className={cn(inputCls, "text-xs")}
                placeholder={`結果${i + 1}を入力（例: お皿洗い）`}
                value={options[i] ?? ""}
                onChange={(e) =>
                  setOptions((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={generate}
        className="w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成して送信
      </button>
    </Modal>
  );
}

// ── イベント作成（スケジュール） ─────────────────────────────

function ScheduleModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [candidates, setCandidates] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  // 共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "schedule", chatId);
  }, [accountId, chatId]);

  const create = async () => {
    const times = candidates.map(toEpochMs).filter(Boolean);
    if (!name.trim() || times.length === 0) {
      setError("タイトルと日時を 1 つ以上入力してください");
      return;
    }
    onClose();
    // 作成〜共有はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.schedule.create(accountId, chatId, {
          name: name.trim(),
          description: desc.trim(),
          candidates: times,
        });
        if (!res.ok) throw new Error("作成に失敗しました");
        // 現在のチャットに共有（best effort）: encId を直接取得（名前マッチング不要）
        const group = (await api.line.schedule.group(accountId, chatId)) as {
          ok: boolean;
          data?: { encId?: string; groupName?: string };
        };
        const encId = group?.data?.encId;
        if (!encId) throw new Error("共有先グループが見つかりませんでした");
        const data = res.data as { urlKey?: string };
        const eventKey = data?.urlKey ?? null;
        if (!eventKey) throw new Error("イベントの共有用 URL を取得できませんでした");
        await api.line.schedule.share(
          accountId,
          chatId,
          eventKey,
          [encId],
          "イベントを作成しました。日程を回答してください。",
        );
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "イベントの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="イベントを作成" onClose={onClose}>
      <ErrorText error={error} />
      <Field label="タイトル">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 忘年会"
        />
      </Field>
      <Field label="詳細（任意）">
        <textarea
          className={cn(inputCls, "min-h-16")}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </Field>
      <Field label="候補日時">
        <div className="space-y-1">
          {candidates.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="datetime-local"
                className={cn(inputCls, "flex-1")}
                value={c}
                onChange={(e) =>
                  setCandidates((p) => p.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <button
                type="button"
                className="rounded px-1 text-[var(--vy-text-dim)] hover:text-red-400"
                onClick={() => setCandidates((p) => p.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-1 text-xs text-[var(--vy-accent)]"
          onClick={() => setCandidates((p) => [...p, ""])}
        >
          + 日時を追加
        </button>
      </Field>
      <button
        type="button"
        onClick={create}
        className="mt-2 w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成して共有
      </button>
    </Modal>
  );
}

// ── アンケート作成 ─────────────────────────────────────────

function PollModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(true);

  // 共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "poll", chatId);
  }, [accountId, chatId]);
  const [anonymous, setAnonymous] = useState(false);
  const [closeDate, setCloseDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const choiceList = choices
      .map((c) => c.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (!title.trim() || choiceList.length < 2) {
      setError("タイトルと選択肢を 2 つ以上入力してください");
      return;
    }
    onClose();
    // 作成〜共有はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.poll.create(accountId, chatId, {
          title: title.trim(),
          multiple,
          anonymous,
          closeDate: toEpochMs(closeDate),
          choiceList,
        });
        if (!res.ok) throw new Error((res as { error?: string }).error || "作成に失敗しました");
        const data = (res.data ?? {}) as Record<string, unknown>;
        const questionId =
          String(
            data.result ??
              data.questionId ??
              (data.question as Record<string, unknown> | undefined)?.questionId ??
              "",
          ) || "";
        if (!questionId)
          throw new Error("アンケートを作成しましたが、共有用 ID を取得できませんでした");
        const a = await api.line.poll.announce(accountId, chatId, questionId);
        if (!a.ok) {
          window.alert("アンケートを作成しましたが、共有に失敗しました（再度共有してください）");
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "アンケートの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="アンケートを作成" onClose={onClose}>
      <ErrorText error={error} />
      <Field label="質問">
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: どこで飲む？"
        />
      </Field>
      <Field label="選択肢">
        <div className="space-y-1">
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className={cn(inputCls, "flex-1")}
                value={c}
                onChange={(e) => setChoices((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button
                type="button"
                className="rounded px-1 text-[var(--vy-text-dim)] hover:text-red-400"
                onClick={() => setChoices((p) => (p.length > 2 ? p.filter((_, j) => j !== i) : p))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-1 text-xs text-[var(--vy-accent)]"
          onClick={() => setChoices((p) => [...p, ""])}
        >
          + 選択肢を追加
        </button>
      </Field>
      <div className="mb-3 flex gap-4">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
          />{" "}
          複数回答可
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />{" "}
          匿名
        </label>
      </div>
      <Field label="締切（任意）">
        <input
          type="datetime-local"
          className={inputCls}
          value={closeDate}
          onChange={(e) => setCloseDate(e.target.value)}
        />
      </Field>
      <button
        type="button"
        onClick={create}
        className="mt-2 w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成
      </button>
    </Modal>
  );
}

// ── メイン: 「+」ボタンとメニュー ───────────────────────────

export function PlusMenu({ chatId }: { chatId: string }) {
  const accountId = useStore((s) => s.accountId);
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"schedule" | "ladder" | "poll" | null>(null);

  const items: {
    key: "schedule" | "ladder" | "poll";
    label: string;
    icon: string;
    disabled?: boolean;
  }[] = [
    { key: "schedule", label: "イベントを作成", icon: "📅" },
    { key: "ladder", label: "あみだくじ", icon: "🎯", disabled: chat?.type !== "group" },
    { key: "poll", label: "アンケート", icon: "🗳️" },
  ];

  return (
    <>
      <style>{PLUS_KEYFRAMES}</style>
      <div className="relative">
        <button
          type="button"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-lg text-[var(--vy-text-dim)] transition-transform duration-200 hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
            open && "rotate-45 text-[var(--vy-accent)]",
          )}
          onClick={() => setOpen((p) => !p)}
          aria-label="メニューを開く"
        >
          ＋
        </button>
        {open && (
          <div
            className="absolute bottom-full left-0 z-[70] mb-2 w-52 overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl"
            style={{ animation: "vy-pop 0.16s ease-out" }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] disabled:opacity-40"
                onClick={() => {
                  setOpen(false);
                  setMode(item.key);
                }}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
                {item.disabled && (
                  <span className="ml-auto text-[10px] text-[var(--vy-text-dim)]">
                    グループのみ
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "schedule" && accountId && (
        <ScheduleModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "ladder" && accountId && (
        <LadderModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "poll" && accountId && (
        <PollModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
    </>
  );
}
