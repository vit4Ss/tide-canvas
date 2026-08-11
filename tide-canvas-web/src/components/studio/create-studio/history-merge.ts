import type { HistItem } from "./types";

function historyTime(item: HistItem): number {
  const parsed = item.ts ? Date.parse(item.ts) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merge a refreshed first page without erasing a task that completed locally
 * after the server request began. Server rows replace the same task/run, while
 * genuinely newer local runs remain visible until the next refresh includes
 * them.
 */
export function mergeInitialStudioHistory(
  current: readonly HistItem[],
  fetched: readonly HistItem[],
): HistItem[] {
  const fetchedRuns = new Set(fetched.map((item) => item.run));
  return [
    ...current.filter((item) => !fetchedRuns.has(item.run)),
    ...fetched,
  ].sort((left, right) => historyTime(right) - historyTime(left));
}
