import type { PageData, Result } from "@/types/api";

type MessageWithID = { id: string };

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Physical pages that contain the newest `pageSize` rows of an ASC, offset-
 * paginated collection. The tail spans at most two pages.
 */
export function chronologicalTailPageNumbers(total: number, pageSize: number): number[] {
  const size = positiveInteger(pageSize, 1);
  const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const lastPage = Math.max(1, Math.ceil(count / size));
  const firstPage = Math.max(1, Math.floor(Math.max(0, count - size) / size) + 1);

  return firstPage === lastPage ? [lastPage] : [firstPage, lastPage];
}

/** Merge ASC pages, retaining the newest representation of duplicate rows. */
export function mergeChronologicalMessageTail<T extends MessageWithID>(
  pages: readonly PageData<T>[],
  pageSize: number,
): T[] {
  const size = positiveInteger(pageSize, 1);
  const byID = new Map<string, T>();

  for (const page of [...pages].sort((left, right) => left.pageNum - right.pageNum)) {
    for (const record of page.records) {
      // Setting an existing Map key refreshes its value without changing the
      // server-established chronological position.
      byID.set(record.id, record);
    }
  }

  return [...byID.values()].slice(-size);
}

/**
 * Load a chronological tail through the ordinary page endpoint.
 *
 * A metadata request for page 1 is unavoidable. Afterwards only the physical
 * pages intersecting the requested tail are fetched. If messages arrive while
 * those requests are in flight and create a new last page, the newly observed
 * total updates the plan and the collector follows that boundary before
 * returning. Since rows are append-only here, already-full earlier pages stay
 * valid while the boundary is chased.
 */
export async function loadLatestChronologicalMessageTail<T extends MessageWithID>(
  fetchPage: (pageNum: number, pageSize: number) => Promise<Result<PageData<T>>>,
  requestedPageSize: number,
): Promise<Result<PageData<T>>> {
  const initialPageSize = positiveInteger(requestedPageSize, 100);
  const first = await fetchPage(1, initialPageSize);
  if (!first.success || !first.data) return first;

  // The server clamps pageSize, so use its actual value for every subsequent
  // offset. Mixing requested and effective sizes would shift page boundaries.
  const effectivePageSize = positiveInteger(first.data.pageSize, initialPageSize);
  const loadedPages = new Map<number, PageData<T>>([
    [positiveInteger(first.data.pageNum, 1), first.data],
  ]);
  let observedTotal = Math.max(0, Math.floor(first.data.total));
  let latestResult = first;

  for (;;) {
    const neededPages = chronologicalTailPageNumbers(observedTotal, effectivePageSize);
    const missingPage = neededPages.find((pageNum) => !loadedPages.has(pageNum));
    if (missingPage === undefined) {
      const records = mergeChronologicalMessageTail(
        neededPages.map((pageNum) => loadedPages.get(pageNum)!).filter(Boolean),
        effectivePageSize,
      );
      const pageCount = Math.max(1, Math.ceil(observedTotal / effectivePageSize));

      return {
        ...latestResult,
        data: {
          ...latestResult.data,
          records,
          total: observedTotal,
          pageNum: pageCount,
          pageSize: effectivePageSize,
          pages: pageCount,
        },
      };
    }

    const result = await fetchPage(missingPage, effectivePageSize);
    if (!result.success || !result.data) return result;

    loadedPages.set(missingPage, result.data);
    const responseTotal = Math.max(0, Math.floor(result.data.total));
    if (responseTotal >= observedTotal) {
      observedTotal = responseTotal;
      latestResult = result;
    }
  }
}
