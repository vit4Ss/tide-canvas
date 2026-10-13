import "server-only";
import { cache } from "react";
import { getServerConfig } from "./server-config";
import { publicMediaModels } from "./public-models";
import { consumerDefaults, type ConsumerInfo } from "./consumer";

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
export const getPublicConsumer = cache(async (): Promise<ConsumerInfo> => {
  const { publicConfig } = getServerConfig();
  const raw = await publicData("/api/billing/en/consumer");
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const result = { ...consumerDefaults, supportEmail: publicConfig.supportEmail || consumerDefaults.supportEmail };
  for (const key of ["commercialUse", "retention", "creditValidity", "membershipTerms"] as const) {
    if (typeof value[key] === "string") result[key] = value[key].slice(0,2000);
  }
  if (typeof value.supportEmail === "string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.supportEmail)) result.supportEmail = value.supportEmail;
  return result;
});
