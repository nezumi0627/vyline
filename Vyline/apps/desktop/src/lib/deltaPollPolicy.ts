const SLOW_DELTA_POLL_MS = 6_000;

export function shouldThrottleDeltaPoll(responseOk: boolean, elapsedMs: number): boolean {
  return responseOk || elapsedMs > SLOW_DELTA_POLL_MS;
}
