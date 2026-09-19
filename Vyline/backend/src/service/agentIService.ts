import { childLogger } from "../logger.js";

const log = childLogger("service:agent-i");
const AGENT_I_CHAT_URL = "https://search.yahoo.co.jp/chat";
const AGENT_I_ENDPOINT = "https://search-agent.yahoo.co.jp/v2/chat";
const MAX_PROMPT_LENGTH = 4_000;
const MAX_CONTEXT_ITEMS = 12;
const MAX_CONTEXT_TEXT = 1_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type AgentIHistoryItem = { role: "user" | "assistant"; text: string };

type AgentIChatMessage = {
  id: string;
  role: "user" | "assistant";
  contents: [{ type: "text"; text: string }];
};

export type AgentIBody = {
  chats: AgentIChatMessage[];
  context: {
    agentMode: "multi";
    logid: string;
    qId: string;
    snc: true;
    frtype: "line_chattab_searchbar";
    frcode: "line_agenti_chattab_searchbar";
    requestType: "free_text";
    index: 0;
    yz: false;
    pdis: false;
  };
  debug: Record<string, never>;
};

const randomId = () => crypto.randomUUID().replaceAll("-", "");

function trimHistory(history: AgentIHistoryItem[]): AgentIHistoryItem[] {
  return history
    .slice(-MAX_CONTEXT_ITEMS)
    .map((item) => ({
      role: item.role,
      text: item.text.trim().slice(0, MAX_CONTEXT_TEXT),
    }))
    .filter((item) => item.text.length > 0);
}

export function buildAgentIBody(prompt: string, history: AgentIHistoryItem[] = []): AgentIBody {
  const text = prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!text) throw new Error("prompt is required");

  const chats: AgentIChatMessage[] = trimHistory(history).map((item) => ({
    id: randomId(),
    role: item.role,
    contents: [{ type: "text", text: item.text }],
  }));
  chats.push({ id: randomId(), role: "user", contents: [{ type: "text", text }] });

  return {
    chats,
    context: {
      agentMode: "multi",
      logid: randomId(),
      qId: randomId(),
      snc: true,
      frtype: "line_chattab_searchbar",
      frcode: "line_agenti_chattab_searchbar",
      requestType: "free_text",
      index: 0,
      yz: false,
      pdis: false,
    },
    debug: {},
  };
}

function textFromData(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(textFromData).filter(Boolean).join("");
  if (!data || typeof data !== "object") return "";
  const value = data as Record<string, unknown>;
  // Agent I のSSEには type/attachment/execution などの制御イベントも含まれる。
  // 任意の値を再帰探索すると、これらのイベント名が回答本文として表示される。
  for (const key of ["text", "delta", "content", "message", "parts", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = textFromData(candidate);
      if (nested) return nested;
    }
  }
  return "";
}

export function extractAgentIText(sse: string): string {
  const chunks: string[] = [];
  for (const event of sse.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") continue;
    try {
      const text = textFromData(JSON.parse(data));
      if (text) chunks.push(text);
    } catch {
      // JSONでない制御イベント名を回答本文へ漏らさない。
      if (data && !/^(?:agentstate|compositeMessage|attachment|execution(?:-|$))/i.test(data)) {
        chunks.push(data);
      }
    }
  }
  return chunks.join("").trim();
}

/** Bound the remote SSE body before converting it into one in-memory string. */
export async function readBoundedAgentIResponse(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Agent I response too large: ${declaredLength} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Agent I response exceeded ${maxBytes} bytes`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

const cookieCache = new Map<string, { cookie: string; at: number }>();
const sessionHistory = new Map<string, AgentIHistoryItem[]>();
const COOKIE_TTL_MS = 30 * 60_000;

async function mintAnonymousCookie(): Promise<string> {
  const response = await fetch(AGENT_I_CHAT_URL, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 Vyline Agent I" },
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function getCookie(accountId: string): Promise<string> {
  const cached = cookieCache.get(accountId);
  if (cached && Date.now() - cached.at < COOKIE_TTL_MS) return cached.cookie;
  const cookie = await mintAnonymousCookie();
  if (!cookie) throw new Error("Agent I の匿名セッションを取得できませんでした");
  cookieCache.set(accountId, { cookie, at: Date.now() });
  return cookie;
}

export async function askAgentI(
  accountId: string,
  prompt: string,
  history: AgentIHistoryItem[] = [],
): Promise<{ text: string }> {
  const body = buildAgentIBody(prompt, history);
  const cookie = await getCookie(accountId);
  const response = await fetch(AGENT_I_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "Accept-Language": "ja",
      Origin: "https://search.yahoo.co.jp",
      Referer: "https://search.yahoo.co.jp/",
      Cookie: cookie,
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/26.7.2/Agenti",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Agent I API error: HTTP ${response.status}`);
  const text = extractAgentIText(await readBoundedAgentIResponse(response));
  if (!text) throw new Error("Agent I が回答を返しませんでした");
  const nextHistory = [
    ...trimHistory(history),
    { role: "user" as const, text: body.chats.at(-1)!.contents[0].text },
    { role: "assistant" as const, text },
  ];
  sessionHistory.set(accountId, trimHistory(nextHistory));
  return { text };
}

export function getAgentIHistory(accountId: string): AgentIHistoryItem[] {
  return sessionHistory.get(accountId) ?? [];
}

export function resetAgentISession(accountId: string): void {
  sessionHistory.delete(accountId);
  cookieCache.delete(accountId);
  log.info({ accountId }, "Agent I session reset");
}

export const agentILimits = {
  MAX_PROMPT_LENGTH,
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_TEXT,
  MAX_RESPONSE_BYTES,
} as const;
