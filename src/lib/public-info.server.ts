import "server-only";
import { cache } from "react";
import { getServerConfig } from "./server-config";
import { publicMediaModels } from "./public-models";
import { consumerDefaults, supportEmail, type ConsumerInfo } from "./consumer";
import { publicPricingPlans } from "./public-pricing";

async function publicData(path: string): Promise<unknown> {
  const { backendUrl } = getServerConfig();
  try {
    const result = await fetch(`${backendUrl}${path}`, { signal: AbortSignal.timeout(3500), next: { revalidate: 60 }, redirect: "error" });
    if (!result.ok) return null;
    const json = await result.json();
    return json.success === true ? json.data : null;
  } catch { return null; }
}
export const getPublicModels = cache(async () => publicMediaModels(await publicData("/api/market/studio-models")));
// No caching: catalogue changes and expiring offers should be reflected in the
// first HTML response, including for visitors without JavaScript or an account.
export const getPublicPlans = cache(async () => {
  const { backendUrl } = getServerConfig();
  try {
    const result = await fetch(`${backendUrl}/api/billing/en/plans`, { cache: "no-store", signal: AbortSignal.timeout(3500), redirect: "error" });
    if (!result.ok) return null;
    const json = await result.json();
    return json.success === true ? publicPricingPlans(json.data) : null;
  } catch { return null; }
});
export const getPublicSafety = cache(async () => {
  const value = await publicData("/api/ai/safety-config");
  return !!value && typeof value === "object" && "promptScreening" in value && value.promptScreening === true;
});
export const getPublicConsumer = cache(async (): Promise<ConsumerInfo> => {
  const { publicConfig } = getServerConfig();
  const raw = await publicData("/api/billing/en/consumer");
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const result = { ...consumerDefaults, supportEmail: supportEmail(value.supportEmail, publicConfig.supportEmail) };
  for (const key of ["commercialUse", "retention", "creditValidity", "membershipTerms"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) result[key] = value[key].trim().slice(0,2000);
  }
  return result;
});
