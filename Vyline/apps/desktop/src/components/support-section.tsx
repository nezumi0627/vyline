import { useMemo, useState } from "react";
import { api } from "@/api/client";
import { IconArrowLeft, IconDownload, IconSpark, IconUsers } from "@/components/icons";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { createSupportZip, redactSupportValue } from "@/lib/supportBundle";
import { getBetaFeatureConsentHistory } from "@/lib/betaConsent";
import { useThemeStore } from "@/stores/themeStore";
import { SupportBot } from "./support-bot";
import {
  buildSupportIssueBody,
  SUPPORT_CATEGORIES,
  type SupportCategory,
  type SupportReport,
} from "./supportWorkflow";

type SupportMode = "choose" | "human" | "bot";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const fieldClass =
  "mt-1.5 block w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5 text-sm leading-relaxed";

export function SupportSection() {
  const aiEnabled = useStore((state) => state.settings.aiEnabled);
  const accountId = useStore((state) => state.accountId);
  const [mode, setMode] = useState<SupportMode>("choose");
  const [category, setCategory] = useState<SupportCategory>("other");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [includeMessageText, setIncludeMessageText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const report: SupportReport = { category, title, details, steps, expected };
  const issueBody = useMemo(
    () => buildSupportIssueBody(report, UPDATE_NOTES.version),
    [category, title, details, steps, expected],
  );
  const githubIssueUrl = useMemo(() => {
    const url = new URL("https://github.com/nezumi0627/Vyline/issues/new");
    if (title.trim()) url.searchParams.set("title", title.trim());
    url.searchParams.set("body", issueBody);
    return url.toString();
  }, [title, issueBody]);

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const incoming = [...files];
    if (incoming.some((file) => !file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES)) {
      setError("画像は1枚10MB以下にしてください");
      return;
    }
    const next = [...images, ...incoming].slice(0, 5);
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setError("添付画像の合計は25MBまでです");
      return;
    }
    setError("");
    setImages(next);
  };

  const downloadBundle = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const appState = useStore.getState();
      const themeState = useThemeStore.getState();
      const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData;
      const runtime = await api.debug.health().catch(() => ({ ok: false as const }));
      const diagnostics = {
        generatedAt: new Date().toISOString(),
        vylineVersion: UPDATE_NOTES.version,
        browser: navigator.userAgent,
        browserPlatform: userAgentData?.platform || navigator.platform || "unknown",
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: { width: screen.width, height: screen.height, pixelRatio: devicePixelRatio },
        backend: runtime.ok
          ? { status: "online", uptime: runtime.uptime, memory: runtime.memory }
          : { status: "unavailable" },
        online: navigator.onLine,
        notificationPermission:
          typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      };
      const settingsSnapshot = redactSupportValue({
        settings: appState.settings,
        theme: appState.theme,
        visualTheme: { themeId: themeState.themeId, custom: themeState.custom },
        sidebarWidth: appState.sidebarWidth,
        betaFeatureConsentHistory: getBetaFeatureConsentHistory(),
      });
      const entries: { name: string; data: Uint8Array }[] = [
        {
          name: "diagnostics.json",
          data: new TextEncoder().encode(JSON.stringify(diagnostics, null, 2)),
        },
        {
          name: "settings-and-theme.json",
          data: new TextEncoder().encode(JSON.stringify(settingsSnapshot, null, 2)),
        },
        { name: "support-report.md", data: new TextEncoder().encode(issueBody) },
      ];
      if (includeLogs && accountId) {
        const response = await api.line.messageLog(accountId, 500);
        if (!response.ok) throw new Error(response.error ?? "ログを取得できませんでした");
        const logs = (response.data ?? []).map((entry) => {
          const safe = {
            ...entry,
            accountId: "[ACCOUNT]",
            chatMid: "[CHAT]",
            senderMid: "[MEMBER]",
            messageId: "[MESSAGE]",
            chatName: "[CHAT]",
            senderName: "[MEMBER]",
            text: includeMessageText ? entry.text : undefined,
          };
          return redactSupportValue(safe);
        });
        entries.push({
          name: "logs/message-log.json",
          data: new TextEncoder().encode(JSON.stringify(logs, null, 2)),
        });
      }
      for (const [index, image] of images.entries()) {
        const extension = image.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "img";
        entries.push({
          name: `attachments/image-${index + 1}.${extension}`,
          data: new Uint8Array(await image.arrayBuffer()),
        });
      }
      const blob = createSupportZip(entries);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vyline-support-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("サポートZIPを保存しました。添付前に内容を確認してください。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "サポートZIPを作成できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const backToChoices = () => {
    setMode("choose");
    setError("");
    setNotice("");
  };

  return (
    <section className="vy-fade-in">
      <div className="border-b border-[var(--vy-border)] pb-4">
        <h2 className="text-xl font-bold tracking-tight">サポート</h2>
        <p className="mt-1 text-sm text-[var(--vy-text-dim)]">
          症状を整理して、解決方法を探すか開発者へ共有できます。
        </p>
      </div>

      {mode === "choose" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(240px,5fr)]">
          {aiEnabled && (
            <button
              type="button"
              onClick={() => setMode("bot")}
              className="group border-b border-[var(--vy-border)] pb-5 text-left transition-colors hover:border-[var(--vy-accent)] lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6"
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                <IconSpark size={18} />
                AIで原因を切り分ける
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-[var(--vy-text-dim)]">
                困っていることや再現手順を入力すると、確認する順番をAgent Iが案内します。
              </span>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--vy-accent)]">
                Botサポートを開く <span aria-hidden>→</span>
              </span>
            </button>
          )}
          <button type="button" onClick={() => setMode("human")} className="group text-left">
            <span className="flex items-center gap-2 text-base font-semibold">
              <IconUsers size={18} />
              開発者に相談する
            </span>
            <span className="mt-2 block text-sm leading-relaxed text-[var(--vy-text-dim)]">
              再現情報を整えてGitHub Issueを作成するか、Discordで連絡できます。
            </span>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--vy-accent)]">
              問い合わせ内容を作る <span aria-hidden>→</span>
            </span>
          </button>
          <p className="border-t border-[var(--vy-border)] pt-3 text-xs leading-relaxed text-[var(--vy-text-dim)] lg:col-span-2">
            診断ZIPや画像は自動送信されません。共有前に内容を確認し、必要な窓口へご自身で添付してください。
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <button
            type="button"
            onClick={backToChoices}
            className="mb-5 inline-flex items-center gap-2 text-xs text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]"
          >
            <IconArrowLeft size={15} />
            問い合わせ方法を選び直す
          </button>
          {mode === "bot" && aiEnabled ? (
            <SupportBot />
          ) : mode === "bot" ? (
            <p className="rounded-xl border border-[var(--vy-border)] p-4 text-sm text-[var(--vy-text-dim)]">
              AI機能は設定で無効になっています。利用する場合は「表示」設定から有効にしてください。
            </p>
          ) : (
            <>
              <div className="mb-5">
                <h3 className="text-lg font-semibold">開発者に伝える内容を整理</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                  入力した内容はIssueの下書きとサポートZIPに入ります。パスワード、Cookie、tokenは記入しないでください。
                </p>
              </div>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(240px,5fr)]">
                <div className="space-y-3">
                  <label className="block text-xs font-semibold">
                    相談カテゴリ
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value as SupportCategory)}
                      className={fieldClass}
                    >
                      {Object.entries(SUPPORT_CATEGORIES).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold">
                    症状
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={160}
                      placeholder="例：起動するたびにログインを求められる"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    詳しい状況
                    <textarea
                      value={details}
                      onChange={(event) => setDetails(event.target.value)}
                      maxLength={3000}
                      rows={4}
                      placeholder="いつから、どの画面で、何をすると起きるか"
                      className={`${fieldClass} resize-y`}
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    再現手順
                    <textarea
                      value={steps}
                      onChange={(event) => setSteps(event.target.value)}
                      maxLength={1500}
                      rows={3}
                      placeholder="1. Vylineを起動\n2. …"
                      className={`${fieldClass} resize-y`}
                    />
                  </label>
                  <label className="block text-xs font-semibold">
                    期待する動作（任意）
                    <textarea
                      value={expected}
                      onChange={(event) => setExpected(event.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder="本来どうなる想定か"
                      className={`${fieldClass} resize-y`}
                    />
                  </label>
                </div>

                <aside className="space-y-5 border-t border-[var(--vy-border)] pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <div>
                    <h4 className="text-sm font-semibold">問い合わせ先</h4>
                    <a
                      href={githubIssueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={!title.trim()}
                      tabIndex={title.trim() ? undefined : -1}
                      onClick={(event) => {
                        if (!title.trim()) event.preventDefault();
                      }}
                      className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)] ${title.trim() ? "" : "pointer-events-none opacity-45"}`}
                      style={{ background: "var(--vy-accent)" }}
                    >
                      GitHub Issueを作成
                    </a>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                      入力内容とVylineのバージョンを下書きに反映します。
                    </p>
                    <a
                      href="https://discord.com/users/1528045413796413461"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex text-sm font-medium underline underline-offset-4"
                    >
                      Discordで開発者に連絡
                    </a>
                  </div>

                  <div className="border-t border-[var(--vy-border)] pt-4">
                    <h4 className="text-sm font-semibold">画像・診断情報</h4>
                    <label className="mt-3 block text-xs leading-relaxed">
                      画像を追加（最大5枚、合計25MB）
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => addImages(event.currentTarget.files)}
                        className="mt-2 block w-full text-xs"
                      />
                    </label>
                    {images.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {images.map((image, index) => (
                          <li
                            key={`${image.name}-${index}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{image.name}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setImages((items) =>
                                  items.filter((_, itemIndex) => itemIndex !== index),
                                )
                              }
                              className="shrink-0 text-[var(--vy-danger)]"
                            >
                              削除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                      ZIPにはバージョン、端末・LINE接続情報、設定、テーマ、入力した相談内容が入ります。認証情報は伏せ、ZIPはこの端末に保存します。
                    </p>
                    <label className="mt-3 flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={includeLogs}
                        onChange={(event) => setIncludeLogs(event.target.checked)}
                      />
                      <span>最近のログを含める（本文は含めない）</span>
                    </label>
                    {includeLogs && (
                      <label className="mt-2 flex items-start gap-2 text-xs text-[var(--vy-text-dim)]">
                        <input
                          type="checkbox"
                          checked={includeMessageText}
                          onChange={(event) => setIncludeMessageText(event.target.checked)}
                        />
                        <span>メッセージ本文も含める。個人情報が含まれる可能性があります。</span>
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void downloadBundle()}
                      disabled={busy}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      <IconDownload size={15} />
                      {busy ? "ZIPを作成中…" : "診断ZIPを保存"}
                    </button>
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      )}

      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-4 text-sm ${error ? "text-[var(--vy-danger)]" : "text-[var(--vy-accent)]"}`}
        >
          {error || notice}
        </p>
      )}
    </section>
  );
}
