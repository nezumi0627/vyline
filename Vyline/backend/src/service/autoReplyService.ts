/**
 * service/autoReplyService.ts — 自動返信（AutoReply）
 *
 * 受信メッセージのたびに ingestPushMessage から呼ばれ、設定に応じて自動返信を送る。
 * ループ・スパム防止のため:
 *  - 自分自身の送信 / 自動返信そのものには反応しない
 *  - チャットごとにクールダウン（既定 30 分）を必ず挟む
 *  - グループ/複数人トークは既定で対象外（`includeGroups` を明示 ON にした場合のみ）
 */

import type { Message } from "@vyline/types";
import { childLogger } from "../logger.js";
import {
	getAutoReplyConfig,
	markAutoReplySent,
} from "../storage/autoReplyStore.js";

const log = childLogger("autoReply");

/** 同一プロセス内での二重発火を防ぐ簡易ロック（mutate の debounce 保存より速く連続着信した場合の保険） */
const inFlight = new Set<string>();

export type AutoReplySender = (
	accountId: string,
	chatMid: string,
	text: string,
) => Promise<unknown>;

/**
 * 受信メッセージに対して自動返信すべきか判定し、必要なら送信する。
 * 送信自体は呼び出し側から渡された `send`（= service.sendMessage）に委譲する
 * （循環 import を避けるため、autoReplyService は lineService を直接 import しない）。
 */
export async function maybeAutoReply(
	accountId: string,
	chatMid: string,
	message: Message,
	send: AutoReplySender,
): Promise<void> {
	try {
		if (message.isMyMessage) return; // 自分の送信には反応しない
		if (!/^[ucr]/.test(chatMid)) return; // トーク以外(通知チャネル等)は対象外

		const isGroupLike = chatMid.startsWith("c") || chatMid.startsWith("r");
		const config = await getAutoReplyConfig(accountId);
		if (!config.enabled) return;
		if (isGroupLike && !config.includeGroups) return;

		const override = config.perChat[chatMid];
		const chatEnabled = override?.enabled ?? true; // グローバル ON の下ではチャット別は「除外」だけ効く
		if (!chatEnabled) return;

		const text = (override?.message ?? config.message ?? "").trim();
		if (!text) return;

		const cooldownMs = Math.max(0, config.cooldownMinutes) * 60_000;
		const last = config.lastRepliedAt[chatMid] ?? 0;
		if (cooldownMs > 0 && Date.now() - last < cooldownMs) return;

		const lockKey = `${accountId}:${chatMid}`;
		if (inFlight.has(lockKey)) return;
		inFlight.add(lockKey);
		try {
			// クールダウンの記録は送信「前」に行い、送信中に届いた別メッセージでの二重送信を防ぐ
			await markAutoReplySent(accountId, chatMid);
			await send(accountId, chatMid, text);
			log.info({ accountId, chatMid }, "auto-reply sent");
		} finally {
			inFlight.delete(lockKey);
		}
	} catch (err) {
		log.warn({ accountId, chatMid, err }, "auto-reply failed");
	}
}
