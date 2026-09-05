// A proxy timeout does not prove the backend failed. Keep the same idempotency
// key until the server returns a definitive outcome, including at zero balance.
export function shouldKeepSocialRequest(response: { success?: boolean; code?: number }): boolean {
  if (response.success) return false;
  const code = response.code;
  return code == null || !Number.isFinite(code) || code < 400 || [408, 425, 429, 499].includes(code) || (code >= 500 && code < 600);
}
