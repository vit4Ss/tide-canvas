import type { HistRun, InflightRun } from "./types";

function validTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
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
      const parsed = run.ts ? Date.parse(run.ts) : Number.NaN;
      return {
        state: "finished" as const,
        key: `finished-${run.run}`,
        startedAt: validTimestamp(parsed),
        run,
      };
    }),
  ];

  return entries.sort((left, right) => right.startedAt - left.startedAt);
}
