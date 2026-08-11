import { contentApi } from "@/lib/content-api";
import { normalizeToolCoverPool } from "@/lib/ai-tools-catalog";

let cachedPool: string[] | null = null;
let inFlight: Promise<string[]> | null = null;

async function requestCoverPool(): Promise<string[]> {
  const lightweight = await contentApi.homeWorkCovers();
  if (lightweight.success && Array.isArray(lightweight.data)) {
    return normalizeToolCoverPool(lightweight.data);
  }

  // Rolling-deploy compatibility: an older backend does not have the narrow
  // endpoint yet. Fall back once to the established feed rather than dropping
  // old tools back to mesh covers during the deployment window.
  const legacy = await contentApi.homeFeed();
  if (!legacy.success || !legacy.data) return [];
  return normalizeToolCoverPool((legacy.data.works ?? []).map((work) => work.coverUrl));
}

/** Shared, retryable smart-tool fallback cover pool.
 *
 * Successful non-empty results are cached across client-side route changes;
 * empty/error results are not cached, so a later navigation can recover after
 * content is published or the network returns. Concurrent consumers share one
 * request. */
export function loadToolCoverPool(): Promise<string[]> {
  if (cachedPool) return Promise.resolve(cachedPool);
  if (inFlight) return inFlight;

  inFlight = requestCoverPool()
    .then((pool) => {
      if (pool.length > 0) cachedPool = pool;
      return pool;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
