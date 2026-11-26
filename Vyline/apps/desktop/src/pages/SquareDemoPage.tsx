import { useEffect } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { SquareChatPane } from "@/components/square-chat-pane";
import { ThemeApplier } from "@/components/theme-applier";
import { demoSettings } from "@/demo/demoData";

const MY_MID = "sqm0000000000000000000000000000001";
const M_NEKO = "sqm0000000000000000000000000000002";
const M_USA = "sqm0000000000000000000000000000003";
const M_KUMA = "sqm0000000000000000000000000000004";

const DEMO_ROOM = { id: "sqc0000000000000000000000000000001", name: "雑談ルーム" };

const day = 24 * 60 * 60 * 1000;
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const now = Date.now();

const DEMO_MESSAGES = [
  {
    message: {
      id: "m01",
      from: M_NEKO,
      text: "昨日の定例のメモ、ノートにまとめておきました",
      createdTime: now - day - hour,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m02",
      from: M_NEKO,
      text: "あとで確認しておいてください",
      createdTime: now - day - hour + 2 * minute,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m03",
      from: MY_MID,
      text: "ありがとうございます！見ておきます",
      createdTime: now - day - hour + 5 * minute,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m04",
      from: M_USA,
      text: "おはようございます",
      createdTime: now - 3 * hour,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m05",
      from: MY_MID,
      text: "おはようございます！今日はリリース日ですね",
      createdTime: now - 3 * hour + minute,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m06",
      from: MY_MID,
      text: "夕方までに確認お願いします",
      createdTime: now - 3 * hour + 2 * minute,
      contentType: "NONE",
    },
  },
  {
    message: {
      id: "m07",
      from: M_KUMA,
      createdTime: now - 2 * hour,
      contentType: "STICKER",
      contentMetadata: { STKID: "28935363", STKPKGID: "2000006" },
    },
  },
  {
    message: {
      id: "m08",
      from: M_NEKO,
      text: "新機能のフィードバックはスレッドに集約します",
      createdTime: now - hour,
      contentType: "NONE",
    },
    threadInfo: { chatThreadMid: "th000000000000000000000000000001", threadRoot: true },
  },
];

const DEMO_MEMBERS = [
  { squareMemberMid: MY_MID, displayName: "ねずみ", role: 1 },
  { squareMemberMid: M_NEKO, displayName: "ねこ", role: 0 },
  { squareMemberMid: M_USA, displayName: "うさぎ", role: 0 },
  { squareMemberMid: M_KUMA, displayName: "くま", role: 2 },
];

/** OpenChat(Square) の見た目確認用デモ。accountId は使わず API をモックに差し替える。 */
export function SquareDemoPage() {
  useEffect(() => {
    const line = api.line as unknown as Record<string, unknown>;
    const original = {
      squareMessages: line.squareMessages,
      squareMembers: line.squareMembers,
      squareAnnouncements: line.squareAnnouncements,
      squareInvitation: line.squareInvitation,
      squareThreadContext: line.squareThreadContext,
    };
    Object.assign(line, {
      squareMessages: async () => ({
        ok: true,
        roomId: DEMO_ROOM.id,
        mySquareMemberMid: MY_MID,
        messages: DEMO_MESSAGES,
        continuationToken: null,
        threadMid: null,
      }),
      squareMembers: async () => ({ members: DEMO_MEMBERS, continuationToken: null }),
      squareAnnouncements: async () => ({ announcements: [] }),
      squareInvitation: async () => ({ invitationURL: "https://line.me/ti/g2/demo" }),
      squareThreadContext: async () => ({ membershipState: 1 }),
    });
    useStore.setState({
      demoMode: true,
      accountId: "demo",
      settings: { ...demoSettings, streamerMode: false },
      showUpdateNote: false,
    });
    return () => {
      Object.assign(line, original);
      useStore.setState({ demoMode: false, accountId: null, showUpdateNote: false });
    };
  }, []);

  return (
    <main className="pr-demo-stage relative h-dvh overflow-hidden text-[var(--vy-text)]">
      <ThemeApplier />
      <div className="pointer-events-none fixed right-6 top-5 z-50 rounded-full border border-emerald-300/30 bg-emerald-950/90 px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide text-emerald-100 shadow-xl backdrop-blur">
        DEMO MODE ON · 仮データのみ · 実アカウント接続なし
      </div>
      <div className="pr-demo-shell relative h-full overflow-hidden rounded-[22px] border border-white/15 bg-[var(--vy-bg)] shadow-[0_28px_80px_rgba(15,23,42,0.42)]">
        <SquareChatPane room={DEMO_ROOM} squareName="ねずみスクエア" onBack={() => {}} />
      </div>
    </main>
  );
}
