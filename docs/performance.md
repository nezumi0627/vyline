# Vyline パフォーマンス最適化

最終更新: 2026-08-30

Vyline は「体感速度を落とさず、起動時間・CPU・メモリを継続的に抑える」ことを優先する。
最適化は必ず **計測 → ボトルネック特定 → 最小変更 → 同条件で再計測** の順で行う。

## 2026-08-30 基準値

Windows 11 / Bun 1.4.0 / Vite 6.4.2 で測定。

| 項目 | 計測値 |
| --- | ---: |
| 通常の Vite dev 起動 | 平均 284 ms（271 / 307 / 274 ms） |
| `vite --force` 依存再最適化 | 平均 312 ms（336 / 302 / 298 ms） |
| 単独 Vite 起動（別測定） | 約 2.0 s |
| ユーザー報告の遅い起動 | 9.508 s |
| Vite config load | 約 249 ms |
| backend `/healthz` median | 約 1.4 ms |
| backend `/healthz` p95 | 約 6.2 ms |
| frontend dev RSS | 約 295 MB（通常開発サーバー） |
| backend dev RSS | 約 124 MB |

Vite 単体では 9.5 秒を再現しなかった一方、アプリ起動ロジックには実際の重複処理が見つかった。
保存済みセッションがある場合、session restore・cache warm・履歴 index が重複し、LINE RPC / CPU / disk I/O を起動直後に不要に増やす構造だった。

ログイン済み状態で最適化後の `/auth/accounts` 完了までを 3 回測定した結果は 878.9 / 916.8 / 991.7 ms、平均約 0.93 秒。backend health-ready は約 0.41〜0.54 秒だった。

## 現在採用している最適化

### 1. session restore の所有者を backend に一本化する

起動時の保存済みセッション復元は backend の `restoreAllSessions()` だけが担当する。frontend の `refreshAccounts()` は `/auth/accounts` から復元完了後の状態を読むだけで、追加の `/auth/restore` を自動実行しない。

さらに `loginWithToken()` は account ごとの in-flight Promise を共有する。同じ account に restore 要求が同時到着しても LINE session の生成は 1 回だけ行う。

### 2. 通常の restore で履歴 index を走らせない

`warmLineCache()` はローカル cache の warm だけを行う。session restore の副作用として `runAccountIndex({ topChats: 16, messagesPerChat: 30 })` のような全履歴 crawl を開始しない。

履歴 index は明示操作に限定し、cache がある通常起動で remote history crawl を繰り返さない。

### 3. cache warm を 1 回にする

`loginWithToken()` 内で client 登録後に `warmLineCache()` を開始する。`index.ts` 側で restore 完了後に全 account を再度 `warmAccountCache()` しない。

client を `clients` に登録してから warm を始めることで、warm 中に `requireClient()` が未登録状態を見る race も避ける。

### 4. disk cache の freshness を再起動後も引き継ぐ

chat 一覧は memory cache が空という理由だけで remote sync しない。`chatsSyncedAt` が TTL 内なら disk cache を memory cache に昇格し、frontend も通常起動では `refresh=true` を強制しない。

TTL 超過または明示 refresh の場合だけ remote sync する。

### 5. 起動時に不要な画面を遅延ロードする

`LoginPage`、`SubdevicePage`、`PrDemoPage`、`SettingsSections`、`HubHome`、`ChatArea` は `React.lazy()` で必要時だけロードする。チャット未選択時はメッセージ表示・入力系を読み込まない。

2026-08-30 の production build では主要な lazy-load 適用後、初期 JS は 632.42 kB → 401.77 kB、gzip は 187.55 kB → 125.81 kB まで縮小した。

### 6. ポーリングと大量データ処理

`useVylineSync` の既存 scheduler と単一フライト制御を維持し、短い固定 timer を追加しない。store hydrate は連続更新をまとめ、メッセージ一覧は仮想化して全件 DOM 化を避ける。

## Bun 1.4 方針

- 通常開発は `bun --watch` を使い、別 watcher を重ねない。
- `--smol` はメモリ削減と引き換えに性能を落とすため既定値にはしない。
- CPU 調査は `--cpu-prof` / `--cpu-prof-md`、メモリ調査は `--heap-prof` / `--heap-prof-md` を使う。
- Bun / Vite の cache directory は常用で削除しない。削除すると依存再最適化コストを再度払う。

## 計測手順

### Vite 起動

```powershell
cd Vyline/apps/desktop
bun .\node_modules\vite\bin\vite.js
bun .\node_modules\vite\bin\vite.js --force
```

`ready in ... ms` を最低 3 回記録し、warm と `--force` を混ぜて比較しない。

### transform のボトルネック

```powershell
cd Vyline/apps/desktop
bun .\node_modules\vite\bin\vite.js --debug transform
```

ページを開き、数十〜数百 ms かかる module を確認する。巨大 component が通常起動に不要なら dynamic import / `React.lazy()` を優先する。

### production bundle

```powershell
bun run build
```

初期 chunk の gzip サイズを前回値と比較する。単に chunk 数を増やすのではなく「起動時に不要な機能」を分離する。

### backend CPU / heap

一時的な調査時だけ profiler を有効にする。

```powershell
bun --cpu-prof-md Vyline/backend/src/index.ts
bun --heap-prof-md Vyline/backend/src/index.ts
```

profiler 自体にオーバーヘッドがあるため通常開発では有効にしない。

## 回帰防止ルール

- startup session restore の所有者を複数レイヤーに作らない。backend が唯一の owner。
- 同一 account の login / restore は single-flight にする。
- session restore の副作用として remote history index や全 chat crawl を開始しない。
- cache warm を複数箇所から重複起動しない。
- memory cache が空という理由だけで新鮮な disk cache を無効扱いしない。
- 通常起動の frontend から `refresh=true` を強制しない。freshness は backend の TTL 判定を正本にする。
- 設定、バックアップ、解析、QR、管理 UI のような通常チャットに不要な機能は lazy load を優先する。
- polling / timer を追加する前に既存 scheduler に統合できないか確認する。
- cache は上限または失効条件を持たせる。
- `React.memo` / `useMemo` は profiler で再 render が原因と確認できた場所だけに使う。
- `server.warmup` は広い glob を指定しない。起動時間と初回表示の両方を再計測し、明確に改善した場合だけ採用する。
- 速度改善が計測ノイズ内ならコードを増やさない。

## 現在の判断

フロントの初期 import graph 改善だけでなく、backend/frontend 間の起動責務の重複をなくすことが重要だった。
基本方針は「1 account = 1 restore」「restore = session 復元だけ」「重い履歴 index は明示実行」。

今後は起動時に発生する LINE RPC 数、disk I/O、timer、cache warm、store hydrate を先に数え、同じデータを複数レイヤーで取り直していないかを優先して確認する。
