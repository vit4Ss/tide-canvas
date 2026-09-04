/* Platform counters arrive as plain numbers, localized strings, or compact
   values such as 1.2万 / 3.4M. Ambiguous values remain unknown. */

/**
 * @param {string | undefined} value
 * @returns {number | null}
 */
export function parseMetricNumber(value) {
  const normalized = value?.trim().replace(/[,_\s]/g, "").toLowerCase();
  if (!normalized) return null;
  const match = /^(-?\d+(?:\.\d+)?)(万|亿|千|k|m|b)?$/.exec(normalized);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const multiplier = {
    "": 1,
    千: 1_000,
    k: 1_000,
    万: 10_000,
    m: 1_000_000,
    亿: 100_000_000,
    b: 1_000_000_000,
  };
  return base * (multiplier[match[2] || ""] ?? 1);
}
