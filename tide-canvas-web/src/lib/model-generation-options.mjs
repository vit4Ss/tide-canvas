/** @param {unknown} value @returns {string[]} */
const strings = (value) => Array.isArray(value)
  ? [...new Set(value.filter(v => typeof v === "string" && !!v.trim()).map(v => v.trim()))] : [];

/** @param {string} value */
export function resolutionRank(value) {
  const s = value.trim().toLowerCase();
  if (s === "auto") return -1;
  const m = /^(\d+(?:\.\d+)?)(k)?/.exec(s);
  return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : Number.MAX_SAFE_INTEGER;
}

/** Shared by Studio and the template editor. Missing config hides the control;
 * display sorting never changes the model's configured default (first item).
 * @param {import('../types/admin-models').ModelConfig | null | undefined} config */
export function modelGenerationOptions(config) {
  const ratios = strings(config?.ratios);
  const resolutions = strings(config?.resolutions);
  const qualities = strings(config?.qualities);
  // Legacy catalogs can contain numeric seconds; normalize them to the Studio
  // label form without losing precision or hiding the configured control.
  const durationValues = Array.isArray(config?.durations) ? config.durations : [];
  const durations = strings(durationValues.map(v => typeof v === "number" ? `${v}s` : v)).filter(v => /^\d+(?:\.\d+)?s?$/i.test(v) && parseFloat(v) > 0 && parseFloat(v) <= 600);
  const batches = Array.isArray(config?.batchOptions) ? config.batchOptions.filter(v => Number.isInteger(v) && v >= 1 && v <= 4) : [];
  const batchOptions = config?.hideBatchCount === true ? [1] : batches.length ? batches : [1, 2, 3, 4];
  const batchMin = Math.min(...batchOptions), batchMax = Math.max(...batchOptions);
  return {
    ratios, resolutions, qualities, durations,
    resDisplay: [...resolutions].sort((a, b) => resolutionRank(a) - resolutionRank(b)),
    durDisplay: [...durations].sort((a, b) => parseFloat(a) - parseFloat(b)),
    batchMin, batchMax, showCount: config?.hideBatchCount !== true,
    batchChoices: Array.from({ length: batchMax - batchMin + 1 }, (_, i) => batchMin + i),
  };
}
