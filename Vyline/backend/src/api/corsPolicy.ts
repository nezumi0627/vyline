export function resolveCorsOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  fallbackOrigin: string,
): string | undefined {
  if (!origin) return fallbackOrigin;
  return allowedOrigins.has(origin) ? origin : undefined;
}
