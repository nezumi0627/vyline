import { Hono } from "hono";
import type { Context } from "hono";
import {
  configureDiagnostics,
  clearDiagnostics,
  diagnosticsStatus,
  exportDiagnostics,
  listDiagnostics,
} from "../service/diagnosticsService.js";
import { buildIssuePreview } from "../service/issueReportService.js";
import { isLogLevel } from "../service/accountSettingsService.js";

export const diagnosticsRouter = new Hono();
const MID = /^u[0-9a-f]{32}$/i;
function valid(c: Context) {
  return MID.test(c.req.param("mid") ?? "");
}
diagnosticsRouter.get("/:mid/export", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  return c.json({ ok: true, content: await exportDiagnostics(c.req.param("mid") ?? "") });
});
diagnosticsRouter.get("/:mid/status", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  return c.json({ ok: true, status: await diagnosticsStatus(c.req.param("mid")) });
});
diagnosticsRouter.patch("/:mid/status", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "invalid JSON body" }, 400);
  if (body.level !== undefined && !isLogLevel(body.level))
    return c.json({ ok: false, error: "invalid log level" }, 422);
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    return c.json({ ok: false, error: "invalid enabled value" }, 422);
  if (body.allowAutoShare !== undefined && typeof body.allowAutoShare !== "boolean")
    return c.json({ ok: false, error: "invalid auto-share value" }, 422);
  if (
    body.retentionDays !== undefined &&
    (typeof body.retentionDays !== "number" || !Number.isFinite(body.retentionDays))
  )
    return c.json({ ok: false, error: "invalid retention days" }, 422);
  return c.json({
    ok: true,
    status: await configureDiagnostics(c.req.param("mid"), {
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.allowAutoShare === "boolean" ? { allowAutoShare: body.allowAutoShare } : {}),
      ...(typeof body.retentionDays === "number" ? { retentionDays: body.retentionDays } : {}),
      ...(isLogLevel(body.level) ? { level: body.level } : {}),
    }),
  });
});
diagnosticsRouter.post("/:mid/issue-preview", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  return c.json({ ok: true, preview: await buildIssuePreview(c.req.param("mid"), body) });
});
diagnosticsRouter.get("/:mid", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  return c.json({
    ok: true,
    entries: await listDiagnostics(c.req.param("mid") ?? "", Number(c.req.query("limit") ?? 200)),
  });
});
diagnosticsRouter.delete("/:mid", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  await clearDiagnostics(c.req.param("mid") ?? "");
  return c.json({ ok: true });
});
