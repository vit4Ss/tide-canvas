import type { SkillRunArtifactVO, SkillRunVO } from "@/types/skill-run";

export function runArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const rows = [...(run.artifacts ?? []), ...(run.steps ?? []).flatMap((step) => step.artifacts ?? [])];
  const seen = new Set<string>();
  return rows.filter((artifact) => {
    const key = artifact.id || `${artifact.type}:${artifact.url || artifact.text || artifact.content || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function presentableSkillRun(run: SkillRunVO): SkillRunVO {
  const keep = (artifact: SkillRunArtifactVO) =>
    artifact.isFinal !== false && artifact.role !== "intermediate" && artifact.role !== "draft";
  return {
    ...run,
    artifacts: run.artifacts?.filter(keep),
    steps: run.steps?.map((step) => ({ ...step, artifacts: step.artifacts?.filter(keep) })),
  };
}

/** Return Markdown only when a succeeded run's complete presentable output is
 * text. Any file/media output keeps the richer SkillRun presentation. Explicit
 * final artifacts win over unlabelled legacy text, so planning traces cannot
 * leak into the reply when a proper final result exists. */
export function finalTextSkillResult(run: SkillRunVO): string {
  if (run.status !== "succeeded") return "";
  const presentable = runArtifacts(presentableSkillRun(run));
  if (!presentable.length || presentable.some((artifact) => artifact.type !== "text")) return "";
  const explicitFinal = presentable.filter((artifact) => artifact.isFinal === true || artifact.role === "final");
  const artifacts = explicitFinal.length ? explicitFinal : presentable;
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const artifact of artifacts) {
    const text = artifact.text?.trim() || artifact.content?.trim() || "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts.join("\n\n");
}
