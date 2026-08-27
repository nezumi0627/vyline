/**
 * service/noteService.ts — LINE ノート（VOOM/Timeline）操作の BFF ロジック
 *
 * プロトコル: packages/protocol/stack/base/timeline/mod.ts (client.base.timeline)
 * homeId はユーザーホームなら u<mid>、グループノートなら g<id>。
 */

import type { VylineClient } from "@vyline/protocol";
import { childLogger } from "../logger.js";

const log = childLogger("note");

export async function listNotes(
  accountId: string,
  client: VylineClient,
  homeId: string,
): Promise<unknown> {
  return await client.base.timeline.listPost({ homeId, sourceType: "TALKROOM" });
}

export async function createNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  text: string,
): Promise<unknown> {
  const res = await client.base.timeline.createPost({ homeId, text, readPermissionType: "ALL" });
  log.info({ accountId, homeId }, "note created");
  return res;
}

export async function getNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.getPost({ homeId, postId });
}

export async function deleteNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  const res = await client.base.timeline.deletePost({ homeId, postId });
  log.info({ accountId, homeId, postId }, "note deleted");
  return res;
}

export async function shareNoteToChat(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
  chatMid: string,
): Promise<unknown> {
  return await client.base.timeline.sharePost({ postId, chatMid, homeId });
}

export async function updateNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  input: Parameters<VylineClient["base"]["timeline"]["updatePost"]>[0],
): Promise<unknown> {
  return await client.base.timeline.updatePost({ ...input, homeId, postId });
}

export async function likeNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  likeType?: "1001" | "1002" | "1003" | "1004" | "1005" | "1006",
): Promise<unknown> {
  return await client.base.timeline.likePost({
    contentId: postId,
    homeId,
    ...(likeType ? { likeType } : {}),
  });
}

export async function commentNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  commentText: string,
): Promise<unknown> {
  return await client.base.timeline.createComment({ contentId: postId, homeId, commentText });
}
