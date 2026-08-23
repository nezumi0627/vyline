# dual-login-desktop — 公式 LINE Desktop と Vyline の同時ログイン

最終更新: 2026-08-24

## 結論（推奨）

**Vyline の既定デバイスを `IOSIPAD` にする。**  
公式 Windows Desktop（`DESKTOPWIN`）と別スロットで、メール認証は v3p（安定）。

| 項目         | 値                                                              |
| ------------ | --------------------------------------------------------------- |
| 推奨（既定） | `VYLINE_DEVICE=IOSIPAD`                                         |
| 代替         | `ANDROIDSECONDARY`（v4p。環境によりメール login が x-lc:400）   |
| 競合         | `DESKTOPWIN` / `DESKTOPMAC`（公式 Desktop と同スロット → 蹴る） |

```powershell
# 既定（同時ログイン可）
$env:VYLINE_DEVICE = "IOSIPAD"

# 調査用のみ（公式 Desktop は落ちる）
$env:VYLINE_DEVICE = "DESKTOPWIN"
```

実装: `Vyline/packages/protocol/src/login/deviceMode.ts` + `VylineClient.ts`

## 注意

- デバイス種別変更後は **再ログイン**
- E2EE 自己鍵は `desktop-e2ee-keys.json` 経由で import 可能
- Desktop ヘッダー完全エミュ検証は `DESKTOPWIN` モードで行う

## 受け入れ

1. 公式 LINE Desktop を起動したまま Vyline でログイン
2. 両方でメッセージ受信できる
3. Desktop 側がログオフされない
