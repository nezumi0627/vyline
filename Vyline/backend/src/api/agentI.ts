import { Hono } from "hono";
import { childLogger } from "../logger.js";
import {
  agentILimits,
  askAgentI,
  getAgentIHistory,
  resetAgentISession,
  type AgentIHistoryItem,
} from "../service/agentIService.js";
import { getSubdeviceSession } from "../storage/subdeviceStore.js";

export const agentIRouter = new Hono();
const log = childLogger("bff:agent-i");

function isLanAccessEnabled() {
  return process.env.VYLINE_LAN_ACCESS === "true";
}

function accountIdFromPath(path: string): string {
  const match = path.match(/\/([^/]+)\/(?:chat|history|session)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return "";
  }
}

agentIRouter.use("*", async (c, next) => {
  if (!isLanAccessEnabled() || c.req.header("x-vyline-local-request") === "1") return next();

  const auth = c.req.header("authorization") ?? "";
  const session = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const installationId = c.req.header("x-vyline-installation-id");
  const device = await getSubdeviceSession(session, installationId);
  if (!device) {
    return c.json({ ok: false, error: "subdevice authentication required" }, 401);
  }
  if (accountIdFromPath(c.req.path) !== device.accountId) {
    return c.json({ ok: false, error: "subdevice account mismatch" }, 403);
  }
  return next();
});

function validHistory(value: unknown): AgentIHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-agentILimits.MAX_CONTEXT_ITEMS)
    .filter((item): item is { role: "user" | "assistant"; text: string } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.text === "string"
      );
    })
    .map((item) => ({ role: item.role, text: item.text.slice(0, agentILimits.MAX_CONTEXT_TEXT) }));
}

agentIRouter.post("/:accountId/chat", async (c) => {
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{ prompt?: unknown; history?: unknown }>().catch(() => null);
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return c.json({ ok: false, error: "prompt is required" }, 400);
  }
  if (body.prompt.length > agentILimits.MAX_PROMPT_LENGTH) {
    return c.json({ ok: false, error: "prompt is too long" }, 422);
  }
  try {
    const result = await askAgentI(accountId, body.prompt, validHistory(body.history));
    return c.json({ ok: true, ...result });
  } catch (error) {
    log.warn({ err: error, accountId }, "agent i upstream request failed");
    return c.json({ ok: false, error: "upstream service unavailable" }, 502);
  }
});

agentIRouter.get("/:accountId/history", (c) => {
  return c.json({ ok: true, history: getAgentIHistory(c.req.param("accountId")) });
});

agentIRouter.delete("/:accountId/session", (c) => {
  resetAgentISession(c.req.param("accountId"));
  return c.json({ ok: true });
});
