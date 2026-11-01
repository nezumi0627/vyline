# Protocol dictionary — LINE.js 名で Desktop を探す

最終更新: 2026-08-31

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

## Desktop 検証済みハイライト（2026-08-31）

検証対象 Desktop: `26.4.2.3957`

| LINE.js / stack 名        | Desktop で観測                                                             | Path                     |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| `sendMessage`             | `TalkService_sendMessage_pargs`, `line::SendMessageTask::sendMessage`      | `/S4`                    |
| `unsendMessage`           | `TalkService_unsendMessage_pargs`, `ChatServiceImpl::requestUnsendMessage` | `/S4`                    |
| `getProfile`              | `TalkService_getProfile_pargs`                                             | `/S4`                    |
| `updateProfileAttributes` | `TalkService_updateProfileAttributes_pargs` (+ ProfileService 同名)        | `/S4`                    |
| `updateChat`              | `TalkService_updateChat_pargs`, `ChatMergeTask::updateChat*`               | `/S4`                    |
| `updateContactSetting`    | `TalkService_updateContactSetting_pargs`                                   | `/S4`                    |
| `getContactsV3`           | `RelationService_getContactsV3_pargs/presult`                              | `/RE4`                   |
| `getTargetProfiles`       | `RelationService_getTargetProfiles_pargs/presult`                          | `/RE4`                   |
| `getRSAKeyInfo`           | ヒットあり                                                                 | `/api/v3/TalkService.do` |
| `loginV2`                 | ヒットあり                                                                 | `/api/v3p/rs`            |
| OBS upload                | `obs.line-apps.com`（メソッド名よりホスト）                                | OBS HTTP                 |

生ログ: `source/desktop/recovered/native-search/`

Transport は用途別に分かれる。通常 Talk RPC は `/S4`、RelationService は `/RE4`。Square/OpenChat の protocol stack baseline には `/SQ1` が存在するが、現 worktree では Domain → Backend → BFF → UI の接続を確認できていないため、Square を「利用可能」とは扱わない。

Desktop バイナリの SHA-256 は、インストール実体と解析/unpack 実体を混同しない。

- インストール済み `LINE.exe`: `893d899f3b39d9cef59752067166b7e72c6f7021e1841b24b617ab079cf8f2b1`
- 解析/unpack バイナリ: `f85053950282da89b91fec090dd2b40aa165a593e249016f000287a939359577`

---

## カテゴリ別 API（実装入口）

### 自分のプロフィール

| 操作             | domain                             | backend HTTP                        |
| ---------------- | ---------------------------------- | ----------------------------------- |
| 取得             | `session.profile.getMine`          | `GET /line/:id/getProfile`          |
| 表示名・ステメ等 | `session.profile.update`           | `PATCH /line/:id/updateProfileAttributes` |
| アバター         | `session.profile.uploadAvatar`     | `POST /line/:id/profile/image`      |
| 背景             | `session.profile.uploadBackground` | `POST /line/:id/profile/background` |

### 他人

| 操作            | domain                    | backend HTTP                    |
| --------------- | ------------------------- | ------------------------------- |
| 取得            | `session.contacts.get`    | `GET /line/:id/getContact/:targetMid` |
| 表示名 override | `session.contacts.rename` | `PATCH /line/:id/updateContactSetting/:mid` |

### グループ

| 操作 | domain                             | backend HTTP                            |
| ---- | ---------------------------------- | --------------------------------------- |
| 名前 | `session.chat.updateName`          | `PATCH /line/:id/chats/:chatMid`        |
| 画像 | `session.chat.uploadAndSetPicture` | `POST /line/:id/chats/:chatMid/picture` |

### トーク（既存）

| 操作 | backend                           |
| ---- | --------------------------------- |
| 送信 | `POST /line/:id/sendMessage`                         |
| 取消 | `POST /line/:id/unsendMessage`                       |
| 既読 | `POST /line/:id/sendChatChecked`                     |
| 履歴 | `GET /line/:id/getPreviousMessagesV2WithRequest/:chatMid` |

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
