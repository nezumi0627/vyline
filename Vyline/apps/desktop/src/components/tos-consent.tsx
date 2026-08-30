import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { IconShield } from "@/components/icons";

const CONSENT_KEY = "vyline:tos-consent-v1";

export function hasTosConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTosConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    /* storage unavailable — 使用自体が同意とみなす */
  }
}

/**
 * 利用規約・免責同意ゲート。
 * ログイン後・初回のみ表示され、同意しない限りアプリは動作しない。
 * 想定外の手段（localStorage 改変・キャッシュ回避等）でスキップされた場合も
 * 「使用した時点で同意したものとみなす」ため、開発者は一切の責任を負わない。
 */
export function TosConsentGate({ onConsent }: { onConsent: () => void }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && checked) agree();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const agree = () => {
    setTosConsent();
    onConsent();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">
      <div className="w-full max-w-xl px-6 py-10">
        <div className="overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl">
          <div className="flex items-center gap-3 border-b border-[var(--vy-border)] px-6 py-4">
            <IconShield size={22} className="text-[var(--vy-accent)]" />
            <div>
              <h1 className="text-lg font-bold">Vyline 利用規約・免責事項</h1>
              <p className="text-xs text-[var(--vy-text-dim)]">ご利用前に必ずお読みください</p>
            </div>
          </div>

          <div className="vy-scroll max-h-[50dvh] space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed">
            <section>
              <h2 className="mb-1 font-semibold">1. 非公式クライアントについて</h2>
              <p>
                Vyline は LINE 株式会社および LY Corporation
                とは一切関係のない、非公式のサードパーティクライアントです。 LINE
                は各社の登録商標です。本アプリは公式アプリの代替を保証するものではなく、
                機能・表示・挙動が公式アプリと異なる場合があります。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">2. 自己責任での利用</h2>
              <p>
                本アプリはライセンス・利用条件に抵触する可能性があるため、
                動作の保証は一切ありません。本アプリを利用したことにより生じたいかなる損害・
                不利益・アカウントの停止・その他のトラブルについても、開発者は一切の責任を負いません。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">3. アカウント・データ</h2>
              <p>
                本アプリは「各ユーザーがご自身の LINE
                アカウントでログインして利用する」ことを前提としています。
                ログイン情報・セッション・暗号鍵・トーク履歴は端末内に保存され、外部へ送信されません。
                アカウントの取り扱いはご自身の責任で行ってください。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">4. ベータ機能について</h2>
              <p>
                設定に表示されるベータ機能は試験的な機能です。機能を有効にする際には、
                機能ごとに追加の説明と同意を表示します。同意記録は端末内に保存します。
                ベータ機能はメッセージ本文を収集せず、確認処理と結果を Vyline
                の外部サービスへ送信しません。 ただし、LINE
                との通常の通信は発生します。以下は法的助言ではありません。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">5. 規約への同意</h2>
              <p>
                下記のチェックボックスを選択して「同意して利用を開始する」を押すことで、
                この画面に表示された内容に同意したことを記録します。同意しない場合は利用を開始しないでください。
              </p>
            </section>
          </div>

          <div className="space-y-3 border-t border-[var(--vy-border)] px-6 py-5">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--vy-accent)]"
              />
              <span>上記の利用規約・免責事項に同意し、自己責任で本アプリを利用します。</span>
            </label>
            <button
              type="button"
              disabled={!checked}
              onClick={agree}
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm font-semibold transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
                checked
                  ? "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]"
                  : "cursor-not-allowed bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]",
              )}
            >
              同意して利用を開始する
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
