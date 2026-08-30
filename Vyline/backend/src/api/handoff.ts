import { Hono } from "hono";
import { exportHandoff, importHandoff, inspectHandoff } from "../service/handoffService.js";

const MID = /^u[0-9a-f]{32}$/i;
export const handoffRouter = new Hono();

handoffRouter.post("/:mid/export", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  try {
    return c.json({ ok: true, ...(await exportHandoff(mid, c.req.header("x-vyline-platform"))) });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});

handoffRouter.post("/:mid/inspect", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<{ archiveBase64?: string }>();
  if (!body.archiveBase64) return c.json({ ok: false, error: "archiveBase64 is required" }, 422);
  try {
    return c.json({ ok: true, ...inspectHandoff(mid, body.archiveBase64) });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : "invalid handoff archive" },
      400,
    );
  }
});

handoffRouter.post("/:mid/import", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  const body = await c.req.json<{
    archiveBase64?: string;
    mode?: "overwrite" | "merge" | "cancel";
  }>();
  if (!body.archiveBase64) return c.json({ ok: false, error: "archiveBase64 is required" }, 422);
  try {
    return c.json({ ok: true, ...(await importHandoff(mid, body.archiveBase64, body.mode)) });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});
