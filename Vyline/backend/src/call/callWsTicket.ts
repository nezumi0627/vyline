import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 1_024;

type CallWsGrant = { accountId: string; sessionId: string; expiresAt: number };
const tickets = new Map<string, CallWsGrant>();

export function createCallWsTicket(accountId: string, sessionId: string): string {
  const now = Date.now();
  for (const [key, grant] of tickets) {
    if (grant.expiresAt <= now) tickets.delete(key);
  }
  while (tickets.size >= MAX_TICKETS) {
    const oldest = tickets.keys().next().value;
    if (!oldest) break;
    tickets.delete(oldest);
  }
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { accountId, sessionId, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

export function consumeCallWsTicket(ticket: string, accountId: string, sessionId: string): boolean {
  const grant = tickets.get(ticket);
  if (!grant || grant.expiresAt <= Date.now()) {
    tickets.delete(ticket);
    return false;
  }
  if (grant.accountId !== accountId || grant.sessionId !== sessionId) return false;
  tickets.delete(ticket);
  return true;
}
