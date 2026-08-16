export interface StoryboardPollTask {
  status: number;
  errorMsg?: string;
}

interface StoryboardTaskOptions<T extends StoryboardPollTask> {
  taskId: string;
  active: () => boolean;
  getTask: (taskId: string) => Promise<T | null>;
  cancelTask: (taskId: string) => Promise<unknown>;
  onClaim: (taskId: string) => void;
  onRelease: (taskId: string) => void;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

const TASK_SUCCESS = 1;
const TASK_FAILED = 2;
const TASK_CANCELLED = 3;

/**
 * Own and poll one paid storyboard task. A task that arrives after its UI run
 * was cancelled is deleted before it can become an untracked charge. Release
 * always carries the owned id so a stale run cannot clear a newer run's task.
 */
export async function awaitStoryboardAnalysisTask<T extends StoryboardPollTask>(
  options: StoryboardTaskOptions<T>,
): Promise<T | null> {
  const {
    taskId,
    active,
    getTask,
    cancelTask,
    onClaim,
    onRelease,
    timeoutMs = 5 * 60_000,
    pollIntervalMs = 1500,
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  if (!active()) {
    await cancelTask(taskId).catch(() => undefined);
    return null;
  }

  onClaim(taskId);
  const deadline = now() + timeoutMs;
  try {
    while (active() && now() < deadline) {
      const task = await getTask(taskId).catch(() => null);
      if (!active()) return null;
      if (!task) {
        await wait(pollIntervalMs);
        continue;
      }
      if (task.status === TASK_SUCCESS) return task;
      if (task.status === TASK_FAILED || task.status === TASK_CANCELLED) {
        throw new Error(task.errorMsg || "镜头语义分析失败");
      }
      await wait(pollIntervalMs);
    }
    if (!active()) return null;
    await cancelTask(taskId).catch(() => undefined);
    throw new Error("镜头语义分析等待超时，任务已停止");
  } finally {
    onRelease(taskId);
  }
}

/** Delete only the temporary captured-frame tasks owned by an aborted run. */
export async function cleanupStoryboardFrameTasks(
  taskIds: readonly string[],
  cancelTask: (taskId: string) => Promise<unknown>,
): Promise<void> {
  await Promise.allSettled([...new Set(taskIds)].map((taskId) => cancelTask(taskId)));
}
