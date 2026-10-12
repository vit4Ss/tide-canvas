import type { StudioModel } from "./api";

/** Catalog metadata is not a quote. Show a fixed number only when the catalog
 * has an unambiguous flat price; parameter-dependent prices stay in Studio. */
export function catalogCreditValue(model: StudioModel): number | null {
  if (model.type === "video" || model.type === "upscale") return null;
  const config = model.config;
  for (const rules of [config?.priceMatrix, config?.pricing, config?.priceModifiers]) {
    if (rules && typeof rules === "object" && Object.keys(rules).length > 0) return null;
  }
  const base = Number(model.pointCost);
  if (!Number.isSafeInteger(base) || base <= 0) return null;
  const override = Number(config?.creditCost);
  if (Number.isFinite(override) && override > 0 && override !== base) return null;
  return base;
}
