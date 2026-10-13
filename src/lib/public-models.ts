import type { StudioModel } from "./api";
import { isMediaModel } from "./model-visibility.ts";

// Only public media catalogue entries are rendered. No invented model/version
// fallback is used when the backend is unavailable.
export function publicMediaModels(value: unknown): StudioModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((row): row is StudioModel => {
    if (!row || typeof row !== "object" || !isMediaModel(row) || typeof row.id !== "string" ||
        !row.id || typeof row.name !== "string" || !row.name.trim() || typeof row.modelKey !== "string" || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).map(row => ({ id: row.id, name: row.name, modelKey: row.modelKey, type: row.type,
    desc: typeof row.desc === "string" ? row.desc : "", pointCost: typeof row.pointCost === "string" ? row.pointCost : "",
    config: row.config && typeof row.config === "object" && !Array.isArray(row.config) ? row.config : null,
  }));
}
