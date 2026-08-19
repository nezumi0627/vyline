/**
 * autoReplyStore.ts — 自動返信（AutoReply）設定の永続化
 *
 * アカウント単位でグローバル設定 + チャット別上書きを保持する。
 * 実際の送信判定・クールダウン制御は service/autoReplyService.ts が行う。
 */

import { VylineStorage } from "./vylineStorage.js";

export type AutoReplyChatOverride = {
	/** 未指定ならグローバル enabled に従う */
	enabled?: boolean;
	/** 未指定ならグローバル message を使う */
	message?: string;
};

export type AutoReplyConfig = {
	version: 1;
	/** グローバル有効フラグ */
	enabled: boolean;
	/** 既定の返信文 */
	message: string;
	/** 同一チャットへの連投を防ぐクールダウン（分） */
	cooldownMinutes: number;
	/** グループ/複数人トークにも自動返信するか（既定 off — 誤爆防止） */
	includeGroups: boolean;
	/** チャット別の有効/文面の上書き */
	perChat: Record<string, AutoReplyChatOverride>;
	/** chatMid → 直近自動返信時刻 (epoch ms)。クールダウン判定に使用 */
	lastRepliedAt: Record<string, number>;
};

function emptyConfig(): AutoReplyConfig {
	return {
		version: 1,
		enabled: false,
		message: "現在自動返信中です。しばらくしてから返信します。",
		cooldownMinutes: 30,
		includeGroups: false,
		perChat: {},
		lastRepliedAt: {},
	};
}

const storage = new VylineStorage<AutoReplyConfig>("autoreply", emptyConfig);

export type AutoReplyConfigPatch = Partial<
	Pick<
		AutoReplyConfig,
		"enabled" | "message" | "cooldownMinutes" | "includeGroups"
	>
>;

export async function getAutoReplyConfig(
	accountId: string,
): Promise<AutoReplyConfig> {
	return storage.load(accountId);
}

export async function updateAutoReplyConfig(
	accountId: string,
	patch: AutoReplyConfigPatch,
): Promise<AutoReplyConfig> {
	return storage.mutate(accountId, (data) => {
		if (patch.enabled !== undefined) data.enabled = patch.enabled;
		if (patch.message !== undefined) data.message = patch.message;
		if (patch.cooldownMinutes !== undefined) {
			data.cooldownMinutes = Math.max(
				0,
				Math.min(24 * 60, patch.cooldownMinutes),
			);
		}
		if (patch.includeGroups !== undefined)
			data.includeGroups = patch.includeGroups;
	});
}

export async function setAutoReplyChatOverride(
	accountId: string,
	chatMid: string,
	override: AutoReplyChatOverride | null,
): Promise<AutoReplyConfig> {
	return storage.mutate(accountId, (data) => {
		if (override === null) {
			delete data.perChat[chatMid];
		} else {
			data.perChat[chatMid] = { ...data.perChat[chatMid], ...override };
		}
	});
}

export async function markAutoReplySent(
	accountId: string,
	chatMid: string,
): Promise<void> {
	await storage.mutate(accountId, (data) => {
		data.lastRepliedAt[chatMid] = Date.now();
	});
}

export function flushAutoReplyStore(): Promise<void> {
	return storage.flushAll();
}
