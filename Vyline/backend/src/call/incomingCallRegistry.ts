import type { VylineClient } from "@vyline/protocol";

type CallRoute = Awaited<ReturnType<VylineClient["call"]["acquireRoute"]>>;

export type IncomingCallKind = "audio" | "video";

export interface IncomingCallInfo {
  callMid: string;
  chatMid: string;
  callerMid: string;
  communicationId?: string;
  callType: IncomingCallKind;
  route?: CallRoute;
  /** Talk Operation 受信時刻（stale な着信への応答試行を防ぐ） */
  receivedAt: number;
}

type IncomingOperation = {
  param1?: string;
  param2?: string;
  param3?: string;
  createdTime?: number | bigint | string;
};

const pendingByAccount = new Map<string, Map<string, IncomingCallInfo>>();
const maxRevisionByAccount = new Map<string, Map<string, bigint>>();

function isDirectMid(value: string): boolean {
  return value.startsWith("u");
}

function parseRouteJson(raw: string, callerMid: string): CallRoute | undefined {
  if (!raw.trim().startsWith("{")) return undefined;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const string = (key: string): string =>
    typeof value[key] === "string" ? String(value[key]) : "";
  const number = (key: string): number => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const boolean = (key: string): boolean => {
    const field = value[key];
    return field === true || field === 1 || field === "1" || field === "true";
  };
  const capabilities = (() => {
    const field = value.caps;
    if (Array.isArray(field))
      return field.filter((item): item is string => typeof item === "string");
    if (typeof field !== "string" || !field) return [];
    try {
      const parsed = JSON.parse(field) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  })();

  const voipAddress = string("h");
  const fromToken = string("n");
  const voipUdpPort = number("p");
  if (!voipAddress || !fromToken || voipUdpPort <= 0) return undefined;

  const commParam = string("vc");
  let planet = false;
  try {
    planet = Boolean((JSON.parse(commParam || "{}") as { mpkey?: unknown }).mpkey);
  } catch {
    // Malformed/legacy commParam is handled by the Andromeda transport.
  }

  return {
    fromToken,
    callFlowType: planet ? 2 : 1,
    voipAddress,
    voipUdpPort,
    voipTcpPort: number("vp"),
    fromZone: string("vfz"),
    toZone: string("vtz"),
    fakeCall: false,
    ringbackTone: "",
    toMid: callerMid,
    tunneling: string("vt"),
    commParam,
    stid: string("vs"),
    encFromMid: "",
    encToMid: "",
    switchableToVideo: boolean("stv"),
    voipAddress6: string("hv6"),
    w2pGw: "",
    drCall: false,
    stnpk: string("stnpk"),
    capabilities,
  };
}

export function normalizeIncomingCall(op: IncomingOperation): IncomingCallInfo | null {
  const callMid = String(op.param1 ?? "").trim();
  const param2 = String(op.param2 ?? "").trim();
  const param3 = String(op.param3 ?? "");
  const callerMid = isDirectMid(callMid) ? callMid : isDirectMid(param2) ? param2 : "";
  if (!callMid || !callerMid) return null;
  const route = parseRouteJson(param3, callerMid);
  const communicationId = route?.stid?.trim();
  const operationTime = Number(op.createdTime);
  let routeKind = "";
  if (route) {
    try {
      routeKind = String((JSON.parse(param3) as { k?: unknown }).k ?? "");
    } catch {
      // parseRouteJson already validated this JSON; defensive only.
    }
  }
  return {
    callMid,
    chatMid: callerMid,
    callerMid,
    ...(communicationId ? { communicationId } : {}),
    callType: routeKind === "CV" || /video/i.test(param3) ? "video" : "audio",
    ...(route ? { route } : {}),
    receivedAt:
      Number.isSafeInteger(operationTime) && operationTime > 0 ? operationTime : Date.now(),
  };
}

export function rememberIncomingCall(
  accountId: string,
  call: IncomingCallInfo,
  revision?: number | bigint,
): boolean {
  if (revision !== undefined) {
    if (
      (typeof revision === "number" && (!Number.isSafeInteger(revision) || revision < 0)) ||
      (typeof revision === "bigint" && revision < 0n)
    ) {
      return false;
    }
    const normalized = BigInt(revision);
    const revisions = maxRevisionByAccount.get(accountId) ?? new Map<string, bigint>();
    const previous = revisions.get(call.callMid);
    if (previous !== undefined && normalized <= previous) return false;
    revisions.set(call.callMid, normalized);
    maxRevisionByAccount.set(accountId, revisions);
  }
  const pending = pendingByAccount.get(accountId) ?? new Map<string, IncomingCallInfo>();
  pending.set(call.callMid, call);
  pendingByAccount.set(accountId, pending);
  return true;
}

export function findIncomingCall(accountId: string, callMid: string): IncomingCallInfo | null {
  return pendingByAccount.get(accountId)?.get(callMid) ?? null;
}

export function finishIncomingCall(
  accountId: string,
  callMid: string,
  chatMid?: string,
): IncomingCallInfo | null {
  const pending = pendingByAccount.get(accountId);
  if (!pending) return null;
  let key = callMid;
  let call = pending.get(callMid) ?? null;
  if (!call && chatMid) {
    for (const [candidateKey, candidate] of pending) {
      if (candidate.chatMid === chatMid || candidate.callerMid === chatMid) {
        key = candidateKey;
        call = candidate;
        break;
      }
    }
  }
  if (!call) return null;
  pending.delete(key);
  if (pending.size === 0) pendingByAccount.delete(accountId);
  return call;
}

export function clearIncomingCalls(accountId: string): void {
  pendingByAccount.delete(accountId);
}

/** Logout/account replacement resets identity-scoped replay protection too. */
export function resetIncomingCalls(accountId: string): void {
  clearIncomingCalls(accountId);
  maxRevisionByAccount.delete(accountId);
}
