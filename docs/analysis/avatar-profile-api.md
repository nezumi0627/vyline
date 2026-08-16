# avatar / profile API — 調査メモ

連絡先・グループのアバターとプロフィールが、現状どう取得・表示されているかの棚卸し。  
ギャップ（グループ写真・チャット一覧アイコン・クリックでプロフィール）と、実装時に触るファイル／関数をまとめる。

---

## 結論（現状）

| 面 | 状態 |
|---|---|
| 自分プロフィール（Sidebar 上部） | 動く。`GET /profile` → `thumbnailUrl` / `picturePath` |
| 相手コンタクトプロフィール API | 動く。`GET /contact/:targetMid`（`u*` / `c*` / `r*`） |
| メッセージ行アバター | 動く（lazy）。`avatarCache` + `fetchAvatar` |
| チャットヘッダー（direct） | 部分的。cache にあれば表示。選択時の prefetch なし |
| チャットヘッダー（group/room） | **欠落**。常にイニシャル / `"G"` |
| チャット一覧アイコン | **欠落**。常にイニシャル色丸 |
| アバタークリック → プロフィール UI | **欠落**。クリックハンドラなし |

---

## Backend endpoints

定義: `Vyline/backend/src/api/line.ts`  
実装: `Vyline/backend/src/service/lineService.ts`

### `GET /line/:accountId/profile`

自分のプロフィール。

- Handler: `lineRouter.get("/:accountId/profile")`
- Service: `fetchProfile(accountId)` → `client.base.talk.getProfile()`
- Response:

```ts
{ ok: true, profile: LineProfile }
// or { ok: false, error: string }  // 401 not logged in / 500
```

### `GET /line/:accountId/contact/:targetMid`

相手ユーザー **または** グループ／ルームのプロフィール（アイコン用）。

- Handler: `lineRouter.get("/:accountId/contact/:targetMid")`
- Service: `fetchContactProfile(accountId, targetMid)`
  - `targetMid` が `u` 始まり → `client.getUser(targetMid)`  
    `raw.targetProfileDetail.pictureStatus` → `pictureStatusToUrl`
  - それ以外（`c` / `r`）→ `client.getChat(targetMid)`  
    `rawChat.pictureStatus` → `pictureStatusToUrl`
- Response:

```ts
{ ok: true, profile: LineProfile }
// 404: { ok: false, error: "contact not found" }
```

### `GET /line/:accountId/chats`

チャット一覧。**アバター URL は含まない。**

- Service: `fetchChats` → `Chat[]`（`mid`, `name`, `hasMessages`, `kind`, `lastMessageTime` のみ）

### ヘルパー

```ts
// lineService.ts
pictureStatusToUrl(s): string | null
// → https://profile.line-scdn.net/${pictureStatus}
```

グループ写真用の専用 endpoint は **無い**。グループも `/contact/:chatMid` 経由で足りる設計。

---

## API / 型 shapes

共有型: `Vyline/packages/types/src/index.ts`

```ts
interface LineProfile {
  mid: string;
  userid: string;
  displayName: string;
  phoneticName: string;
  pictureStatus: string;
  thumbnailUrl: string;   // 実画像 URL（CDN）
  statusMessage: string;
  picturePath: string;    // "/profile/.../vp/..." 形式。contact 経路では常に ""
  musicProfile: string;
  videoProfile: string;
  profileId: string;
}

interface Chat {
  mid: string;
  name: string;
  hasMessages: boolean;
  kind: "group" | "room" | "direct" | "unknown";
  lastMessageTime: number;
  // ※ thumbnailUrl なし
}

type ProfileResponse = { ok: true; profile: LineProfile } | { ok: false; error: string };
type ChatsResponse = { ok: true; chats: Chat[] } | { ok: false; error: string };
```

### `fetchContactProfile` が埋めるフィールド（実装上）

| フィールド | user (`u*`) | group/room |
|---|---|---|
| `mid` | `targetUserMid` | `chatMid` |
| `displayName` | overriddenName \|\| profileName | `chat.name` |
| `thumbnailUrl` | from `pictureStatus` | from `pictureStatus` |
| `pictureStatus` | yes | yes |
| `statusMessage` | yes | `""` |
| `profileId` | yes | `""` |
| `picturePath` | 常に `""` | 常に `""` |
| `userid` / `phoneticName` / music / video | `""` | `""` |

Frontend client: `api.line.contactProfile(accountId, targetMid)`  
→ `Vyline/apps/desktop/src/api/client.ts`

---

## Frontend: avatarCache / fetchAvatar / ProfilePanel

### `useLineData` — `Vyline/apps/desktop/src/hooks/useLineData.ts`

- State: `avatarCache: Map<string, string>`（mid → thumbnailUrl）
- Guard: `avatarFetching: Ref<Set<string>>`
- `fetchAvatar(mid)`:
  1. accountId なし / 既に cache / in-flight → return
  2. `api.line.contactProfile(accountId, mid)`
  3. `res.profile.thumbnailUrl` があれば Map にセット
- アカウント切替で cache クリア

### 配線

```
HomePage
  ├─ useLineData → avatarCache, fetchAvatar
  ├─ Sidebar → ProfilePanel（自分のみ。avatarCache 非使用）
  └─ ChatArea
       ├─ ChatHeader ← chatAvatarUrl（direct のみ HomePage で cache 参照）
       └─ MessageList → MessageItem
            └─ useEffect → onFetchAvatar(message.from)
```

### `ProfilePanel` — `Vyline/apps/desktop/src/components/sidebar/ProfilePanel.tsx`

- **自分**の表示専用（サイドバー上部）
- `resolveAvatarUrl(profile)`:
  - `thumbnailUrl` 優先
  - なければ `https://profile.line-scdn.net${picturePath}`
- 相手／グループのドロワーではない

### `MessageItem` — アバター表示あり・クリックなし

- `onFetchAvatar(message.from)` で lazy fetch
- `<img>` or `"?"` フォールバック。`onClick` なし

### `ChatListItem` — イニシャルのみ

- 内部 `Avatar({ kind, name })` が色付き丸 + 頭文字
- `avatarUrl` / `avatarCache` props なし

### `ChatHeader`

- `avatarUrl` があれば画像、なければ `G` / 頭文字
- HomePage が `chatAvatarUrl` を渡すのは **`kind === "direct"` のみ**
- group/room は常に null → イニシャル
- 選択チャット mid への `fetchAvatar` 呼び出しなし（メッセージ送信者経由で偶然埋まるだけ）

---

## Gaps

### 1. グループ写真

- Backend: `fetchContactProfile` は `getChat` + `pictureStatus` で対応済み
- Frontend:
  - ChatHeader: group の `chatAvatarUrl` を渡していない
  - ChatList: 一覧に画像なし
  - 選択時に `fetchAvatar(chatMid)` していない

### 2. チャット一覧アイコン

- `Chat` 型に `thumbnailUrl` なし
- `fetchChats` が pictureStatus を読まない（N+1 回避のため未実装と思われる）
- `ChatList` / `ChatListItem` が cache を受け取らない

選択肢:

- A. 一覧表示時に visible mid へ `fetchAvatar` をバッチ（既存 `/contact`）
- B. `fetchChats` / `Chat` に `thumbnailUrl` を載せる（backend 変更）

### 3. クリック → プロフィールパネル（Desktop 風）

現状:

- アバターに `onClick` なし
- 相手用ドロワー／モーダルコンポーネントなし
- `ProfilePanel` は自分用固定

必要な情報はほぼ `LineProfile`（`displayName`, `statusMessage`, `thumbnailUrl`, `mid`, `profileId`）で足りる。  
グループは `statusMessage` 空・メンバー一覧 API は未配線。

---

## 変更候補（ファイル + 関数）

### 1. ChatListItem に実アバター画像

| ファイル | 触る関数 / 箇所 |
|---|---|
| `Vyline/packages/types/src/index.ts` | `Chat` に任意で `thumbnailUrl?: string`（方針 B の場合） |
| `Vyline/backend/src/service/lineService.ts` | `fetchChats` — users/chats から pictureStatus → URL（方針 B） |
| `Vyline/apps/desktop/src/hooks/useLineData.ts` | `fetchAvatar` / 新規 `prefetchAvatars(mids)`（方針 A） |
| `Vyline/apps/desktop/src/pages/HomePage.tsx` | `avatarCache` / `fetchAvatar` を Sidebar へ渡す |
| `Vyline/apps/desktop/src/components/layout/Sidebar.tsx` | props 追加 → `ChatList` へ転送 |
| `Vyline/apps/desktop/src/components/sidebar/ChatList.tsx` | `avatarCache`, `onFetchAvatar` を受け `ChatListItem` へ |
| `Vyline/apps/desktop/src/components/sidebar/ChatListItem.tsx` | `Avatar` — `avatarUrl` 対応、mount 時 `onFetchAvatar(chat.mid)` |

### 2. MessageItem アバター（強化）

現状は表示＋ lazy fetch 済み。追加作業:

| ファイル | 触る関数 / 箇所 |
|---|---|
| `Vyline/apps/desktop/src/components/chat/MessageItem.tsx` | `MessageItem` — アバターに `onClick` / `onAvatarClick?(mid)` |
| `Vyline/apps/desktop/src/components/chat/MessageList.tsx` | props 転送 |
| `Vyline/apps/desktop/src/components/chat/ChatArea.tsx` | props 転送 |
| `Vyline/apps/desktop/src/pages/HomePage.tsx` | クリックでプロフィール UI を開く state |
| `Vyline/apps/desktop/src/hooks/useLineData.ts` | 任意: profile 本体 cache（URL だけでなく `LineProfile`） |

### 3. クリック → Desktop 風プロフィール drawer / modal

| ファイル | 触る関数 / 箇所 |
|---|---|
| **新規** `Vyline/apps/desktop/src/components/sidebar/ContactProfileDrawer.tsx`（仮） | 相手／グループ用 UI（名前・ステータス・mid・アイコン） |
| `Vyline/apps/desktop/src/components/sidebar/ProfilePanel.tsx` | `resolveAvatarUrl` を共有 util へ切り出し可（任意） |
| `Vyline/apps/desktop/src/components/chat/ChatHeader.tsx` | `ChatHeader` — アバター／名前クリック → `onOpenProfile` |
| `Vyline/apps/desktop/src/components/chat/MessageItem.tsx` | 同上 |
| `Vyline/apps/desktop/src/components/sidebar/ChatListItem.tsx` | アバタークリック（行選択と分離） |
| `Vyline/apps/desktop/src/pages/HomePage.tsx` | `selectedProfileMid` state、`api.line.contactProfile` 結果表示 |
| `Vyline/apps/desktop/src/api/client.ts` | `api.line.contactProfile`（既存のまま利用可） |
| `Vyline/backend/src/service/lineService.ts` | `fetchContactProfile` — 必要なら group メンバー／追加フィールド |

### ChatHeader グループアイコン（関連の小ギャップ）

| ファイル | 触る箇所 |
|---|---|
| `Vyline/apps/desktop/src/pages/HomePage.tsx` | `chatAvatarUrl` を group/room も `avatarCache.get(selectedChatMid)` に |
| `Vyline/apps/desktop/src/pages/HomePage.tsx` | `useEffect` で `fetchAvatar(selectedChatMid)` |
| `Vyline/apps/desktop/src/components/chat/ChatHeader.tsx` | 表示は既存のまま（URL が来れば画像になる） |

---

## 関連ファイル一覧（絶対パス）

```
E:\projects\Vyline\Vyline\backend\src\api\line.ts
E:\projects\Vyline\Vyline\backend\src\service\lineService.ts
E:\projects\Vyline\Vyline\packages\types\src\index.ts
E:\projects\Vyline\Vyline\apps\desktop\src\api\client.ts
E:\projects\Vyline\Vyline\apps\desktop\src\hooks\useLineData.ts
E:\projects\Vyline\Vyline\apps\desktop\src\pages\HomePage.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\layout\Sidebar.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\sidebar\ProfilePanel.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\sidebar\ChatList.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\sidebar\ChatListItem.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\chat\ChatArea.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\chat\ChatHeader.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\chat\MessageList.tsx
E:\projects\Vyline\Vyline\apps\desktop\src\components\chat\MessageItem.tsx
```
