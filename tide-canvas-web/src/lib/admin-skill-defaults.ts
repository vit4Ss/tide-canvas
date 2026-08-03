import type {
  AdminSkillBindingDTO,
} from "@/types/admin-skill";
import type {
  SkillEntryPoint,
  SkillKind,
  SkillOutputType,
} from "@/types/skill";

export const ADMIN_SKILL_ENTRY_POINTS: Array<{
  key: SkillEntryPoint;
  label: string;
}> = [
  { key: "studio", label: "创作台" },
  { key: "chat", label: "生成页" },
  { key: "canvas", label: "画布" },
];

const PRESET_ENTRY_POINTS: readonly SkillEntryPoint[] = ["studio", "chat", "canvas"];
const AGENT_ENTRY_POINTS: readonly SkillEntryPoint[] = ["canvas"];

export function defaultAdminSkillEntryPoints(kind: SkillKind): SkillEntryPoint[] {
  return [...(kind === "agent" ? AGENT_ENTRY_POINTS : PRESET_ENTRY_POINTS)];
}

/** Keep imported/historical placement inside the two supported product shapes. */
export function constrainAdminSkillEntryPoints(
  kind: SkillKind,
  entryPoints: readonly SkillEntryPoint[] | null | undefined,
): SkillEntryPoint[] {
  if (kind === "agent") return ["canvas"];
  const allowed = new Set(PRESET_ENTRY_POINTS);
  const constrained = [...new Set((entryPoints ?? []).filter((entry) => allowed.has(entry)))];
  return constrained.length ? constrained : defaultAdminSkillEntryPoints("preset");
}

export function defaultAdminSkillOutputTypes(
  _kind: SkillKind,
  primaryOutputType: SkillOutputType,
): SkillOutputType[] {
  return [primaryOutputType];
}

/**
 * Produce a valid, immediately runnable v1 manifest for the unified create
 * form. Advanced edits still happen through the immutable version editor.
 */
export function starterAdminSkillManifest(
  kind: SkillKind,
  primaryOutputType: SkillOutputType,
  modelId = "",
): Record<string, unknown> {
  void modelId;
  const outputTypes = defaultAdminSkillOutputTypes(kind, primaryOutputType);
  return {
    kind,
    primaryOutputType,
    outputTypes,
  };
}

export function defaultAdminSkillTarget(
  surface: SkillEntryPoint,
  primaryOutputType: SkillOutputType,
): string {
  // asset/* also covers character and scene assets, which are image-only.
  // Non-image skills remain available in asset management under "general".
  return surface === "asset" && primaryOutputType !== "image" ? "general" : "*";
}

export function defaultAdminSkillBindings(
  entryPoints: readonly SkillEntryPoint[],
  primaryOutputType: SkillOutputType,
): AdminSkillBindingDTO[] {
  return entryPoints.map((surface, sortOrder) => ({
    surface,
    targetType: defaultAdminSkillTarget(surface, primaryOutputType),
    enabled: true,
    sortOrder,
    defaults: {},
  }));
}
