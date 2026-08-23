# Vyline タスク状況ボード

最終更新: 2026-08-24
規則: **git push/commit しない** / **連絡先へ勝手送信しない**

---

## フェーズ一覧

| Phase | 内容                                            | 状態                              |
| ----- | ----------------------------------------------- | --------------------------------- |
| 0     | キックオフ・レポート経路確認                    | ✅                                |
| 1     | E2EE 復号・送信安定化                           | ✅ 実装済                         |
| 2     | README / AGENTS / tasks / 解析 md               | ✅                                |
| 3     | Vyline 整備・Desktop 差分 tool                  | ✅ `vyline:delta` / Vyline-Search |
| 3b    | プロトコル層再構成（linejs 排除・domain・辞書） | ✅ 2026-07-29 完了                |
| 4     | Telegram 風 UI                                  | 🔧 シェル基盤済・継続改善中       |
| 5     | 品質・速度・stack                               | 🔧 継続改善中                     |

---

## 2026-07-31 完了タスク

| 領域          | 成果                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| 画像送信      | E2EE 非対応ユーザーへの平文フォールバック                                   |
| LINE 絵文字   | カタログ表示・文中挿入・楽観的送信・リプライ表示修正                        |
| メディア復号  | 失敗直後の短期バックオフ・404 再試行抑止・復号リトライ最適化              |
| スタンプ      | 全件ページネーション取得・Premium (STKVER=100) 送信対応・カタログキャッシュ |
| チャット管理  | クロスチャット汚染修正・退出グループ除外・右クリックメニュー拡張            |
| 既読          | 既読者プロフィール事前取得（メンバー一覧不要）・ネットワークエラー耐性      |
| ブロック      | API 連携済・右クリックメニューに MID コピー/ブロック追加                    |
| UI            | 空チャット表示・ヘッダーボタン・カスタムカーソル・サイドバープレビュー      |
| 設定          | JSON Import/Export（テーマ/設定/非表示/ピン留め/ローカル名）                |
| DB キャッシュ | スタンプカタログ/パックメタ インメモリキャッシュ・VylineCache プロフィール  |
| 通話          | INVALID_STATE エラー適切処理                                                |
| ツール        | Vyline-Search 統合（findNativeSymbol / focusRecoveredSource / unpackLine）  |
| Docs          | AGENTS.md / README.md / STATUS.md / tools/ 更新                             |

---

## アーキテクチャ（現行）

```
desktop (React + Vite) ──HTTP──► backend (Hono on Bun)
                                      │
                                      ▼
                                @vyline/protocol
                            domain/ dictionary/
                            login/ e2ee/ protocol/
                                      │
                                      ▼
                                 stack/ (_dist 型)
                                      │
                                      ▼
                            LINE Legy + OBS (Desktop 準拠)
```

新機能の追加順: **辞書 → find-native → domain → lineService → api/line.ts**

---

## 現在のブロッカー

- なし（E2EE 平文フォールバック実装済・Premium スタンプ対応済）

---

## 次（優先順）

1. 既読者表示の完全修繕（メンバー名解決の事前取得済→表示検証）
2. 通話品質改善（acquireCallRoute エラー処理済→実通話テスト）
3. UI 細部改善（継続）
4. stack RPC の Desktop 準拠への段階的置換

---

## 予定（実装未確定）

| 機能                 | 内容                                                                    | 方針メモ                                          |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **プラグイン API**   | ES Modules で UI・挙動を動的拡張                                        | `docs/plugin-api.md` に設計メモあり。現状は未対応 |
| **オープンチャット** | LINE オープンチャット（不明な相手と交流するチャットルーム）の閲覧・参加 | 実装未着手。UI に導線は無し。RPC 調査が先         |

---

## ドキュメント入口

| リンク                                              | 用途                     |
| --------------------------------------------------- | ------------------------ |
| [docs/README.md](../README.md)                      | 索引                     |
| [onboarding.md](../onboarding.md)                   | 新規参入                 |
| [CONTRIBUTING.md](../CONTRIBUTING.md)               | 機能追加フロー           |
| [protocol/dictionary.md](../protocol/dictionary.md) | RPC 辞書                 |
| [architecture.md](../architecture.md)               | 層構造・lineService 接点 |
| [tools/](../tools/)                                 | Vyline-Search 検索ツール |
