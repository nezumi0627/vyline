import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { appendDiagnostic } from "./diagnosticsService.js";

/** Records metadata only. Never inspect request/response bodies or raw URLs. */
export function requestDiagnostics(
  resolveMid: (c: Context) => string | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const mid = resolveMid(c);
    const route = routePath(c);
    // Reading, exporting or clearing logs must not generate another log entry.
    if (!mid || !/^u[0-9a-f]{32}$/i.test(mid) || !route || route.includes("/diagnostics/")) return;
    await appendDiagnostic(
      mid,
      {
        appVersion: process.env.npm_package_version ?? "dev",
        buildNumber: process.env.VYLINE_BUILD_NUMBER ?? "unknown",
        platform: "web",
        runtime: `Bun ${Bun.version}`,
        os: `${process.platform} ${process.arch}`,
        http: { status: c.res.status, method: c.req.method, route },
        performance: { durationMs: Math.round(performance.now() - start) },
      },
      undefined,
      c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info",
    )
      // A full/unwritable log directory must never break the actual API.
      .catch(() => undefined);
  };
}
