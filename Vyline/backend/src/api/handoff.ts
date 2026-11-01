import { Hono } from "hono";
import { childLogger } from "../logger.js";
import { exportHandoff, importHandoff, inspectHandoff } from "../service/handoffService.js";

const MID = /^u[0-9a-f]{32}$/i;
export const handoffRouter = new Hono();
const log = childLogger("bff:handoff");

handoffRouter.post("/:mid/export", async (c) => {
  const mid = c.req.param("mid");
  if (!MID.test(mid)) return c.json({ ok: false, error: "invalid account MID" }, 422);
  try {
    return c.json({ ok: true, ...(await exportHandoff(mid, c.req.header("x-vyline-platform"))) });
  } catch (error) {
    log.warn({ err: error, mid }, "handoff export failed");
    return c.json({ ok: false, error: "handoff export failed" }, 400);
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
    log.warn({ err: error, mid }, "handoff archive inspection failed");
    return c.json({ ok: false, error: "invalid handoff archive" }, 400);
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
    if (error instanceof Error && error.message === "import cancelled") {
      return c.json({ ok: false, error: "import cancelled" }, 400);
    }
    log.warn({ err: error, mid }, "handoff import failed");
    return c.json({ ok: false, error: "handoff import failed" }, 400);
  }
});
