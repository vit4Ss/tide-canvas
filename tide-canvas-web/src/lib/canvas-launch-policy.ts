export type CanvasLaunchExecutionKind = "direct" | "preset" | "agent";

export function canvasLaunchKindFor(skill: { kind?: unknown } | null | undefined): CanvasLaunchExecutionKind {
  if (!skill) return "direct";
  return skill.kind === "agent" || skill.kind === "workflow" ? "agent" : "preset";
}

export function canvasLaunchNeedsDirectModel(skill: { kind?: unknown } | null | undefined): boolean {
  return canvasLaunchKindFor(skill) === "direct";
}

/** The project-library launcher starts a video canvas when no Skill owns the
 * execution. Image/audio generation remains available through preset Skills
 * and through the corresponding nodes inside the canvas. */
export function canvasLauncherAllowsDirectModel(
  model: { type?: unknown } | null | undefined,
): boolean {
  return model?.type === "video";
}

/** Shared journal/UI/submit gate: Skills are executed by the assistant and do
 * not require a direct model; a no-Skill launch must name one. */
export function canvasLaunchCanSubmit(
  skill: { kind?: unknown } | null | undefined,
  directModelId: unknown,
): boolean {
  return !canvasLaunchNeedsDirectModel(skill)
    || (typeof directModelId === "string" && directModelId.trim().length > 0);
}
