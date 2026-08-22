/**
 * service/extraFeaturesService.ts — iOS / Desktop 版 LINE の未実装機能を BFF に公開（型付き）
 *
 * リクエスト/レスポンスは @vyline/line-types の Thrift 定義に準拠する。
 * 実装方式: 既存 talk/call/relation サービスメソッド + LINEStruct 汎用 RPC 呼び出し。
 *
 * 注意:
 * - メンバー削除・通報など破壊的操作を含む。**実機テストは未実施**（コメント明記）。
 */

import { LINEStruct } from "@vyline/protocol/stack/thrift";
import type { VylineClient } from "@vyline/protocol";
import { childLogger } from "../logger.js";

const log = childLogger("extra");

/* ─── 公開リクエスト型（BFF API コントラクト） ─── */

export interface DeleteChatMemberRequest {
  chatMid: string;
  /** 削除するメンバーの MID 配列 */
  targetUserMids: string[];
}

export interface CancelChatInvitationRequest {
  chatMid: string;
  /** 招待を取り消す対象の MID 配列 */
  targetUserMids: string[];
}

export interface AcceptChatByTicketRequest {
  chatMid: string;
  ticketId: string;
}

export interface ReissueChatTicketRequest {
  groupMid: string;
}

export interface FindChatByTicketRequest {
  ticketId: string;
}

export interface AddFriendByMidRequest {
  userMid: string;
  reference?: string;
}

export interface FindContactsByPhoneRequest {
  phoneNumbers: string[];
}

export interface GenerateUserTicketRequest {
  /** UNIX 秒。0 = 無期限 */
  expirationTime?: number;
  /** 最大使用回数。0 = 無制限 */
  maxUseCount?: number;
}

export interface ReportProfileRequest {
  profile: Record<string, unknown>;
  syncOpRevision?: number;
}

export interface CreateGroupCallUrlRequest {
  title: string;
}

export interface JoinChatByCallUrlRequest {
  urlId: string;
}

export interface InviteIntoGroupCallRequest {
  chatMid: string;
  memberMids: string[];
  /** AUDIO / VIDEO / LIVE / PHOTOBOOTH（既定 AUDIO） */
  mediaType?: "AUDIO" | "VIDEO" | "LIVE" | "PHOTOBOOTH";
}

export interface KickoutFromGroupCallRequest {
  chatMid: string;
  targetMids: string[];
}

export interface E2EEBackupOperationRequest {
  /** E2EEKeyBackup サービスの request オブジェクト（Pb1_* 生成型） */
  [key: string]: unknown;
}

/* ─── 内部ヘルパー ─────────────────────────────── */

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

async function nextReqSeq(client: VylineClient): Promise<number> {
  return await client.base.getReqseq();
}

/* ─── チャット管理 ─────────────────────────────── */

/** メンバー削除（グループ）。※実機テスト未実施 */
export async function deleteChatMember(
  accountId: string,
  client: VylineClient,
  req: DeleteChatMemberRequest,
): Promise<unknown> {
  const res = await talkRpc(client, "deleteOtherFromChat", {
    reqSeq: await nextReqSeq(client),
    chatMid: req.chatMid,
    targetUserMids: req.targetUserMids,
  });
  log.warn({ accountId, ...req }, "member deleted from chat (untested live)");
  return res;
}

/** 招待キャンセル。※実機テスト未実施 */
export async function cancelChatInvitation(
  accountId: string,
  client: VylineClient,
  req: CancelChatInvitationRequest,
): Promise<unknown> {
  return await talkRpc(client, "cancelChatInvitation", {
    reqSeq: await nextReqSeq(client),
    chatMid: req.chatMid,
    targetUserMids: req.targetUserMids,
  });
}

/** Ticket でチャット参加。※実機テスト未実施 */
export async function acceptChatByTicket(
  accountId: string,
  client: VylineClient,
  req: AcceptChatByTicketRequest,
): Promise<unknown> {
  return await talkRpc(client, "acceptChatInvitationByTicket", {
    reqSeq: await nextReqSeq(client),
    chatMid: req.chatMid,
    ticketId: req.ticketId,
  });
}

/** チャット Ticket 再発行。※実機テスト未実施 */
export async function reissueChatTicket(
  accountId: string,
  client: VylineClient,
  req: ReissueChatTicketRequest,
): Promise<{ ticketId: string }> {
  const res = (await talkRpc(client, "reissueChatTicket", {
    reqSeq: await nextReqSeq(client),
    groupMid: req.groupMid,
  })) as { ticketId?: string };
  log.info({ accountId, groupMid: req.groupMid }, "chat ticket reissued");
  return { ticketId: String(res?.ticketId ?? "") };
}

/** Ticket でチャット検索（参加前プレビュー）。※実機テスト未実施 */
export async function findChatByTicket(
  accountId: string,
  client: VylineClient,
  req: FindChatByTicketRequest,
): Promise<unknown> {
  return await talkRpc(client, "findChatByTicket", { ticketId: req.ticketId });
}

/* ─── 連絡先 ───────────────────────────────────── */

/** MID で友だち追加。※実機テスト未実施 */
export async function addFriendByMid(
  accountId: string,
  client: VylineClient,
  req: AddFriendByMidRequest,
): Promise<unknown> {
  return await client.base.relation.addFriendByMid({
    mid: req.userMid,
    ...(req.reference !== undefined ? { reference: req.reference } : {}),
  } as never);
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
  req: FindContactsByPhoneRequest,
): Promise<unknown> {
  return await talkRpc(client, "findContactsByPhone", {
    phoneNumbers: req.phoneNumbers,
  });
}

/** 自分のユーザー Ticket 生成（QR 追加用）。※実機テスト未実施 */
export async function generateUserTicket(
  accountId: string,
  client: VylineClient,
  req: GenerateUserTicketRequest,
): Promise<unknown> {
  return await client.base.talk.generateUserTicket({
    expirationTime: BigInt(req.expirationTime ?? 0),
    maxUseCount: req.maxUseCount ?? 0,
  });
}

/** プロフィール通報。※実機テスト未実施 */
export async function reportProfile(
  accountId: string,
  client: VylineClient,
  req: ReportProfileRequest,
): Promise<unknown> {
  return await talkRpc(client, "reportProfile", {
    syncOpRevision: String(req.syncOpRevision ?? 0),
    profile: req.profile,
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
    inviteIntoGroupCall(p: never): Promise<void>;
    kickoutFromGroupCall(p: never): Promise<unknown>;
    acquireOACallRoute(p: never): Promise<unknown>;
  };
}

export async function createGroupCallUrl(
  accountId: string,
  client: VylineClient,
  req: CreateGroupCallUrlRequest,
): Promise<{ url: unknown }> {
  const res = (await callSvc(client).createGroupCallUrl({
    request: { title: req.title },
  } as never)) as {
    url?: unknown;
  };
  return { url: res.url ?? res };
}

export async function deleteGroupCallUrl(
  accountId: string,
  client: VylineClient,
  request: { urlId: string },
): Promise<unknown> {
  return await callSvc(client).deleteGroupCallUrl({ request } as never);
}

export async function getGroupCallUrls(accountId: string, client: VylineClient): Promise<unknown> {
  // Pb1_C13042j5 は空構造（サーバ側で全件返却）
  return await callSvc(client).getGroupCallUrls({ request: {} } as never);
}

export async function getGroupCallUrlInfo(
  accountId: string,
  client: VylineClient,
  request: { urlId: string },
): Promise<unknown> {
  return await callSvc(client).getGroupCallUrlInfo({ request } as never);
}

export async function joinChatByCallUrl(
  accountId: string,
  client: VylineClient,
  req: JoinChatByCallUrlRequest,
): Promise<unknown> {
  return await callSvc(client).joinChatByCallUrl({
    request: { urlId: req.urlId, reqSeq: await nextReqSeq(client) },
  } as never);
}

export async function inviteIntoGroupCall(
  accountId: string,
  client: VylineClient,
  req: InviteIntoGroupCallRequest,
): Promise<void> {
  return await callSvc(client).inviteIntoGroupCall({
    chatMid: req.chatMid,
    memberMids: req.memberMids,
    ...(req.mediaType ? { mediaType: req.mediaType } : { mediaType: "AUDIO" }),
  } as never);
}

export async function kickoutFromGroupCall(
  accountId: string,
  client: VylineClient,
  req: KickoutFromGroupCallRequest,
): Promise<unknown> {
  return await callSvc(client).kickoutFromGroupCall({
    kickoutFromGroupCallRequest: { chatMid: req.chatMid, targetMids: req.targetMids },
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
  req: E2EEBackupOperationRequest,
): Promise<unknown> {
  return await ekbsRpc(client, "createE2EEKeyBackupEnforced", { request: req });
}

export async function deleteE2EEKeyBackup(
  accountId: string,
  client: VylineClient,
  req: E2EEBackupOperationRequest,
): Promise<unknown> {
  return await ekbsRpc(client, "deleteE2EEKeyBackup", { request: req });
}

/* ─── サブスク（OA Membership） ────────────────── */

export async function activateSubscription(
  accountId: string,
  client: VylineClient,
  req: { uniqueKey: string; activeStatus?: number },
): Promise<unknown> {
  const base = client.base as unknown as {
    oamembership?: {
      activateSubscription(p: never): Promise<unknown>;
      getJoinedMembership(): Promise<unknown>;
    };
  };
  const svc = base.oamembership;
  if (!svc) throw new Error("oamembership service not available on this build");
  return await svc.activateSubscription({
    request: {
      uniqueKey: req.uniqueKey,
      ...(req.activeStatus !== undefined ? { activeStatus: req.activeStatus } : {}),
    },
  } as never);
}
