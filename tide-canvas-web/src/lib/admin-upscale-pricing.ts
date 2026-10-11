import type { ModelConfig } from "@/types/admin-models";

/** Keep aliases compatible with the runtime lookup. Ambiguous cells require an
 * explicit admin edit rather than silently picking one of the old prices. */
export function normalizeUpscaleRates(raw: unknown): Record<string, number | string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rates: Record<string, number | string> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    const normalized = key.trim().toLowerCase();
    if (!normalized) continue;
    rates[normalized] = seen.has(normalized) || (typeof value !== "number" && typeof value !== "string") ? "" : value;
    seen.add(normalized);
  }
  return rates;
}

export function initialUpscaleRates(config: ModelConfig, defaultResolutions: string[]): Record<string, number | string> {
  if ("pricePerSecondByResolution" in config) return normalizeUpscaleRates(config.pricePerSecondByResolution);
  const legacy = Number(config.pricePerSecond);
  if (!Number.isFinite(legacy) || legacy <= 0) return {};
  const resolutions = config.resolutions?.length ? config.resolutions : defaultResolutions;
  return Object.fromEntries(resolutions.map((resolution) => [resolution.trim().toLowerCase(), legacy]));
}

/** List only the tiers actually offered by the model, never revive an explicit
 * empty table through legacy pricing. null means the editor must finish pricing. */
export function upscaleAdminPriceRange(
  config: ModelConfig | null | undefined,
  byLevel: boolean,
  defaultResolutions: string[],
): { min: number; max: number; legacy: boolean } | null {
  if (!config) return null;
  const field = byLevel ? "pricePerSecondByUpscaleModel" : "pricePerSecondByResolution";
  if (!(field in config)) {
    const legacy = Number(config.pricePerSecond);
    return Number.isFinite(legacy) && legacy > 0 ? { min: legacy, max: legacy, legacy: true } : null;
  }
  const rates = normalizeUpscaleRates(config[field]);
  const keys = byLevel ? ["max", "high", "medium", "low"] : config.resolutions?.length ? config.resolutions : defaultResolutions;
  const values = keys.map((key) => Number(rates[key.trim().toLowerCase()]));
  if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return { min: Math.min(...values), max: Math.max(...values), legacy: false };
}
