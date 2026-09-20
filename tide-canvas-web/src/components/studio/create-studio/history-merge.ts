import type { HistItem } from "./types";

export function nextHistoryRequest(lastPage: number, loadedCount: number) {
  // An unsuccessful initial load has not consumed page 1.
  return loadedCount > 0 ? { page: lastPage + 1, append: true } : { page: 1, append: false };
}

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
  excludedRuns: ReadonlySet<string> = new Set(),
): HistItem[] {
  const currentByRun = new Map<string, HistItem>();
  for (const item of current) currentByRun.set(item.run, item);
  const accepted = fetched.filter((item) => {
    const previous = currentByRun.get(item.run);
    if (!previous || item.status !== "processing") return true;
    // Initial load, pagination and external-task polling may overlap. A late
    // processing snapshot must never replace a terminal result or newer progress.
    if (previous.status && previous.status !== "processing") return false;
    if (previous.url) return false;
    return (item.progress ?? 0) >= (previous.progress ?? 0);
  });
  const fetchedRuns = new Set(accepted.map((item) => item.run));
  return [
    ...current.filter((item) => !fetchedRuns.has(item.run)),
    ...accepted,
  ].filter((item) => !excludedRuns.has(item.run)).sort((left, right) => historyTime(right) - historyTime(left));
}
