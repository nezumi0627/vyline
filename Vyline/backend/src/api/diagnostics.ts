import { Hono } from "hono";
import type { Context } from "hono";
import {
  clearDiagnostics,
  exportDiagnostics,
  listDiagnostics,
} from "../service/diagnosticsService.js";

export const diagnosticsRouter = new Hono();
const MID = /^u[0-9a-f]{32}$/i;
function valid(c: Context) {
  return MID.test(c.req.param("mid") ?? "");
}
diagnosticsRouter.get("/:mid/export", async (c) => {
  if (!valid(c)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  return c.json({ ok: true, content: await exportDiagnostics(c.req.param("mid") ?? "") });
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
