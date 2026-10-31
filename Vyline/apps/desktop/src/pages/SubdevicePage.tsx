import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { getSubdeviceSessionToken, setSubdeviceSessionToken } from "@/lib/subdeviceSession";

const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  ? "ios"
  : /Android/i.test(navigator.userAgent)
    ? "android"
    : "web";

export function SubdevicePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("接続情報を確認しています…");
  const pairingToken = params.get("pairing") ?? new URLSearchParams(window.location.hash.slice(1)).get("pairing");
  const setAccountId = useStore((s) => s.setAccountId);

  useEffect(() => {
    if (pairingToken) window.history.replaceState(window.history.state, "", window.location.pathname);
    let cancelled = false;
    const connect = async () => {
      try {
        if (pairingToken) {
          const info = await api.subdevices.pairingInfo(pairingToken);
          if (!info.ok) throw new Error("QRコードの有効期限が切れています");
          setMessage("この端末をサブデバイスとして登録します");
          return;
        }
        const savedToken = await getSubdeviceSessionToken();
        if (savedToken) {
          const res = await api.subdevices.heartbeat(savedToken);
          if (res.ok && res.device) {
            setAccountId(res.device.accountId);
            navigate("/", { replace: true });
            return;
          }
        }
        setMessage("PC側の設定からQRコードを読み込んでください");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "接続に失敗しました");
      }
    };
    void connect();
    return () => {
      cancelled = true;
    };
  }, [pairingToken, navigate, setAccountId]);

  const complete = async () => {
    if (!pairingToken) return;
    try {
      const res = await api.subdevices.complete(pairingToken, name, platform);
      if (!res.ok || !res.sessionToken || !res.device) {
        setMessage(res.error ?? "登録に失敗しました");
        return;
      }
      await setSubdeviceSessionToken(res.sessionToken);
      setAccountId(res.device.accountId);
      navigate("/", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登録APIに接続できませんでした");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--vy-bg)] p-6 text-[var(--vy-text)]">
      <section className="w-full max-w-md rounded-3xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-6 shadow-xl">
        <h1 className="text-xl font-bold">Vyline サブデバイス</h1>
        <p className="mt-2 text-sm text-[var(--vy-text-dim)]">{message}</p>
        {pairingToken && message.includes("登録") && (
          <div className="mt-6 space-y-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="端末名（例: iPhone）"
              className="w-full rounded-xl border border-[var(--vy-border)] bg-transparent px-3 py-2"
            />
            <button
              type="button"
              onClick={() => void complete()}
              className="w-full rounded-xl bg-[var(--vy-accent)] px-4 py-3 font-semibold text-white"
            >
              この端末を接続
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
