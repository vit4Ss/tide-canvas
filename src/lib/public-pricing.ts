import type { PlanVO } from "../types/billing";
import type { StudioModel } from "./api";
import { isEnglishPlan } from "./billing.ts";
import { catalogCreditValue } from "./catalog-presentation.ts";
import { resolveImageToolPointCost, resolveVideoPointCost, usesVideoPerRequestBilling } from "./price-matrix.ts";

// Public display must never relabel CNY prices or coerce broken prices to free.
export function publicPricingPlans(value: unknown): PlanVO[] | null {
  if (!Array.isArray(value)) return null;
  const result: PlanVO[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || !isEnglishPlan(row)) continue;
    if (typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.name !== "string" ||
        ![row.monthly, row.yearly].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) ||
        !Number.isSafeInteger(row.monthlyPoints) || row.monthlyPoints < 0) return null;
    if (row.promo && ![row.promo.monthly, row.promo.yearly].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
    ids.add(row.id);
    result.push({ ...row, items: Array.isArray(row.items) ? row.items.filter((item: unknown) => typeof item === "string") : [] });
  }
  return result;
}

export interface PricingExample { id: string; name: string; modelKey: string; type: string; settings: string; credits: number }
export function pricingExamples(models: StudioModel[]): PricingExample[] {
  const result: PricingExample[] = [];
  const first = (values: unknown) => Array.isArray(values) ? values.find(value => typeof value === "string" && value.trim())?.trim() || "" : "";
  for (const type of ["image", "video", "audio", "3d"]) {
    let count = 0;
    for (const model of models) {
      if (model.type !== type || model.config?.availabilityStatus === "maintenance") continue;
      const config = model.config;
      const resolution = first(config?.resolutions), quality = first(config?.qualities), duration = first(config?.durations);
      // Modifiers can depend on references or extras; these are not flat examples.
      if (config?.priceModifiers && Object.keys(config.priceModifiers).length) continue;
      let credits: number | null = null;
      let settings = "One generation";
      try {
        if (type === "image") {
          credits = resolveImageToolPointCost(config, { resolution, quality, batchCount: 1 }, model.pointCost);
          settings = ["One image", resolution, quality].filter(Boolean).join(" · ");
        } else if (type === "video") {
          if (!usesVideoPerRequestBilling(config) && !/^\d+s?$/.test(duration)) continue;
          credits = resolveVideoPointCost(config, duration, resolution, model.pointCost);
          settings = [usesVideoPerRequestBilling(config) ? "One video request" : `${parseInt(duration, 10)}-second video`, resolution, "no video references"].filter(Boolean).join(" · ");
        } else {
          credits = catalogCreditValue(model);
          settings = type === "audio" ? "One audio request" : "One 3D request · default options";
        }
      } catch { continue; }
      if (!credits || !Number.isSafeInteger(credits) || credits <= 0) continue;
      result.push({ id: model.id, name: model.name, modelKey: model.modelKey, type, settings, credits });
      if (++count >= (type === "image" || type === "video" ? 2 : 1)) break;
    }
  }
  return result;
}
