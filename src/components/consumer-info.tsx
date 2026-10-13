"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
import { useResource } from "@/lib/use-resource";
import { consumerDefaults, supportLink, type ConsumerInfo } from "@/lib/consumer";
import type { PlanVO } from "@/types/billing";
import { isEnglishPlan, planPurchase } from "@/lib/billing";
import { useRuntimeConfig } from "./runtime-config";

function useCustomerResources() {
  const config = useRuntimeConfig();
  const policies = useResource<ConsumerInfo>("/api/billing/en/consumer");
  const registrationResource = useResource<{ registerClosed: boolean }>("/api/auth/register-config");
  const registration = { ...registrationResource, error: registrationResource.error || (!registrationResource.loading && typeof registrationResource.data?.registerClosed !== "boolean" ? "Registration availability could not be confirmed." : "") };
  const plansResource = useResource<PlanVO[]>("/api/billing/en/plans");
  const plans = { ...plansResource, data: Array.isArray(plansResource.data) ? plansResource.data : null, error: plansResource.error || (!plansResource.loading && plansResource.data && !Array.isArray(plansResource.data) ? "Credit prices could not be loaded. Please try again." : "") };
  const info = { ...consumerDefaults, ...policies.data, supportEmail: policies.data?.supportEmail || config.supportEmail || consumerDefaults.supportEmail };
  return { info, policies, registration, plans };
}
const Context = createContext<ReturnType<typeof useCustomerResources> | null>(null);
export function ConsumerProvider({ children }: { children: React.ReactNode }) {
  const value = useCustomerResources();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useConsumer() {
  const value = useContext(Context);
  if (!value) throw new Error("ConsumerProvider is required");
  return value;
}
export function SupportLink({ reference = "", children = "Contact support", className = "text-link" }: { reference?: string; children?: React.ReactNode; className?: string }) {
  const { info } = useConsumer();
  return <a className={className} href={supportLink(info.supportEmail, reference)}>{children}</a>;
}
const policyLabels: Record<Exclude<keyof ConsumerInfo, "supportEmail">, string> = {
  commercialUse: "Commercial use", retention: "File storage & availability", refundTiming: "Refund processing time", creditValidity: "Credit validity", membershipTerms: "Account benefits",
};
export function ConsumerPolicies({ fields = Object.keys(policyLabels) as (keyof typeof policyLabels)[] }: { fields?: (keyof typeof policyLabels)[] }) {
  const { info, policies } = useConsumer();
  return <section className="consumer-policies" aria-label="Purchase and usage policies">
    <h2>Before you purchase or upload</h2>
    {policies.error && <p className="small muted">The latest policy details could not be loaded. <button className="text-link" onClick={policies.refresh}>Try again</button></p>}
    <dl>{fields.map((key) => <div key={key}><dt>{policyLabels[key]}</dt><dd>{info[key] || (policies.loading ? "Checking published details…" : "Not yet published.")}</dd></div>)}</dl>
    {!policies.loading && fields.some(key => !info[key]) && <p className="small muted">Some terms have not been published. Ask support to confirm them before purchasing or uploading material that depends on these terms.</p>}
    <SupportLink />
  </section>;
}
export function CreditValue({ credits }: { credits: number | null }) {
  const { plans } = useConsumer();
  const rates = (plans.data || []).filter(isEnglishPlan).flatMap((plan) => (["monthly", "yearly"] as const).map((cycle) => planPurchase(plan, cycle))).filter((p) => p.available && p.total > 0 && p.credits > 0).map((p) => p.total / p.credits);
  if (credits === null || !Number.isFinite(credits)) return null;
  if (!rates.length) return <p className="credit-value">{plans.loading ? "Checking credit prices…" : "USD credit prices are not available yet."} <Link href="/pricing">View pricing</Link></p>;
  const low = Math.min(...rates) * credits, high = Math.max(...rates) * credits;
  const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n > 0 && n < .01 ? 4 : 2 }).format(n);
  return <p className="credit-value">About {usd(low)}{usd(low) !== usd(high) ? `–${usd(high)}` : ""} at current credit-pack prices. Your pack determines the rate; this is a cost reference, not an extra charge. <Link href="/pricing">Compare packs</Link></p>;
}
