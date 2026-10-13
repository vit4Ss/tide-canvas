export const DEFAULT_SUPPORT_EMAIL = "gudexin748@gmail.com";
export interface ConsumerInfo {
  supportEmail: string;
  commercialUse: string;
  retention: string;
  refundTiming: string;
  creditValidity: string;
  membershipTerms: string;
}
export const consumerDefaults: ConsumerInfo = { supportEmail: DEFAULT_SUPPORT_EMAIL, commercialUse: "", retention: "", refundTiming: "", creditValidity: "", membershipTerms: "" };
export function supportLink(email: string, reference = "") {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Framelyn support${reference ? ` — ${reference}` : ""}`)}&body=${encodeURIComponent(`Please describe what happened${reference ? ` with ${reference}` : ""}:\n\n\nDo not include passwords, API keys or payment card details.`)}`;
}
