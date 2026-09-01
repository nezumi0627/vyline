import { useState } from "react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/vy-ui";

type TokenView = {
  index: number;
  kind: "access" | "refresh" | "unknown";
  status: "usable" | "unusable";
  fingerprint: string;
  expiresAt?: number;
  remainingSeconds: number;
  pairedIndex?: number;
};

function remainingLabel(seconds: number): string {
  if (seconds <= 0) return "期限切れ / 不明";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}日 ${hours}時間`;
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  return `${Math.max(1, minutes)}分`;
}

function TokenRow({
  token,
  scanId,
  accountId,
  importing,
  onImport,
}: {
  token: TokenView;
  scanId: string | null;
  accountId: string | null;
  importing: number | null;
  onImport: (index: number) => void;
}) {
  const label =
    token.kind === "access"
      ? "アクセストークン"
      : token.kind === "refresh"
        ? "リフレッシュトークン"
        : "未分類";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--vy-border)] px-3 py-2.5">
      <div className="min-w-0 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          <span
            className={token.status === "usable" ? "text-emerald-400" : "text-[var(--vy-text-dim)]"}
          >
            {token.status === "usable" ? "利用可能" : "利用不可"}
          </span>
        </div>
        <p className="mt-1 text-[var(--vy-text-dim)]">
          識別子 {token.fingerprint} · 残り {remainingLabel(token.remainingSeconds)}
        </p>
        {token.expiresAt && (
          <p className="text-[var(--vy-text-dim)]">
            期限 {new Date(token.expiresAt * 1000).toLocaleString()}
          </p>
        )}
        {token.pairedIndex !== undefined && (
          <p className="text-[var(--vy-text-dim)]">ペア: 候補 #{token.pairedIndex + 1}</p>
        )}
      </div>
      {token.kind === "access" && token.status === "usable" && (
        <Button
          size="sm"
          variant="secondary"
          disabled={!scanId || !accountId || importing !== null}
          loading={importing === token.index}
          onClick={() => onImport(token.index)}
        >
          取り込む
        </Button>
      )}
    </div>
  );
}

export function WindowsLineTokenBetaPanel({ accountId }: { accountId: string | null }) {
  const refreshAccounts = useAuthStore((state) => state.refreshAccounts);
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.auth.windowsLineTokens();
      if (!response.ok || !response.tokens || !response.scanId)
        throw new Error(response.error ?? "トークンを取得できませんでした");
      setTokens(response.tokens);
      setScanId(response.scanId);
      setMessage(`${response.tokens.length}件の候補を確認しました`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スキャンに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const importToken = async (candidateIndex: number) => {
    if (!accountId || !scanId) return;
    setImporting(candidateIndex);
    setMessage(null);
    try {
      const response = await api.auth.importWindowsLineToken({ accountId, scanId, candidateIndex });
      if (!response.ok) throw new Error(response.error ?? "取り込みに失敗しました");
      await refreshAccounts();
      setMessage(
        response.pairedRefreshSaved
          ? "アクセストークンとペアのリフレッシュトークンを保存しました"
          : "アクセストークンを保存しました",
      );
      setScanId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取り込みに失敗しました");
    } finally {
      setImporting(null);
    }
  };

  const usable = tokens.filter((token) => token.status === "usable");
  const unusable = tokens.filter((token) => token.status === "unusable");
  return (
    <div className="mt-4 rounded-2xl border border-amber-500/40 bg-[var(--vy-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Windows版LINEのトークン確認</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            起動中のLINE.exeだけを読み取り、候補を期限で分類します。生トークンは画面・ログ・API応答に返しません。
          </p>
        </div>
        <Button size="sm" variant="primary" loading={loading} onClick={() => void scan()}>
          {loading ? "確認中…" : "候補を確認"}
        </Button>
      </div>
      {message && (
        <p className="mt-3 text-xs text-[var(--vy-text-dim)]" role="status">
          {message}
        </p>
      )}
      {tokens.length > 0 && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-emerald-400">
              利用可能 ({usable.length})
            </p>
            <div className="space-y-2">
              {usable.map((token) => (
                <TokenRow
                  key={token.index}
                  token={token}
                  scanId={scanId}
                  accountId={accountId}
                  importing={importing}
                  onImport={(index) => void importToken(index)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-[var(--vy-text-dim)]">
              利用不可 ({unusable.length})
            </p>
            <div className="space-y-2">
              {unusable.map((token) => (
                <TokenRow
                  key={token.index}
                  token={token}
                  scanId={scanId}
                  accountId={accountId}
                  importing={importing}
                  onImport={(index) => void importToken(index)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
