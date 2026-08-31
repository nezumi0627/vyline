/**
 * api/auth.ts
 *
 * 認証関連エンドポイント
 *
 * POST /auth/login/email   — メールログイン開始
 * POST /auth/login/qr      — QR ログイン開始
 * GET  /auth/login/qr/:id  — QR URL ポーリング
 * POST /auth/restore        — 保存済みトークンで復元
 * POST /auth/switch/:id     — アカウント切替（未ログインなら restore）
 * GET  /auth/accounts       — ログイン中 + 保存セッション一覧
 * GET  /auth/sessions       — 保存済みセッション詳細
 * DELETE /auth/sessions/:id — 保存セッション削除
 * DELETE /auth/accounts/:id — アカウント削除
 */

import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { childLogger } from "../logger.js";
import {
  loginWithEmail,
  loginWithQRCode,
  loginWithToken,
  loginWithAuthToken,
  listAccounts,
  getQrState,
  getLoggedInAt,
  getAuthToken,
  getContentQrState,
  loginContentWithQRCode,
  removeClient,
  waitForSessionRestore,
} from "../line/clientManager.js";
import { deleteToken, loadTokens, listSavedSessions } from "../storage/tokenStore.js";

const log = childLogger("api:auth");
export const authRouter = new Hono();
type EmailLoginStatus = "idle" | "pending" | "completed" | "failed";
const emailLoginState = new Map<
  string,
  { status: EmailLoginStatus; pincode: string | null; error: string | null }
>();

// 端末確認 PIN は認証情報。Math.random は予測可能なため CSPRNG を使う。
function random6DigitPin(): string {
  return String(randomInt(100000, 1000000));
}

// ─────────────────────────────────────────────
// POST /auth/login/email
// body: { accountId, email, password }
// ─────────────────────────────────────────────
authRouter.post("/login/email", async (c) => {
  const body = await c.req.json<{
    accountId: string;
    email: string;
    password: string;
  }>();

  if (!body.accountId || !body.email || !body.password) {
    return c.json({ ok: false, error: "accountId, email, password required" }, 400);
  }

  // E2EE 暗号化と表示 PIN は必ず同一。食い違うと decryptKeyChain が Invalid type: 0 になる
  const pincode = random6DigitPin();
  emailLoginState.set(body.accountId, { status: "pending", pincode, error: null });

  loginWithEmail(
    body.accountId,
    body.email,
    body.password,
    (pin) => {
      emailLoginState.set(body.accountId, { status: "pending", pincode: pin, error: null });
      log.info(
        { accountId: body.accountId, pin: Boolean(pin) },
        "PINCODE REQUIRED — enter on LINE app",
      );
    },
    pincode,
  )
    .then(() => {
      const current = emailLoginState.get(body.accountId);
      emailLoginState.set(body.accountId, {
        status: "completed",
        pincode: current?.pincode ?? null,
        error: null,
      });
      log.info({ accountId: body.accountId }, "email login completed");
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      let userError = "メールログインに失敗しました。";

      if (message.includes("INVALID_IDENTITY_CREDENTIAL")) {
        userError = "メールアドレスまたはパスワードが正しくありません。";
      } else if (message.includes("REQUIRE_DEVICE_CONFIRM")) {
        userError = "LINE アプリ側で端末確認が必要です。";
      } else if (message.includes("TOO_MANY_REQUEST")) {
        userError = "試行回数が多すぎます。しばらく待って再試行してください。";
      } else if (message.includes("Invalid type")) {
        userError = "PIN 認証に失敗しました。表示された PIN をそのまま入力して再試行してください。";
      }

      emailLoginState.set(body.accountId, { status: "failed", pincode: null, error: userError });
      log.error({ accountId: body.accountId, err }, "email login failed");
    });

  return c.json({
    ok: true,
    message: "メールログインを開始しました。PIN が表示されたら LINE 端末に入力してください。",
    accountId: body.accountId,
  });
});

authRouter.get("/login/email/:id", (c) => {
  const accountId = c.req.param("id");
  const state = emailLoginState.get(accountId) ?? {
    status: "idle" as EmailLoginStatus,
    pincode: null,
    error: null,
  };

  return c.json({
    ok: true,
    status: state.status,
    pincode: state.pincode,
    error: state.error,
  });
});

// ─────────────────────────────────────────────
// POST /auth/login/qr
// body: { accountId }
// ─────────────────────────────────────────────
authRouter.post("/login/qr", async (c) => {
  const body = await c.req.json<{ accountId: string }>();
  if (!body.accountId) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  // 非同期でログイン開始
  loginWithQRCode(body.accountId, (url) => {
    log.info({ accountId: body.accountId, urlReady: Boolean(url) }, "QR URL ready");
  })
    .then(() => {
      log.info({ accountId: body.accountId }, "QR login completed");
    })
    .catch((err: unknown) => {
      log.error({ accountId: body.accountId, err }, "QR login failed");
    });

  return c.json({
    ok: true,
    message: "QR login started — poll GET /auth/login/qr/:id for URL",
    accountId: body.accountId,
  });
});

// ─────────────────────────────────────────────
// GET /auth/login/qr/:id
// QR 状態をポーリングで取得する
// status: "idle" | "waiting" | "pending" | "expired" | "completed" | "failed"
// ─────────────────────────────────────────────
authRouter.get("/login/qr/:id", (c) => {
  const accountId = c.req.param("id");
  const { url, expired, pincode, inProgress, error } = getQrState(accountId);

  if (expired) {
    return c.json({ ok: true, status: "expired", qrUrl: null, pincode: null });
  }

  if (error && !inProgress) {
    // Internal transport errors can contain headers/tokens. Do not expose them.
    return c.json({
      ok: true,
      status: "failed",
      qrUrl: null,
      pincode: null,
      error: "QRログインに失敗しました。もう一度お試しください。",
    });
  }

  if (url) {
    return c.json({ ok: true, status: "pending", qrUrl: url, pincode });
  }

  // ログイン処理中だが URL 未着
  if (inProgress) {
    return c.json({ ok: true, status: "waiting", qrUrl: null, pincode });
  }

  const loggedIn = listAccounts().includes(accountId) && getLoggedInAt(accountId) !== null;
  // メモリにセッション無し → ホットリロード等で QR が消えた
  // フロントが「表示中だった QR」を失ったと分かるよう idle を返す
  return c.json({
    ok: true,
    status: loggedIn ? "completed" : "idle",
    qrUrl: null,
    pincode: null,
  });
});

// ─────────────────────────────────────────────
// POST /auth/content/qr
// Note / Album 用の ANDROIDSECONDARY セッションを正式登録する
// ─────────────────────────────────────────────
authRouter.post("/content/qr", async (c) => {
  const body = await c.req.json<{ accountId: string }>();
  if (!body.accountId) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  loginContentWithQRCode(body.accountId, (url) => {
    log.info({ accountId: body.accountId, urlReady: Boolean(url) }, "content QR URL ready");
  })
    .then(() => log.info({ accountId: body.accountId }, "content QR login completed"))
    .catch((err: unknown) =>
      log.error({ accountId: body.accountId, err }, "content QR login failed"),
    );

  return c.json({
    ok: true,
    message: "Content QR login started — poll GET /auth/content/qr/:id",
    accountId: body.accountId,
  });
});

authRouter.get("/content/qr/:id", (c) => {
  const accountId = c.req.param("id");
  const state = getContentQrState(accountId);
  const status = state.ready
    ? "completed"
    : state.expired
      ? "expired"
      : state.url
        ? "pending"
        : state.inProgress
          ? "waiting"
          : "idle";
  return c.json({
    ok: true,
    status,
    qrUrl: state.url,
    pincode: state.pincode,
  });
});

// ─────────────────────────────────────────────
// POST /auth/restore
// body: { accountId }  — 保存済みトークンで復元
// ─────────────────────────────────────────────
authRouter.post("/restore", async (c) => {
  const body = await c.req.json<{ accountId: string }>();
  if (!body.accountId) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  try {
    await loginWithToken(body.accountId);
    return c.json({ ok: true, accountId: body.accountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("NOT_AUTHORIZED_DEVICE") && message.includes("EXPIRED")) {
      const { updateSessionMeta } = await import("../storage/tokenStore.js");
      await updateSessionMeta(body.accountId, { reauthRequired: true });
      return c.json(
        {
          ok: false,
          code: "REAUTH_REQUIRED",
          error:
            "セッションの有効期限が切れました。再認証すると履歴・E2EE鍵・設定はそのまま引き継がれます。",
        },
        401,
      );
    }
    log.error({ accountId: body.accountId, err }, "restore failed");
    return c.json({ ok: false, error: "internal server error" }, 500);
  }
});

// ─────────────────────────────────────────────
// POST /auth/login/token
// body: { accountId, authToken }  — トークン直接指定でログイン
// ─────────────────────────────────────────────
authRouter.post("/login/token", async (c) => {
  const body = await c.req.json<{ accountId: string; authToken: string; deviceMode?: string }>();
  if (!body.accountId || !body.authToken) {
    return c.json({ ok: false, error: "accountId and authToken required" }, 400);
  }

  try {
    const deviceMode = body.deviceMode?.trim().toUpperCase();
    const allowedDeviceModes = new Set([
      "IOS",
      "IOSIPAD",
      "ANDROIDSECONDARY",
      "DESKTOPWIN",
      "DESKTOPMAC",
    ]);
    if (deviceMode && !allowedDeviceModes.has(deviceMode)) {
      return c.json({ ok: false, error: "invalid deviceMode" }, 400);
    }
    await loginWithAuthToken(body.accountId, body.authToken, deviceMode);

    // トークンを保存（次回から restore で復元可能）
    const { saveToken } = await import("../storage/tokenStore.js");
    await saveToken(body.accountId, body.authToken, deviceMode ? { deviceMode } : {});

    log.info({ accountId: body.accountId }, "token login success");
    return c.json({ ok: true, accountId: body.accountId });
  } catch (err) {
    log.error({ accountId: body.accountId, err }, "token login failed");
    return c.json({ ok: false, error: "internal server error" }, 500);
  }
});

// ─────────────────────────────────────────────
// POST /auth/switch/:id
// 未ログインなら restore → ログイン済みならそのまま active 切替
// ─────────────────────────────────────────────
authRouter.post("/switch/:id", async (c) => {
  const accountId = c.req.param("id");
  if (!accountId) {
    return c.json({ ok: false, error: "accountId required" }, 400);
  }

  const active = listAccounts();
  if (active.includes(accountId)) {
    return c.json({ ok: true, accountId, restored: false });
  }

  const tokens = await loadTokens();
  if (!tokens[accountId]) {
    return c.json({ ok: false, error: "account not found" }, 404);
  }

  try {
    await loginWithToken(accountId);
    return c.json({ ok: true, accountId, restored: true });
  } catch (err) {
    log.error({ accountId, err }, "switch restore failed");
    return c.json({ ok: false, error: "internal server error" }, 500);
  }
});

// ─────────────────────────────────────────────
// GET /auth/accounts
// ─────────────────────────────────────────────
authRouter.get("/accounts", async (c) => {
  await waitForSessionRestore();
  const active = listAccounts();
  const saved = await loadTokens();
  const sessions = await listSavedSessions();
  return c.json({
    ok: true,
    active,
    saved: Object.keys(saved),
    sessions,
  });
});

// ─────────────────────────────────────────────
// GET /auth/token/:id — 現在の authToken 取得（PCローカルのみ）
// ─────────────────────────────────────────────
authRouter.get("/token/:id", async (c) => {
  if (c.req.header("x-vyline-local-request") !== "1") {
    return c.json({ ok: false, error: "local request required" }, 403);
  }
  const accountId = c.req.param("id");
  const token = getAuthToken(accountId);
  if (!token) {
    return c.json({ ok: false, error: "not logged in" }, 401);
  }
  return c.json({ ok: true, token });
});

// ─────────────────────────────────────────────
// GET /auth/sessions — 保存済みセッション詳細
// ─────────────────────────────────────────────
authRouter.get("/sessions", async (c) => {
  const active = new Set(listAccounts());
  const sessions = (await listSavedSessions()).map((s) => ({
    ...s,
    active: active.has(s.accountId),
  }));
  return c.json({ ok: true, sessions });
});

// ─────────────────────────────────────────────
// DELETE /auth/sessions/:id — 保存セッションのみ削除（メモリは維持可）
// query: ?logout=1 でメモリ上のクライアントも破棄
// ─────────────────────────────────────────────
authRouter.delete("/sessions/:id", async (c) => {
  const accountId = c.req.param("id");
  const alsoLogout = c.req.query("logout") === "1" || c.req.query("logout") === "true";
  await deleteToken(accountId);
  if (alsoLogout) removeClient(accountId);
  return c.json({ ok: true, accountId });
});

// ─────────────────────────────────────────────
// DELETE /auth/accounts/:id
// ─────────────────────────────────────────────
authRouter.delete("/accounts/:id", async (c) => {
  const accountId = c.req.param("id");
  removeClient(accountId);
  await deleteToken(accountId);
  return c.json({ ok: true, accountId });
});
