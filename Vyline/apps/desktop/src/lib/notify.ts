/**
 * lib/notify.ts — デスクトップ通知（Web Notification API）
 *
 * ブラウザでも Electron レンダラーでも同じ標準 API で動作する。
 * Electron 側は main.ts の setPermissionRequestHandler で自ホスト origin の
 * "notifications" 権限を許可済み。
 */

let permissionRequested = false;
let swRegistration: ServiceWorkerRegistration | null = null;
let swRegistering: Promise<ServiceWorkerRegistration | null> | null = null;

export function notificationsSupported(): boolean {
	return typeof window !== "undefined" && "Notification" in window;
}

/**
 * 通知アクションボタン（LEINs/Knot の「通知にコピーアクションを追加」「既読ボタンを追加」相当）は
 * 標準 Notification API では不可で、ServiceWorkerRegistration.showNotification が必要。
 * public/sw.js を登録して使う。登録に失敗してもアプリは引き続き動作（アクションボタンなしの
 * 通常通知にフォールバック）。
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
	if (swRegistration) return swRegistration;
	if (swRegistering) return swRegistering;
	swRegistering = navigator.serviceWorker
		.register("/sw.js")
		.then((reg) => {
			swRegistration = reg;
			return reg;
		})
		.catch(() => null);
	return swRegistering;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | null> {
	if (!notificationsSupported()) return null;
	if (
		Notification.permission === "granted" ||
		Notification.permission === "denied"
	) {
		return Notification.permission;
	}
	if (permissionRequested) return Notification.permission;
	permissionRequested = true;
	try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
}

export interface ShowNotificationOptions {
	body?: string;
	icon?: string;
	tag?: string;
	onClick?: () => void;
}

/** 権限が無ければ何もしない（呼び出し側は結果を待つ必要はない） */
export function showNotification(
	title: string,
	opts: ShowNotificationOptions = {},
): void {
	if (!notificationsSupported() || Notification.permission !== "granted")
		return;
	try {
		const n = new Notification(title, {
			body: opts.body,
			icon: opts.icon,
			tag: opts.tag,
		});
		if (opts.onClick) {
			n.onclick = () => {
				try {
					window.focus();
				} catch {
					/* ignore */
				}
				opts.onClick?.();
				n.close();
			};
		}
	} catch {
		/* 通知に失敗しても致命的ではない */
	}
}

export interface NotificationAction {
	action: string;
	title: string;
}

export interface ActionableNotificationOptions extends ShowNotificationOptions {
	actions?: NotificationAction[];
	/** SW の notificationclick ハンドラがクライアントへ postMessage で渡す付属データ */
	data?: { url?: string; chatId?: string; messageId?: string; text?: string };
}

/**
 * アクションボタン付き通知。Service Worker 登録済みなら registration.showNotification で
 * ボタン付き通知を、未登録/未対応環境ならボタンなしの通常通知に自動フォールバックする。
 */
export async function showActionableNotification(
	title: string,
	opts: ActionableNotificationOptions = {},
): Promise<void> {
	if (!notificationsSupported() || Notification.permission !== "granted") return;
	const reg = await ensureServiceWorker();
	if (reg && "showNotification" in reg) {
		try {
			await reg.showNotification(title, {
				body: opts.body,
				icon: opts.icon,
				tag: opts.tag,
				data: opts.data,
				actions: opts.actions,
			} as NotificationOptions);
			return;
		} catch {
			/* フォールバックへ */
		}
	}
	showNotification(title, opts);
}

/** SW からの通知アクション postMessage を受け取るリスナーを登録（useVylineSync 等から呼ぶ） */
export function onNotificationAction(
	handler: (msg: {
		action: string;
		chatId?: string;
		messageId?: string;
		text?: string;
	}) => void,
): () => void {
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
		return () => undefined;
	}
	const listener = (event: MessageEvent) => {
		if (event.data?.type === "vyline-notification-action") handler(event.data);
	};
	navigator.serviceWorker.addEventListener("message", listener);
	return () => navigator.serviceWorker.removeEventListener("message", listener);
}

/** 通知を出すべき状態か（ウインドウが前面 かつ 対象チャットを見ている、なら不要） */
export function shouldNotifyForChat(
	chatId: string,
	activeChatId: string | null,
): boolean {
	const windowVisible =
		typeof document === "undefined"
			? false
			: document.visibilityState === "visible" && document.hasFocus();
	if (windowVisible && activeChatId === chatId) return false;
	return true;
}
