import { useState, useEffect, useRef, useCallback } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useAuthStore } from "../stores/authStore.js";
import { api } from "../api/client.js";
import { useStore } from "../lib/store.js";
import { ThemeApplier } from "../components/theme-applier.js";
import { lineAvatarUrl } from "../utils/lineMedia.js";

type Tab = "email" | "qr" | "token";
type QrStatus = "idle" | "waiting" | "completed";
type EmailStatus = "idle" | "pending" | "completed" | "failed";
type TokenStatus = "idle" | "pending" | "completed" | "failed";

function formatSavedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const setScreen = useStore((s) => s.setScreen);
  const {
    loginEmail,
    loginQrStart,
    loginToken,
    loading,
    error,
    bootstrap,
    initialized,
    accounts,
    sessions,
    refreshSessions,
    restore,
    deleteSession,
    onLoginSuccess,
    pendingLoginAccountId,
    loginMode,
    setPendingLogin,
  } = useAuthStore();

  const [tab, setTab] = useState<Tab>("email");
  const [accountId, setAccountId] = useState(pendingLoginAccountId ?? "main");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [emailPincode, setEmailPincode] = useState<string | null>(null);
  const emailPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [qrAccountId, setQrAccountId] = useState(pendingLoginAccountId ?? "main");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<QrStatus>("idle");
  const [qrExpired, setQrExpired] = useState(false);
  const [pincode, setPincode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [tokenAccountId, setTokenAccountId] = useState(pendingLoginAccountId ?? "main");
  const [authToken, setAuthToken] = useState("");
  const [tokenMsg, setTokenMsg] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("idle");
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // 事前選択アカウントが後から決まった場合（サイドバーから遷移）にも追従する
  useEffect(() => {
    if (pendingLoginAccountId) {
      setAccountId(pendingLoginAccountId);
      setQrAccountId(pendingLoginAccountId);
      setTokenAccountId(pendingLoginAccountId);
    }
  }, [pendingLoginAccountId]);

  const goHome = useCallback(
    async (loggedInAccountId: string) => {
      await onLoginSuccess(loggedInAccountId);
      const showNote = useStore.getState().showUpdateNote;
      setScreen(showNote ? "home" : "chat");
      navigate("/");
    },
    [onLoginSuccess, setScreen, navigate],
  );

  // 起動時: 保存セッション一覧を取得。既に active ならホームへ
  useEffect(() => {
    void (async () => {
      await bootstrap();
      await refreshSessions();
    })();
  }, [bootstrap, refreshSessions]);

  // 起動直後の自動遷移は「サイドバーから開いたログイン画面」では行わない
  useEffect(() => {
    if (initialized && accounts.length > 0 && loginMode === "auto") {
      const showNote = useStore.getState().showUpdateNote;
      setScreen(showNote ? "home" : "chat");
      navigate("/", { replace: true });
    }
  }, [initialized, accounts.length, loginMode, setScreen, navigate]);

  const backToChat = () => {
    if (accounts.length === 0) return;
    setPendingLogin(null);
    setScreen("chat");
    navigate("/");
  };

  const handleRestore = async (id: string) => {
    setSessionError(null);
    setRestoringId(id);
    const res = await restore(id);
    setRestoringId(null);
    if (!res.ok) {
      setSessionError(res.error ?? "セッションの復元に失敗しました");
      await refreshSessions();
      return;
    }
    await goHome(id);
  };

  const handleDeleteSession = async (id: string) => {
    setSessionError(null);
    await deleteSession(id);
    await refreshSessions();
  };

  const handleEmailLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailMsg("");
    setEmailPincode(null);
    setEmailStatus("pending");
    const res = await loginEmail(accountId, email, password);
    if (!res.ok) {
      setEmailStatus("failed");
      return;
    }
    setEmailMsg("PIN が表示されたら、LINE 端末側に入力してください。");
    // 他のログイン方式のポーリングを止めて二重 goHome を防ぐ
    if (pollRef.current) clearInterval(pollRef.current);
    if (emailPollRef.current) clearInterval(emailPollRef.current);
    emailPollRef.current = setInterval(async () => {
      const polled = await api.auth.loginEmailPoll(accountId);
      if (!polled.ok) return;
      if (polled.pincode) setEmailPincode(polled.pincode);
      if (polled.status === "failed") {
        setEmailStatus("failed");
        setEmailMsg(polled.error ?? "メールログインに失敗しました。");
        if (emailPollRef.current) clearInterval(emailPollRef.current);
        return;
      }
      if (polled.status === "completed") {
        setEmailStatus("completed");
        if (emailPollRef.current) clearInterval(emailPollRef.current);
        await goHome(accountId);
      }
    }, 1200);
  };

  const handleTokenLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTokenMsg("");
    setTokenError(null);
    setTokenStatus("pending");
    const res = await loginToken(tokenAccountId, authToken);
    if (!res.ok) {
      setTokenStatus("failed");
      setTokenError(res.error ?? "トークンログインに失敗しました。");
      return;
    }
    setTokenStatus("completed");
    setTokenMsg("ログイン完了 — セッションを保存しました");
    await goHome(tokenAccountId);
  };

  const startQrLogin = useCallback(async () => {
    setQrUrl(null);
    setQrExpired(false);
    setPincode(null);
    setQrStatus("waiting");
    // 他のログイン方式のポーリングを止めて二重 goHome を防ぐ
    if (emailPollRef.current) clearInterval(emailPollRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    const start = await loginQrStart(qrAccountId);
    if (!start.ok) {
      setQrExpired(true);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await api.auth.loginQrPoll(qrAccountId);
      if (!res.ok) return;
      if (res.status === "expired" || res.status === "idle") {
        setQrExpired(true);
        setPincode(null);
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      if (res.qrUrl) {
        setQrUrl(res.qrUrl);
        setQrExpired(false);
      }
      if (res.pincode) setPincode(res.pincode);
      if (res.status === "completed") {
        setQrStatus("completed");
        if (pollRef.current) clearInterval(pollRef.current);
        await goHome(qrAccountId);
      }
    }, 1500);
  }, [qrAccountId, loginQrStart, goHome]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (emailPollRef.current) clearInterval(emailPollRef.current);
    };
  }, []);

  const savedSessions = sessions.filter((s) => s.hasToken);

  return (
    <>
      <ThemeApplier />
      <div className="min-h-dvh bg-[var(--vy-bg)] flex items-center justify-center px-4 py-8">
        <div className="relative w-full max-w-md rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-8 shadow-2xl vy-scale-in">
          {loginMode === "manual" && (
            <button
              type="button"
              onClick={backToChat}
              className="absolute left-4 top-4 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
            >
              ← チャットに戻る
            </button>
          )}
          <div className="flex flex-col items-center mb-6 mt-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-[var(--vy-accent-contrast)] font-bold text-lg"
              style={{ background: "var(--vy-accent)" }}
            >
              V
            </div>
            <h1 className="text-2xl font-bold mt-3">Vyline</h1>
            <p className="text-[13px] text-[var(--vy-text-dim)] mt-1">LINE にログイン</p>
          </div>

          {savedSessions.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-medium text-[var(--vy-text-dim)]">
                保存済みセッション
              </p>
              <div className="space-y-2">
                {savedSessions.map((s) => {
                  const name = s.displayName || s.accountId;
                  const thumb = lineAvatarUrl(s.picturePath);
                  const busy = restoringId === s.accountId;
                  return (
                    <div
                      key={s.accountId}
                      className="flex items-center gap-3 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5"
                    >
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-[var(--vy-accent-contrast)]"
                        style={{ background: "var(--vy-accent)" }}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        <p className="truncate text-[0.7rem] text-[var(--vy-text-dim)]">
                          {s.accountId}
                          {s.savedAt ? ` · ${formatSavedAt(s.savedAt)}` : ""}
                          {s.active ? " · 接続中" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy || loading}
                        onClick={() => void handleRestore(s.accountId)}
                        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
                        style={{ background: "var(--vy-accent)" }}
                      >
                        {busy ? "復元中…" : "続行"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || loading}
                        onClick={() => void handleDeleteSession(s.accountId)}
                        className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--vy-text-dim)] hover:text-red-400 disabled:opacity-50"
                        aria-label={`${name} のセッションを削除`}
                      >
                        削除
                      </button>
                    </div>
                  );
                })}
              </div>
              {sessionError && <p className="mt-2 text-xs text-red-300">{sessionError}</p>}
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--vy-border)]" />
                <span className="text-[0.7rem] text-[var(--vy-text-dim)]">または新規ログイン</span>
                <span className="h-px flex-1 bg-[var(--vy-border)]" />
              </div>
            </div>
          )}

          <div className="flex mb-6 bg-[var(--vy-surface-2)] rounded-xl p-1">
            {(["email", "qr", "token"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? "text-[var(--vy-accent-contrast)]" : "text-[var(--vy-text-dim)]"
                }`}
                style={tab === t ? { background: "var(--vy-accent)" } : undefined}
              >
                {t === "email" ? "メール" : t === "qr" ? "QR コード" : "トークン"}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
              {error}
            </div>
          )}

          {tab === "email" && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <Field
                label="アカウント名"
                value={accountId}
                onChange={setAccountId}
                placeholder="main"
              />
              <Field
                label="メールアドレス"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="you@example.com"
              />
              <Field label="パスワード" value={password} onChange={setPassword} type="password" />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--vy-accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--vy-accent)" }}
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
              <p className="text-center text-[0.7rem] text-[var(--vy-text-dim)]">
                ログイン成功後、セッションは自動で保存されます
              </p>
              {emailStatus === "pending" && emailPincode && <PinBox code={emailPincode} />}
              {emailMsg && (
                <p className="text-sm text-[var(--vy-text-dim)] text-center">{emailMsg}</p>
              )}
            </form>
          )}

          {tab === "qr" && (
            <div className="space-y-4">
              <Field
                label="アカウント名"
                value={qrAccountId}
                onChange={setQrAccountId}
                placeholder="main"
              />
              {qrStatus === "idle" && (
                <button
                  type="button"
                  onClick={() => void startQrLogin()}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--vy-accent-contrast)]"
                  style={{ background: "var(--vy-accent)" }}
                >
                  QR コードを生成
                </button>
              )}
              {qrStatus === "waiting" && !qrUrl && !qrExpired && (
                <p className="text-center text-sm text-[var(--vy-text-dim)] py-8">
                  QR コードを取得中...
                </p>
              )}
              {(qrUrl || qrExpired) && qrStatus !== "completed" && (
                <div className="flex flex-col items-center gap-4">
                  <div
                    className={`bg-white p-4 rounded-xl ${qrExpired ? "opacity-30 grayscale" : ""}`}
                  >
                    <QRCodeSVG value={qrUrl ?? "expired"} size={220} />
                  </div>
                  {qrExpired ? (
                    <button
                      type="button"
                      onClick={() => void startQrLogin()}
                      className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--vy-accent-contrast)]"
                      style={{ background: "var(--vy-accent)" }}
                    >
                      QR コードを再生成
                    </button>
                  ) : (
                    <>
                      {pincode && <PinBox code={pincode} />}
                      <p className="text-sm text-[var(--vy-text-dim)] text-center">
                        {pincode ? "PIN コードを入力中..." : "LINE アプリでスキャンしてください"}
                      </p>
                    </>
                  )}
                </div>
              )}
              {qrStatus === "completed" && (
                <p className="text-center text-green-400 py-4">
                  ログイン完了 — セッションを保存しました
                </p>
              )}
              <p className="text-center text-[0.7rem] text-[var(--vy-text-dim)]">
                ログイン成功後、セッションは自動で保存されます
              </p>
            </div>
          )}

          {tab === "token" && (
            <form onSubmit={handleTokenLogin} className="space-y-4">
              <Field
                label="アカウント名"
                value={tokenAccountId}
                onChange={setTokenAccountId}
                placeholder="main"
              />
              <div>
                <label className="block text-sm text-[var(--vy-text-dim)] mb-1">
                  アクセストークン
                </label>
                <textarea
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="LINE authToken を貼り付け（JWT または key:secret 形式）"
                  className="w-full rounded-xl bg-[var(--vy-surface-2)] border border-[var(--vy-border)] px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--vy-accent)] min-h-[80px] font-mono text-xs resize-y"
                  rows={4}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-[var(--vy-accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--vy-accent)" }}
              >
                {loading ? "ログイン中..." : "ログイン"}
              </button>
              <p className="text-center text-[0.7rem] text-[var(--vy-text-dim)]">
                ログイン成功後、セッションは自動で保存されます
              </p>
              {tokenError && (
                <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
                  {tokenError}
                </div>
              )}
              {tokenStatus === "completed" && tokenMsg && (
                <p className="text-center text-green-400 py-2">{tokenMsg}</p>
              )}
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-[var(--vy-text-dim)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={type === "password" || type === "email"}
        className="w-full rounded-xl bg-[var(--vy-surface-2)] border border-[var(--vy-border)] px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--vy-accent)]"
      />
    </div>
  );
}

function PinBox({ code }: { code: string }) {
  return (
    <div className="w-full rounded-xl border border-yellow-500/50 bg-yellow-500/15 px-4 py-3 text-center">
      <p className="text-xs text-yellow-200 mb-1">LINE 端末にこの PIN を入力</p>
      <p className="text-3xl font-bold tracking-[0.3em] text-yellow-100">{code}</p>
    </div>
  );
}
