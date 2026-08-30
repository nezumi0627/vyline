# グループ E2EE — Desktop / Android 解析と Vyline 取り込み

最終更新: 2026-08-24

## 公式の挙動（Android smali + linejs 対照）

- キャッシュキー: `(chatId, groupKeyId)` のマルチマップ（`research/line_decompiled/.../xr2/i0.smali`）
- 欠落時: `TalkService.getE2EEGroupSharedKey(keyVersion, chatMid, groupKeyId)`
- unwrap: `receiverKeyId` の自己 priv × creator の pub → AES-CBC で `encryptedSharedKey`
- メッセージ `chunks[4]` = グループ時の **groupKeyId**

## Desktop から Vyline へ持ち込むもの

| 資産                                   | 状態                | 用途                                                   |
| -------------------------------------- | ------------------- | ------------------------------------------------------ |
| 自己鍵全世代 `desktop-e2ee-keys.json`  | ✅ import 済        | グループ共有鍵の unwrap                                |
| 自己 pub → `e2eePublicKeys:{keyId}`    | ✅ import 時に seed | 自分が creator のときの negotiate 回避                 |
| グループ共有鍵 by-id キャッシュ        | ✅ `groupE2EE.ts`   | `(chatMid, groupKeyId)` 複数保持 + linejs 単一キー同期 |
| テキスト/メディア decrypt 前の prepare | ✅                  | `prepareGroupKeysForMessages` / `ensureGroupKeyById`   |

## Vyline 実装

- `Vyline/packages/protocol/src/login/groupE2EE.ts`
- `importDesktopE2EE.ts` が `e2eePublicKeys` も書く
- `lineService.fetchMessages` がバッチ前に全 groupKeyId を用意

## まだ弱い点

- Desktop メモリから **unwrapped group keys** 自体の dump は未実装（API by-id で足りる想定）
- 自己鍵 dump に無い `receiverKeyId` は依然 unwrap 不可 → Desktop 再抽出が必要
- linejs 本体の `getE2EELocalPublicKey` は未パッチ（ラッパで単一キーを差し替えて回避）
