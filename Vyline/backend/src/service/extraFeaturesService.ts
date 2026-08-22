/**
 * service/extraFeaturesService.ts — iOS / Desktop 版 LINE の未実装機能を BFF に公開
 *
 * 実装方式: 既存の talk/call/relation サービスメソッド + LINEStruct 汎用 RPC 呼び出し。
 * スタック内部の型を backend の strict プログラムに引き込まないため、
 * 未ラップ RPC は LINEStruct 経由で直接 request する。
 *
 * 注意:
 * - メンバー削除・通報など破壊的操作を含む。**実機テストは未実施**（コメント明記）。
 */

import { LINEStruct } from "@vyline/protocol/stack/thrift";
import type { VylineClient } from "@vyline/protocol";
import { childLogger } from "../logger.js";

const log = childLogger("extra");

type Req = Record<string, unknown>;

/** TalkService 配下の未ラップ RPC を汎用呼び出しする */
async function talkRpc(client: VylineClient, method: string, args: unknown): Promise<unknown> {
  const talk = client.base.talk as unknown as {
    client: {
      request: {
        request(a: unknown, n: string, p: number, flag: boolean, path: string): Promise<unknown>;
      };
    };
    protocolType: number;
    requestPath: string;
  };
  const structFn = (LINEStruct as unknown as Record<string, (p: unknown) => unknown>)[
    `${method}_args`
  ];
  if (!structFn) throw new Error(`unknown rpc: ${method}`);
  return await talk.client.request.request(
    structFn(args),
    method,
    talk.protocolType,
    true,
    talk.requestPath,
  );
}

/* ─── チャット管理 ─────────────────────────────── */

/** メンバー削除（グループ）。※実機テスト未実施 */
export async function deleteChatMember(
  accountId: string,
  client: VylineClient,
  chatMid: string,
  targetMid: string,
): Promise<unknown> {
  const res = await talkRpc(client, "deleteOtherFromChat", {
    request: { chatMid, targetMid },
  });
  log.warn({ accountId, chatMid, targetMid }, "member deleted from chat (untested live)");
  return res;
}

/** 招待キャンセル。※実機テスト未実施 */
export async function cancelChatInvitation(
  accountId: string,
  client: VylineClient,
  chatMid: string,
  inviteeMid: string,
): Promise<unknown> {
  return await talkRpc(client, "cancelChatInvitation", {
    request: { chatMid, inviteeMid },
  });
}

/** Ticket でチャット参加。※実機テスト未実施 */
export async function acceptChatByTicket(
  accountId: string,
  client: VylineClient,
  ticketId: string,
): Promise<unknown> {
  return await talkRpc(client, "acceptChatInvitationByTicket", { request: { ticketId } });
}

/** チャット Ticket 再発行。※実機テスト未実施 */
export async function reissueChatTicket(
  accountId: string,
  client: VylineClient,
  chatMid: string,
): Promise<unknown> {
  return await talkRpc(client, "reissueChatTicket", { request: { chatMid } });
}

/** Ticket でチャット検索（参加前プレビュー）。※実機テスト未実施 */
export async function findChatByTicket(
  accountId: string,
  client: VylineClient,
  ticketId: string,
): Promise<unknown> {
  return await talkRpc(client, "findChatByTicket", { request: { ticketId } });
}

/* ─── 連絡先 ───────────────────────────────────── */

/** MID で友だち追加。※実機テスト未実施 */
export async function addFriendByMid(
  accountId: string,
  client: VylineClient,
  targetMid: string,
): Promise<unknown> {
  return await client.base.relation.addFriendByMid({ mid: targetMid } as never);
}

/** UserID で検索 */
export async function findContactByUserid(
  accountId: string,
  client: VylineClient,
  searchId: string,
): Promise<unknown> {
  return await client.base.talk.findContactByUserid({ searchId });
}

/** 電話番号で検索。※実機テスト未実施 */
export async function findContactsByPhone(
  accountId: string,
  client: VylineClient,
  phones: string[],
): Promise<unknown> {
  return await talkRpc(client, "findContactsByPhone", { phoneNumbers: phones });
}

/** 自分のユーザー Ticket 生成（QR 追加用）。※実機テスト未実施 */
export async function generateUserTicket(
  accountId: string,
  client: VylineClient,
  expirationTime?: number,
  maxUseCount?: number,
): Promise<unknown> {
  return await client.base.talk.generateUserTicket({
    expirationTime: BigInt(expirationTime ?? 0),
    maxUseCount: maxUseCount ?? 0,
  });
}

/** プロフィール通報。※実機テスト未実施 */
export async function reportProfile(
  accountId: string,
  client: VylineClient,
  profile: Req,
  syncOpRevision?: number,
): Promise<unknown> {
  return await talkRpc(client, "reportProfile", {
    syncOpRevision: String(syncOpRevision ?? 0),
    profile,
  });
}

/* ─── グループ通話 URL ─────────────────────────── */

function callSvc(client: VylineClient) {
  return client.base.call as unknown as {
    createGroupCallUrl(p: never): Promise<unknown>;
    deleteGroupCallUrl(p: never): Promise<unknown>;
    getGroupCallUrls(p: never): Promise<unknown>;
    getGroupCallUrlInfo(p: never): Promise<unknown>;
    joinChatByCallUrl(p: never): Promise<unknown>;
    inviteIntoGroupCall(p: never): Promise<unknown>;
    kickoutFromGroupCall(p: never): Promise<unknown>;
    acquireOACallRoute(p: never): Promise<unknown>;
  };
}

export async function createGroupCallUrl(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).createGroupCallUrl({ request } as never);
}

export async function deleteGroupCallUrl(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).deleteGroupCallUrl({ request } as never);
}

export async function getGroupCallUrls(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).getGroupCallUrls({ request } as never);
}

export async function getGroupCallUrlInfo(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).getGroupCallUrlInfo({ request } as never);
}

export async function joinChatByCallUrl(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).joinChatByCallUrl({ request } as never);
}

export async function inviteIntoGroupCall(
  accountId: string,
  client: VylineClient,
  chatMid: string,
  memberMids: string[],
): Promise<unknown> {
  return await callSvc(client).inviteIntoGroupCall({ chatMid, memberMids } as never);
}

export async function kickoutFromGroupCall(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await callSvc(client).kickoutFromGroupCall({
    kickoutFromGroupCallRequest: request,
  } as never);
}

/* ─── E2EE 鍵バックアップ（LINEStruct 汎用・/EKBS4） ── */

async function ekbsRpc(client: VylineClient, method: string, args: unknown): Promise<unknown> {
  const talk = client.base.talk as unknown as {
    client: {
      request: {
        request(a: unknown, n: string, p: number, flag: boolean, path: string): Promise<unknown>;
      };
    };
    protocolType: number;
  };
  const structFn = (LINEStruct as unknown as Record<string, (p: unknown) => unknown>)[
    `${method}_args`
  ];
  if (!structFn) throw new Error(`unknown rpc: ${method}`);
  // E2EEKeyBackupService 準拠: protocolType=4, path=/EKBS4
  return await talk.client.request.request(structFn(args), method, 4, true, "/EKBS4");
}

export async function getE2EEKeyBackupInfo(
  accountId: string,
  client: VylineClient,
): Promise<unknown> {
  return await ekbsRpc(client, "getE2EEKeyBackupInfo", {});
}

export async function getE2EEKeyBackupCertificates(
  accountId: string,
  client: VylineClient,
): Promise<unknown> {
  return await ekbsRpc(client, "getE2EEKeyBackupCertificates", {});
}

export async function createE2EEKeyBackup(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await ekbsRpc(client, "createE2EEKeyBackupEnforced", { request });
}

export async function deleteE2EEKeyBackup(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  return await ekbsRpc(client, "deleteE2EEKeyBackup", { request });
}

/* ─── サブスク（OA Membership /LOMS4? は service 定義に従う） ── */

function membershipSvc(client: VylineClient) {
  return client.base as unknown as {
    oamembership?: {
      activateSubscription(p: never): Promise<unknown>;
      getJoinedMembership(): Promise<unknown>;
    };
  };
}

export async function activateSubscription(
  accountId: string,
  client: VylineClient,
  request: Req,
): Promise<unknown> {
  const svc = membershipSvc(client).oamembership;
  if (!svc) throw new Error("oamembership service not available on this build");
  return await svc.activateSubscription({ request } as never);
}
