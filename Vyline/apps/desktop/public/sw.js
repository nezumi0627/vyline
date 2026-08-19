/**
 * sw.js — Vyline 通知アクション用の最小 Service Worker
 *
 * LEINs/Knot の「通知にコピーアクションを追加」「通知に既読ボタンを追加」相当。
 * Web Push は使わない（push サーバーなし）。既存のポーリング同期から
 * `registration.showNotification(title, { actions, data })` を呼ぶことで
 * OS 通知にボタンを追加し、クリックされたら postMessage で開いているタブへ
 * アクション種別を伝える（このシンプルな設計は SW 自身が API を叩く必要をなくす）。
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function focusOrOpenClient(url) {
  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) {
    if ("focus" in client) {
      await client.focus();
      client.postMessage({ type: "vyline-notification-action", action: "focus", url });
      return client;
    }
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(url ?? "/");
  }
  return null;
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action || "open";
  notification.close();

  event.waitUntil(
    (async () => {
      const client = await focusOrOpenClient(data.url ?? "/");
      // クライアント（メインアプリ）へアクション種別を伝える。
      // 実処理（既読 API 呼び出し・クリップボードへコピー等）はフォーカス済みの
      // メインアプリ側（DOM/clipboard 権限があるコンテキスト）で行う。
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of allClients) {
        c.postMessage({
          type: "vyline-notification-action",
          action,
          chatId: data.chatId,
          messageId: data.messageId,
          text: data.text,
        });
      }
      return client;
    })(),
  );
});
