# Protocol dictionary — LINE.js 名で Desktop を探す

最終更新: 2026-08-24

---

## なぜ辞書が必要か

Vyline は **外部 LINE.js に依存しない**。  
ただし開発時は LINE.js / stack の **メソッド名** を手がかりに、Desktop `LINE.exe` 内の同名 Thrift / C++ を特定し、**実際の動きは Desktop を正**とする。

```
やりたい機能
  → LINE.js / stack の関数名（辞書）
  → bun run vyline:find-native -- <名前>
  → Desktop の TalkService_*_pargs / line::Foo
  → protocol domain + backend 実装
```

コード上の辞書: `Vyline/packages/protocol/src/dictionary/rpcMap.ts`  
（`RPC_DICTIONARY` / `findRpc()`）

---

## Desktop 検証済みハイライト（2026-07-29）

| LINE.js / stack 名        | Desktop で観測                                                             | Path                     |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| `sendMessage`             | `TalkService_sendMessage_pargs`, `line::SendMessageTask::sendMessage`      | `/S4`                    |
| `unsendMessage`           | `TalkService_unsendMessage_pargs`, `ChatServiceImpl::requestUnsendMessage` | `/S4`                    |
| `getProfile`              | `TalkService_getProfile_pargs`                                             | `/S4`                    |
| `updateProfileAttributes` | `TalkService_updateProfileAttributes_pargs` (+ ProfileService 同名)        | `/S4`                    |
| `updateChat`              | `TalkService_updateChat_pargs`, `ChatMergeTask::updateChat*`               | `/S4`                    |
| `updateContactSetting`    | `TalkService_updateContactSetting_pargs`                                   | `/S4`                    |
| `getContactsV3`           | 文字列ヒットあり                                                           | `/S4`                    |
| `getRSAKeyInfo`           | ヒットあり                                                                 | `/api/v3/TalkService.do` |
| `loginV2`                 | ヒットあり                                                                 | `/api/v3p/rs`            |
| OBS upload                | `obs.line-apps.com`（メソッド名よりホスト）                                | OBS HTTP                 |

生ログ: `source/desktop/recovered/native-search/`

---

## カテゴリ別 API（実装入口）

### 自分のプロフィール

| 操作             | domain                             | backend HTTP                        |
| ---------------- | ---------------------------------- | ----------------------------------- |
| 取得             | `session.profile.getMine`          | `GET /line/:id/profile`             |
| 表示名・ステメ等 | `session.profile.update`           | `PATCH /line/:id/profile`           |
| アバター         | `session.profile.uploadAvatar`     | `POST /line/:id/profile/image`      |
| 背景             | `session.profile.uploadBackground` | `POST /line/:id/profile/background` |

### 他人

| 操作            | domain                    | backend HTTP                    |
| --------------- | ------------------------- | ------------------------------- |
| 取得            | `session.contacts.get`    | `GET /line/:id/contact/:mid`    |
| 表示名 override | `session.contacts.rename` | `PATCH /line/:id/contacts/:mid` |

### グループ

| 操作 | domain                             | backend HTTP                            |
| ---- | ---------------------------------- | --------------------------------------- |
| 名前 | `session.chat.updateName`          | `PATCH /line/:id/chats/:chatMid`        |
| 画像 | `session.chat.uploadAndSetPicture` | `POST /line/:id/chats/:chatMid/picture` |

### トーク（既存）

| 操作 | backend                           |
| ---- | --------------------------------- |
| 送信 | `POST /line/:id/send`             |
| 取消 | `POST /line/:id/unsend`           |
| 既読 | `POST /line/:id/read`             |
| 履歴 | `GET /line/:id/messages/:chatMid` |

---

## コマンド早見表

```powershell
# 文字列 + xref のみ（速い）
bun run vyline:find-native -- updateProfileAttributes --list-only --skip-setup

# decompile まで（Ghidra 必要・遅い）
bun run vyline:find-native -- sendMessage --max-functions 10

# Desktop インストール一式を source/desktop へ
bun run vyline:dump-desktop
bun run vyline:dump-desktop -- --full

# recovered ソースをキーワード整理
bun run vyline:focus-recovered -- sendMessage
```

---

## 関連

- [tools/find-native-symbol.md](../tools/find-native-symbol.md)
- [tools/desktop-delta.md](../tools/desktop-delta.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)
