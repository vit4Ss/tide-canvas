import type { StudioModelVO } from "@/lib/market-api";

function usableModelRowId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id && id !== "0" ? id : "";
}

/**
 * Resolve the model used by a historical turn from the currently available
 * catalog. New turns persist modelRowId; old turns recover it from the linked
 * task. Only genuinely legacy records fall back to modelKey/name.
 *
 * When a non-zero row id is known but absent from the available catalog, do not
 * fall back to a look-alike row: the original model is off shelf or unavailable.
 */
export function historicalModelOf(
  p: Record<string, unknown> | undefined,
  models: readonly StudioModelVO[],
  fallbackModelRowId?: string,
): StudioModelVO | undefined {
  const modelRowId = usableModelRowId(p?.modelRowId) || usableModelRowId(fallbackModelRowId);
  const modelKey = typeof p?.modelKey === "string" ? p.modelKey : "";
  const modelName = typeof p?.model === "string" ? p.model : "";
  const outputType = typeof p?.type === "string" ? p.type : "";
  if (modelRowId) {
    return models.find((candidate) => candidate.id === modelRowId);
  }
  if (modelKey) {
    const matches = models.filter((candidate) =>
      candidate.modelKey === modelKey && (!outputType || candidate.type === outputType),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  if (!modelName) return undefined;
  const matches = models.filter((candidate) =>
    candidate.name === modelName && (!outputType || candidate.type === outputType),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
