import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { IconShield } from "@/components/icons";
import { setTosConsent } from "@/lib/tosConsent";
import { useStore } from "@/lib/store";

/**
 * 利用規約への明示同意ゲート。本文を改訂した場合は同意バージョンも更新する。
 */
export function TosConsentGate({ onConsent }: { onConsent: () => void }) {
  const [checked, setChecked] = useState(false);
  const [aiChecked, setAiChecked] = useState(() => {
    try {
      return (
        localStorage.getItem("vyline:agent-i-terms-v1") === "1" &&
        localStorage.getItem("vyline:ai-enabled-v1") !== "0"
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && checked) agree();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, aiChecked]);

  const agree = async () => {
    try {
      if (aiChecked) {
        localStorage.setItem("vyline:agent-i-terms-v1", "1");
        localStorage.setItem("vyline:ai-enabled-v1", "1");
      } else {
        localStorage.removeItem("vyline:agent-i-terms-v1");
        localStorage.setItem("vyline:ai-enabled-v1", "0");
      }
    } catch {
      /* The app setting remains the session fallback. */
    }
    useStore.getState().updateSetting("aiEnabled", aiChecked);
    await setTosConsent();
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
              <h2 className="mb-1 font-semibold">1. Vylineについて</h2>
              <p>
                VylineはLINEヤフー株式会社が提供・承認するアプリではない、非公式のサードパーティクライアントです。LINEは各社の商標です。公式LINEアプリとは機能・表示・動作が異なり、LINE側の仕様変更により一部機能が利用できなくなる場合があります。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">2. アカウントと外部サービス</h2>
              <p>
                ご自身が利用権限を持つLINEアカウントのみを使用してください。VylineはLINEのサーバーと通信してログイン、同期、メッセージ送受信などを行います。LINEの利用規約・ポリシーが適用され、Vylineの利用によってアカウントや機能が制限される可能性があります。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">3. 保存するデータと同期</h2>
              <p>
                アカウント情報、セッション、暗号鍵、トーク履歴、設定、キャッシュなどはVylineのデータ領域に保存されます。保存場所やバックアップ先は利用環境の設定に従います。LINEとの同期・送受信時には、処理に必要な情報がLINEへ送られます。バックアップやサポート資料は、内容を確認したうえで利用者自身が作成・共有してください。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">4. AI機能（Agent I）</h2>
              <p>
                文章校正・翻訳・要約・サポートBotなどでAIを実行すると、入力内容と機能の実行に必要な会話文脈が、回答生成のためYahooのAgent
                Iへ送信されます。トーク本文は利用者が選択・入力した場合に限って送信され、AIからLINEへ自動送信はしません。初回利用時に追加確認を表示します。AIを使わない場合は「設定
                ＞ 表示 ＞
                AI機能」をOFFにしてください。OFFにするとAI機能のボタンを隠し、AI問い合わせを停止します。再度ONにすると利用できます。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">5. ベータ・外部連携機能</h2>
              <p>
                ベータ機能は試験的なもので、仕様が変更または終了する場合があります。ベータ画面に個別の説明や同意が表示される場合は、その内容も確認してください。GitHub、Discord、Yahooなど外部サービスを利用・共有する場合は、それぞれのサービスの規約とプライバシー条件が適用されます。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">6. 提供・変更・免責</h2>
              <p>
                Vylineは現状有姿で提供され、常時の稼働、データの完全性、特定機能の継続を保証しません。通信障害、仕様変更、端末故障、利用者の操作などによるデータ消失や利用上の問題に備え、必要なバックアップを利用者自身で保管してください。法令上許される範囲を超えて責任を免除するものではありません。
              </p>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">7. 同意と改訂</h2>
              <p>
                下記にチェックして利用を開始すると、この版の規約への同意が端末に記録されます。同意しない場合はVylineを利用できません。重要な改訂時には、改訂版を再表示して同意を確認します。
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
              <span>上記の利用規約を読み、同意してVylineを利用します。</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3 text-sm">
              <input
                type="checkbox"
                checked={aiChecked}
                onChange={(e) => setAiChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--vy-accent)]"
              />
              <span>
                <span className="block font-medium">Agent IのAI機能を有効にする（任意）</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--vy-text-dim)]">
                  入力した文章や明示的に選んだトーク本文がYahooのAgent
                  Iへ送信されます。チェックを外してもVylineを利用でき、AI機能は設定から後で有効にできます。
                </span>
              </span>
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
