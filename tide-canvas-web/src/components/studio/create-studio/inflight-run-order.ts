import type { HistRun, InflightRun } from "./types";

function validTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

const LEGACY_SERVER_TIME_OFFSET = "+08:00";

/** Parse AI timestamps from both sides of a rolling deployment. New responses
 * carry an RFC3339 offset; legacy responses are naive Asia/Shanghai wall time
 * because the backend container and MySQL connection both use that timezone. */
export function parseStudioTimestamp(value: string | undefined): number {
  const normalized = value?.trim().replace(" ", "T") ?? "";
  if (!normalized) return Number.NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = Date.parse(hasZone ? normalized : `${normalized}${LEGACY_SERVER_TIME_OFFSET}`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numericId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Decide which accepted task owns the foreground recovery pointer. The API
 * timestamp has second precision, so equal timestamps must fall back to the
 * chronological Snowflake id. */
export function isStudioTaskNewerOrEqual(
  next: Pick<InflightRun, "taskId" | "startedAt">,
  current: Pick<InflightRun, "taskId" | "startedAt">,
): boolean {
  const nextTime = validTimestamp(next.startedAt);
  const currentTime = validTimestamp(current.startedAt);
  if (nextTime !== currentTime) return nextTime > currentTime;
  const nextId = numericId(next.taskId);
  const currentId = numericId(current.taskId);
  if (nextId !== null && currentId !== null) return nextId >= currentId;
  return true;
}

/** Keep every live Studio task visible exactly once, newest task first.
 * Sorting by the captured start time also makes refresh recovery deterministic:
 * an older journal resolved later must not jump above a newer task. */
export function upsertInflightRunNewestFirst(
  runs: InflightRun[],
  next: InflightRun,
): InflightRun[] {
  return [next, ...runs.filter((run) => run.taskId !== next.taskId)]
    .sort((left, right) => validTimestamp(right.startedAt) - validTimestamp(left.startedAt));
}

export type OrderedStudioFeedRun =
  | { state: "inflight"; key: string; startedAt: number; run: InflightRun }
  | { state: "finished"; key: string; startedAt: number; run: HistRun };

function numericTaskId(entry: OrderedStudioFeedRun): bigint | null {
  const raw = entry.state === "inflight"
    ? entry.run.taskId
    : /^task-(\d+)$/.exec(entry.run.run)?.[1];
  return raw ? numericId(raw) : null;
}

function newestRunFirst(
  left: OrderedStudioFeedRun,
  right: OrderedStudioFeedRun,
): number {
  const timeOrder = right.startedAt - left.startedAt;
  if (timeOrder !== 0) return timeOrder;

  // The server serializes createTime only to seconds. Snowflake task IDs retain
  // the missing sub-second order, so an older task finishing later cannot win a
  // timestamp tie. A just-clicked optimistic row has no server ID yet and must
  // stay above an equal-time historical row.
  const leftPending = left.state === "inflight" && left.run.taskId.startsWith("pending:");
  const rightPending = right.state === "inflight" && right.run.taskId.startsWith("pending:");
  if (leftPending !== rightPending) return leftPending ? -1 : 1;

  const leftId = numericTaskId(left);
  const rightId = numericTaskId(right);
  if (leftId !== null && rightId !== null && leftId !== rightId) {
    return leftId > rightId ? -1 : 1;
  }
  return 0;
}

/** Interleave live and completed runs by creation time. Keeping them in two
 * separate render groups makes a newer completed task fall below an older task
 * that is still processing. */
export function orderStudioFeedRuns(
  inflightRuns: InflightRun[],
  finishedRuns: HistRun[],
): OrderedStudioFeedRun[] {
  const liveRunKeys = new Set(inflightRuns.map((run) => `task-${run.taskId}`));
  const entries: OrderedStudioFeedRun[] = [
    ...inflightRuns.map((run) => ({
      state: "inflight" as const,
      key: `inflight-${run.taskId}`,
      startedAt: validTimestamp(run.startedAt),
      run,
    })),
    ...finishedRuns.filter((run) => !liveRunKeys.has(run.run)).map((run) => {
      const parsed = parseStudioTimestamp(run.ts);
      return {
        state: "finished" as const,
        key: `finished-${run.run}`,
        startedAt: validTimestamp(parsed),
        run,
      };
    }),
  ];

  return entries.sort(newestRunFirst);
}
