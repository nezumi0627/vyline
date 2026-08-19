/**
 * @description Provide an HTTP/2-capable fetch for the LINE push endpoint on
 * Node.js, without affecting the user's global fetch or BaseClient's
 * normal RPC fetch.
 *
 * **Why this exists.** LINE's push endpoint serves bidirectional streaming
 * over HTTP/2. The browser's native fetch, Deno's fetch, and Bun's fetch
 * all negotiate h2 via TLS ALPN automatically. **Node.js's native fetch
 * does not** — its bundled undici client defaults to HTTP/1.1 unless an
 * h2-enabled Agent is installed as the dispatcher. Without that, the push
 * subscription appears to connect but the server never starts the stream
 * and consumers hang.
 *
 * Historically this was worked around in user code:
 *
 *     // example/node/allow_h2_for_push.ts
 *     undici.setGlobalDispatcher(new undici.Agent({ allowH2: true }));
 *
 * That works but mutates the user's global fetch dispatcher, which is
 * intrusive. This module replaces that pattern with a scoped solution: we
 * lazily import undici only on Node, build an h2-enabled Agent, and
 * expose a fetch wrapped to use that dispatcher per request. The push
 * connection picks this up automatically; nothing else in the user's
 * program is affected.
 *
 * **Runtime gates.**
 *
 *   - Deno / Bun / browser: native fetch already does h2 — we return null
 *     and the caller falls back to client.fetch.
 *   - Node without undici reachable: we return null. Push will degrade to
 *     h1 (same as before) — the install just isn't fully fixed for that
 *     user. They can either `npm i undici`, or pass a custom fetch to
 *     BaseClient that already enables h2.
 */
import type { Fetch } from "../types.ts";

let cached: Promise<Fetch | null> | null = null;

function isNodeRuntime(): boolean {
  if (typeof globalThis === "undefined") return false;
  // Bun sets process.versions.node for compatibility; check Bun/Deno
  // markers FIRST so those runtimes aren't mistaken for Node.
  if ("Deno" in globalThis) return false;
  const p = (globalThis as unknown as { process?: { versions?: { node?: string } } }).process;
  return !!p?.versions?.node;
}

/**
 * Returns an h2-capable fetch isolated on its own connection pool for the
 * LINE push endpoint.
 *
 * **Why this exists.** LINE's push endpoint serves bidirectional streaming
 * over HTTP/2. Two problems:
 *   1. Node.js's native fetch defaults to HTTP/1.1 unless an h2-enabled
 *      Agent is installed. We swap in an undici-backed fetch with
 *      `allowH2` for this connection only.
 *   2. On Bun, native fetch does h2 but pools connections per-host, so
 *      the long-lived `/PUSH` stream shares an HTTP/2 session with normal
 *      `/S4` RPCs. A dying `/PUSH` (rejected/reset by the server) churns
 *      that shared session and makes concurrent `/S4` sends hang until
 *      timeout. Using the undici Agent here gives the push its OWN
 *      connection pool, isolated from `/S4`.
 *
 * The result is cached for the process lifetime; the Agent keeps the h2
 * pool alive across push reconnects.
 */
export function getH2EnabledFetchForNode(): Promise<Fetch | null> {
  if (!isNodeRuntime()) return Promise.resolve(null);
  if (cached) return cached;
  cached = (async () => {
    try {
      // Dynamic import keeps undici out of the Deno/browser bundle and
      // only pulls it in if push is actually used on Node.
      const undici = await import("undici");
      // We treat undici's surface as `unknown` and re-narrow because
      // its Response/Request types diverge from the global Web ones
      // (e.g. undici@7's Response lacks the WHATWG `bytes()` method
      // declared in Deno's lib.deno.fetch.d.ts). The push consumer
      // only ever reads `.body`, which both shapes implement.
      const u = undici as unknown as {
        Agent: new (opts: { allowH2: boolean }) => unknown;
        fetch: (input: unknown, init?: Record<string, unknown>) => Promise<unknown>;
      };
      const agent = new u.Agent({ allowH2: true });
      const wrap: Fetch = (info, init) =>
        u.fetch(info, {
          ...(init as Record<string, unknown> | undefined),
          dispatcher: agent,
        }) as unknown as Promise<Response>;
      return wrap;
    } catch {
      return null;
    }
  })();
  return cached;
}
