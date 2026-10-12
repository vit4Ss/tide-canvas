import type { PageData, Result } from "../types/api";
import { MEDIA_HISTORY_TYPES } from "./model-visibility.ts";

export interface HistoryRow { id: string; createTime: string }
type PageGetter<T> = (path: string, signal: AbortSignal) => Promise<Result<PageData<T>>>;

function compareRows(a: HistoryRow, b: HistoryRow) {
  const time = (Date.parse(b.createTime) || 0) - (Date.parse(a.createTime) || 0);
  if (time) return time;
  // IDs can exceed Number.MAX_SAFE_INTEGER.
  if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) return BigInt(a.id) < BigInt(b.id) ? 1 : BigInt(a.id) > BigInt(b.id) ? -1 : 0;
  return b.id.localeCompare(a.id);
}

// Merge the backend's existing per-format feeds before applying page boundaries.
// Unlike filtering an already paginated mixed list, totals and full pages stay
// meaningful. Only the next page of a depleted feed needs to be fetched.
export async function mediaHistoryPage<T extends HistoryRow>(path: string, signal: AbortSignal, getPage: PageGetter<T>): Promise<Result<PageData<T>>> {
  const url = new URL(path, "http://frontend.local");
  const pageNum = Math.max(1, Number.parseInt(url.searchParams.get("pageNum") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "24", 10) || 24));
  const selectedType = url.searchParams.get("mediaType");
  const success = (records: T[], total: number): Result<PageData<T>> => ({ success: true, code: 200, message: "", timestamp: Date.now(), data: { records, total, pageNum, pageSize, pages: Math.ceil(total / pageSize) } });
  if (selectedType) {
    if (!MEDIA_HISTORY_TYPES.some((type) => type === selectedType) && selectedType !== "upscale") return success([], 0);
    return getPage(path, signal);
  }
  try {
    const fetchPage = (type: string, page: number) => {
      signal.throwIfAborted();
      const request = new URL(url);
      request.searchParams.set("mediaType", type);
      request.searchParams.set("pageNum", String(page));
      request.searchParams.set("pageSize", String(pageSize));
      return getPage(`${request.pathname}${request.search}`, signal);
    };
    const first = await Promise.all(MEDIA_HISTORY_TYPES.map((type) => fetchPage(type, 1)));
    signal.throwIfAborted();
    const failure = first.find((result) => !result.success);
    if (failure) return failure;
    const feeds = first.map((result, index) => ({ type: MEDIA_HISTORY_TYPES[index], total: result.data.total, records: result.data.records, index: 0, consumed: 0, page: 1 }));
    const total = feeds.reduce((sum, feed) => sum + feed.total, 0);
    const start = (pageNum - 1) * pageSize;
    if (start >= total) return success([], total);
    const end = Math.min(start + pageSize, total);
    const records: T[] = [];
    for (let index = 0; index < end; index++) {
      signal.throwIfAborted();
      const ready = feeds.filter((feed) => feed.index < feed.records.length).sort((a, b) => compareRows(a.records[a.index], b.records[b.index]));
      const feed = ready[0];
      if (!feed) break;
      const row = feed.records[feed.index++];
      feed.consumed++;
      if (index >= start) records.push(row);
      if (index + 1 < end && feed.index === feed.records.length && feed.consumed < feed.total) {
        const next = await fetchPage(feed.type, ++feed.page);
        signal.throwIfAborted();
        if (!next.success) return next;
        feed.records = next.data.records;
        feed.index = 0;
      }
    }
    return success(records, total);
  } catch {
    return { success: false, code: 0, message: signal.aborted ? "Request cancelled." : "Could not load your media history. Please try again.", data: null as unknown as PageData<T>, timestamp: Date.now() };
  }
}
