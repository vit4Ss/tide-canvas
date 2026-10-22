export interface VideoPromptJob {
  id: number;
  projectId: string;
  nodeId: string;
  prompt: string;
  state: "running" | "saved";
  result?: string;
}

/** Jobs belong to canvas nodes, not to the selected node's temporary editor. */
export function createVideoPromptJobRegistry() {
  const jobs = new Map<string, VideoPromptJob>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  const key = (projectId: string, nodeId: string) => JSON.stringify([projectId, nodeId]);
  const emit = () => listeners.forEach((listener) => listener());
  const get = (projectId: string, nodeId: string) => jobs.get(key(projectId, nodeId)) ?? null;
  return {
    get,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(projectId: string, nodeId: string, prompt: string) {
      if (get(projectId, nodeId)?.state === "running") return null;
      const job: VideoPromptJob = { id: ++sequence, projectId, nodeId, prompt, state: "running" };
      jobs.set(key(projectId, nodeId), job);
      emit();
      return job;
    },
    finish(job: VideoPromptJob) {
      const current = get(job.projectId, job.nodeId);
      if (current?.id !== job.id || current.state !== "running") return;
      jobs.delete(key(job.projectId, job.nodeId));
      emit();
    },
    save(job: VideoPromptJob, result: string) {
      if (get(job.projectId, job.nodeId)?.id !== job.id) return;
      jobs.set(key(job.projectId, job.nodeId), { ...job, state: "saved", result });
      emit();
    },
  };
}

export const videoPromptJobs = createVideoPromptJobRegistry();

export function canApplyVideoPromptResult(job: VideoPromptJob, projectId: string, node?: {
  id: string; prompt?: string; status?: string; uploading?: boolean; pendingGeneration?: unknown;
}): boolean {
  return projectId === job.projectId && !!node && node.id === job.nodeId
    && (node.prompt || "") === job.prompt && node.status !== "generating"
    && !node.uploading && !node.pendingGeneration;
}
