export const DEFAULT_SUPPORT_EMAIL = "gudexin748@gmail.com";
// Describes the deployed application's behavior; it is not a fixed retention
// SLA or a promise of permanent storage. Operator-written terms take priority.
export const DEFAULT_FILE_RETENTION = "Uploaded files and saved results are stored in Alibaba Cloud OSS for access through your library. The application does not apply a universal automatic expiry period to successfully saved files. You can remove uploaded files from your library or contact support to request deletion of generated results. File links and availability may change; download important work and keep your own backup.";
export interface ConsumerInfo {
  supportEmail: string;
  commercialUse: string;
  retention: string;
  refundTiming: string;
  creditValidity: string;
  membershipTerms: string;
}
export const consumerDefaults: ConsumerInfo = { supportEmail: DEFAULT_SUPPORT_EMAIL, commercialUse: "", retention: DEFAULT_FILE_RETENTION, refundTiming: "", creditValidity: "", membershipTerms: "" };
export function supportEmail(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const email = value.trim();
    if (email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return email;
  }
  return DEFAULT_SUPPORT_EMAIL;
}
export function supportLink(email: string, reference = "") {
  return `mailto:${encodeURIComponent(supportEmail(email))}?subject=${encodeURIComponent(`Framelyn support${reference ? ` — ${reference}` : ""}`)}&body=${encodeURIComponent(`Please describe what happened${reference ? ` with ${reference}` : ""}:\n\n\nDo not include passwords, API keys or payment card details.`)}`;
}
