const MID_PATTERN = /^u[0-9a-f]{32}$/i;

export function resolveDiagnosticsMid(profileMid?: string, accountId?: string): string | undefined {
  if (profileMid && MID_PATTERN.test(profileMid)) return profileMid;
  if (accountId && MID_PATTERN.test(accountId)) return accountId;
  return undefined;
}
