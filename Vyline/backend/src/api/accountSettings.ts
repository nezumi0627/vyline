import { Hono } from "hono";
import { loadAccountSettings, saveAccountSettings, updateSetup } from "../service/accountSettingsService.js";

export const accountSettingsRouter = new Hono();
const MID = /^u[0-9a-f]{32}$/i;

accountSettingsRouter.get("/:mid", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  return c.json({ ok: true, settings: await loadAccountSettings(mid) });
});

accountSettingsRouter.put("/:mid", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<Record<string, unknown>>();
  if (body.privacy && typeof body.privacy === "object") (body.privacy as Record<string, unknown>).includeMessageTextInLogs = false;
  return c.json({ ok: true, settings: await saveAccountSettings(mid, body) });
});

accountSettingsRouter.patch("/:mid/setup", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<{ step?: number; settings?: Record<string, unknown> }>();
  if (!Number.isInteger(body.step) || body.step == null || body.step < 0 || body.step > 3) return c.json({ ok: false, error: "invalid setup step" }, 422);
  return c.json({ ok: true, settings: await updateSetup(mid, body.step, body.settings ?? {}) });
});
