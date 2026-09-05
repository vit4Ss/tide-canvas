import type { SocialActivityRecordVO } from "@/types/social-record";

// Keep unchanged rows (and the list itself) stable during background refreshes.
// All list fields are scalar values; snapshots are fetched separately.
export function reconcileHistoryRows(current: SocialActivityRecordVO[], incoming: SocialActivityRecordVO[]): SocialActivityRecordVO[] {
  const existing = new Map(current.map((row) => [row.id, row]));
  const next = incoming.map((row) => {
    const previous = existing.get(row.id);
    const keys = Object.keys(row) as Array<keyof SocialActivityRecordVO>;
    return previous && keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === row[key])
      ? previous : row;
  });
  return next.length === current.length && next.every((row, index) => row === current[index]) ? current : next;
}

const POLL_INTERVAL = 5_000;
// Server-side download preparation/streaming has a one-hour deadline plus a
// stale-record grace period. The short download-ticket expiry is unrelated.
const MAX_WATCH_TIME = 65 * 60_000;

export function startDownloadHistoryPolling(
  watchId: string,
  refresh: () => Promise<SocialActivityRecordVO[] | null | undefined>,
  isPaused: () => boolean,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let missing = 0;
  const deadline = Date.now() + MAX_WATCH_TIME;

  const schedule = (delay = POLL_INTERVAL) => {
    if (!cancelled && Date.now() < deadline) timer = setTimeout(() => void poll(), delay);
  };
  const poll = async () => {
    if (cancelled || Date.now() >= deadline) return;
    if (isPaused()) {
      schedule();
      return;
    }
    let rows: SocialActivityRecordVO[] | null | undefined;
    try {
      rows = await refresh();
    } catch {
      rows = null;
    }
    if (cancelled) return;
    // undefined means a newer user request superseded this response.
    if (rows === undefined) {
      schedule();
      return;
    }
    if (rows === null) {
      failures += 1;
      if (failures < 3) schedule(POLL_INTERVAL * 2 ** failures);
      return;
    }
    failures = 0;
    const watched = rows.find((row) => row.id === watchId);
    if (watched?.status === "succeeded") return;
    if (watched && ["failed", "expired"].includes(watched.status) && !((watched.pointCost ?? 0) > 0 && !watched.refunded)) return;
    // Allow time for the native download request to create its history row,
    // but do not poll forever if the request never started or left this page.
    missing = watched ? 0 : missing + 1;
    if (missing < 6) schedule();
  };
  schedule();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
