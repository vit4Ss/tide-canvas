import { skillRunApi } from "@/lib/skill-run-api";
import { requestCanvasSave } from "@/lib/canvas-save";
import type { SkillRunArtifactVO, SkillRunVO } from "@/types/skill-run";

function parseRunInput(run: SkillRunVO): Record<string, unknown> | undefined {
  if (!run.input) return undefined;
  if (typeof run.input === "string") {
    try {
      const parsed: unknown = JSON.parse(run.input);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
  return run.input as Record<string, unknown>;
}

export function canvasSkillRunSourceNodeIds(run: SkillRunVO): string[] {
  const value = parseRunInput(run)?.sourceNodeIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function canvasSkillRunArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const byId = new Map<string, SkillRunArtifactVO>();
  for (const artifact of run.artifacts ?? []) byId.set(artifact.id, artifact);
  for (const step of run.steps ?? []) {
    for (const artifact of step.artifacts ?? []) byId.set(artifact.id, artifact);
  }
  return [...byId.values()];
}

export function createCanvasSkillClientRequestId(): string {
  return `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const pendingCreateCommits = new Set<string>();

export function pendingCanvasCreateRunIds(projectId: string): string[] {
  return skillRunApi.resolvedCreateIds(`create:canvas:${projectId}`);
}

/**
 * SkillRun create uses an accepted-create journal. Commit it only after the
 * canvas recovery pointer (and any materialized artifacts) has been saved.
 */
export async function persistCanvasRunAndCommit(projectId: string, runId: string): Promise<boolean> {
  const key = `${projectId}:${runId}`;
  if (pendingCreateCommits.has(key)) return false;
  pendingCreateCommits.add(key);
  try {
    if (!await requestCanvasSave(projectId)) return false;
    await skillRunApi.commitCreate(`create:canvas:${projectId}`, runId);
    return true;
  } finally {
    pendingCreateCommits.delete(key);
  }
}
