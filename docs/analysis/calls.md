# Calls — VoIP / Planet / Andromeda

最終更新: 2026-08-24

---

## 方針

- **勝手にかけない**: 通話テストは **ACECRAFT / エースクラフト / 7sGood** の DM のみ（backend allowlist）
- 追加 mid: 環境変数 `VYLINE_CALL_TEST_MIDS=uXXX,uYYY`
- stack 内に **Planet + Andromeda + CallSession + Opus/SRTP** フル実装あり（linejs 3.2.1 同等）

---

## Desktop 通話 wire（2026-07-29 移植）

- **Planet UA** はログイン端末（既定 `IOSIPAD` → iOS UA）に合わせる。以前は常に Android Pixel 固定で SETUP が失敗し得た
- **Nezu Desktop profile** を `acquireCallRoute.fromEnvInfo` / Planet `appReleaseInfo` に反映
- `VYLINE_CALL_DESKTOP_WIRE=1` で副端末ログイン時も Desktop Planet UA を強制（Windows + 公式 Desktop 併用時の調査用）
- **`client.listen()`** で `NOTIFIED_RECEIVED_CALL` / `CANCEL_CALL` を受信（着信ログ）

```
backend/sessionFactory → pickCallTransportForClient (protocol/call/context)
  acquireRoute(fromEnvInfo: devname=iPad|Windows|Android)
  PlanetTransport(userAgent=端末一致, appReleaseInfo=x-line-application 相当)
```

---

## API

| メソッド | パス                               | 用途                                   |
| -------- | ---------------------------------- | -------------------------------------- |
| POST     | `/line/:id/call/start`             | フルセッション開始 `{ to, callType? }` |
| POST     | `/line/:id/call/end`               | `{ sessionId }`                        |
| GET      | `/line/:id/call/status?sessionId=` | 状態                                   |
| GET      | `/line/:id/call/active`            | アカウントのアクティブ通話             |
| POST     | `/line/:id/call`                   | route のみ（デバッグ）                 |
| WS       | `/line/:id/call/ws?sessionId=`     | PCM Int16LE @48kHz                     |

---

## CLI テスト（linejs full_call.test 参考）

```powershell
# 名前で解決（友だち一覧から）
bun run vyline:call-test -- --account main --name ACECRAFT
bun run vyline:call-test -- --account main --name 7sGood

# mid 指定 + 440Hz テストトーン 3 秒
bun run vyline:call-test -- --account main --to uXXXXXXXX --tone
```

---

## linejs テスト参照

| テスト                                                | 内容                             |
| ----------------------------------------------------- | -------------------------------- |
| `stack/client/features/call/session.test.ts`          | 状態遷移                         |
| `stack/client/features/call/full_call.test.ts`        | Andromeda + mock UAS + Opus echo |
| `stack/client/features/call/planet/transport.test.ts` | Planet SETUP/CONN                |
| `stack/client/features/call/e2e.test.ts`              | PCM→SRTP loopback                |

---

## 未実装 / 次

- 着信 UI（`NOTIFIED_RECEIVED_CALL` → backend SSE）
- ビデオ（VIDEO callType のメディア）
- グループ通話 UI（`acquireGroupCallRoute` は backend に残置）

---

## 関連

- [protocol/dictionary.md](../protocol/dictionary.md) — `acquireCallRoute`
- `Vyline/backend/src/call/allowlist.ts`
- `Vyline/packages/protocol/stack/client/features/call/`
