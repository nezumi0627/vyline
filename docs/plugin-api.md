# Plugin API

最終更新: 2026-05-18

---

## 概要

Vyline のプラグインは ES Modules として実装する。rebuild 不要で runtime に動的ロード可能。

---

## プラグイン構造

```
plugins/my-plugin/
  manifest.json
  index.ts
```

### manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "author": "your-name",
  "description": "プラグインの説明",
  "entry": "index.ts",
  "apiVersion": "1",
  "permissions": ["messages.read", "ui.inject"]
}
```

### index.ts

```typescript
import type { VyPlugin, PluginAPI } from '@vyline/types';

export default {
  name: 'my-plugin',
  version: '1.0.0',
  author: 'your-name',

  onLoad(api: PluginAPI) {
    // プラグイン初期化
    api.events.on('message.received', (msg) => {
      console.log('[my-plugin] received:', msg.text);
    });
  },

  onUnload() {
    // クリーンアップ
  },
} satisfies VyPlugin;
```

---

## Plugin API 型定義

```typescript
interface VyPlugin {
  name: string;
  version: string;
  author: string;
  description?: string;

  onLoad(api: PluginAPI): void | Promise<void>;
  onUnload(): void | Promise<void>;
}

interface PluginAPI {
  ui: UIAPI;
  theme: ThemeAPI;
  message: MessagingAPI;
  events: EventAPI;
  storage: StorageAPI;
  network: NetworkAPI;
  permissions: PermissionsAPI;
}
```

---

## EventAPI

```typescript
interface EventAPI {
  on(event: string, handler: (data: unknown) => void): () => void;
  off(event: string, handler: (data: unknown) => void): void;
  emit(event: string, data: unknown): void;
}
```

**利用可能なイベント:**

```
message.received    ← メッセージ受信
message.sent        ← メッセージ送信
message.edited      ← メッセージ編集
message.deleted     ← メッセージ削除
user.online         ← ユーザーオンライン
user.offline        ← ユーザーオフライン
user.typing         ← タイピング中
theme.changed       ← テーマ変更
plugin.loaded       ← プラグインロード
plugin.unloaded     ← プラグインアンロード
settings.updated    ← 設定更新
```

---

## UIAPI

```typescript
interface UIAPI {
  // サイドバーにアイテム追加
  addSidebarItem(item: SidebarItem): () => void;

  // チャット入力欄にボタン追加
  addChatAction(action: ChatAction): () => void;

  // トースト通知
  toast(message: string, type?: 'info' | 'success' | 'error'): void;

  // モーダル表示
  openModal(content: ReactNode): () => void;
}
```

---

## StorageAPI

プラグインごとに分離されたストレージ。

```typescript
interface StorageAPI {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

---

## ThemeAPI

```typescript
interface ThemeAPI {
  // CSS 変数を上書き
  setVariable(name: string, value: string): void;

  // カスタム CSS を注入
  injectCSS(css: string): () => void;

  // 現在のテーマ取得
  getCurrent(): Theme;
}
```

---

## プラグインのロード・アンロード

```typescript
// backend/plugins/loader.ts
export async function loadPlugin(path: string): Promise<VyPlugin> {
  const mod = await import(path);
  const plugin = mod.default as VyPlugin;
  await plugin.onLoad(createPluginAPI(plugin.name));
  return plugin;
}

export async function unloadPlugin(plugin: VyPlugin): Promise<void> {
  await plugin.onUnload();
}
```

---

## パーミッション

プラグインは `manifest.json` で必要なパーミッションを宣言する。

| パーミッション | 内容 |
|---|---|
| `messages.read` | メッセージ読み取り |
| `messages.send` | メッセージ送信 |
| `ui.inject` | UI 要素の注入 |
| `storage.read` | ストレージ読み取り |
| `storage.write` | ストレージ書き込み |
| `network.fetch` | 外部 HTTP リクエスト |
| `theme.modify` | テーマ変更 |
