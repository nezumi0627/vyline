import { Hono } from "hono";
import {
  agentILimits,
  askAgentI,
  getAgentIHistory,
  resetAgentISession,
  type AgentIHistoryItem,
} from "../service/agentIService.js";

export const agentIRouter = new Hono();

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
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      502,
    );
  }
});

agentIRouter.get("/:accountId/history", (c) => {
  return c.json({ ok: true, history: getAgentIHistory(c.req.param("accountId")) });
});

agentIRouter.delete("/:accountId/session", (c) => {
  resetAgentISession(c.req.param("accountId"));
  return c.json({ ok: true });
});
