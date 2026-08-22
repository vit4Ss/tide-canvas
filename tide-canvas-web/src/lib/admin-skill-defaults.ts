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
  { key: "api", label: "API" },
];

const PRESET_ENTRY_POINTS: readonly SkillEntryPoint[] = ["studio", "chat", "canvas"];
const AGENT_ENTRY_POINTS: readonly SkillEntryPoint[] = ["canvas"];
const TOOL_ENTRY_POINTS: readonly SkillEntryPoint[] = ["studio", "api"];

export function defaultAdminSkillEntryPoints(kind: SkillKind): SkillEntryPoint[] {
  if (kind === "agent") return [...AGENT_ENTRY_POINTS];
  if (kind === "tool") return ["studio"];
  return [...PRESET_ENTRY_POINTS];
}

/** Keep imported/historical placement inside the two supported product shapes. */
export function constrainAdminSkillEntryPoints(
  kind: SkillKind,
  entryPoints: readonly SkillEntryPoint[] | null | undefined,
): SkillEntryPoint[] {
  if (kind === "agent") return ["canvas"];
  const allowed = new Set(kind === "tool" ? TOOL_ENTRY_POINTS : PRESET_ENTRY_POINTS);
  const constrained = [...new Set((entryPoints ?? []).filter((entry) => allowed.has(entry)))];
  return constrained.length ? constrained : defaultAdminSkillEntryPoints(kind);
}

export function defaultAdminSkillOutputTypes(
  kind: SkillKind,
  primaryOutputType: SkillOutputType,
): SkillOutputType[] {
  if (kind === "tool" && primaryOutputType === "file") return ["text", "file"];
  return [primaryOutputType];
}

export function starterAdminSkillInputSchema(
  kind: SkillKind,
  primaryOutputType: SkillOutputType,
): Record<string, unknown> {
  if (kind !== "tool") return { type: "object", properties: {} };
  if (primaryOutputType === "text") {
    return {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          title: "网页地址",
          format: "uri",
          pattern: "^https?://",
          placeholder: "https://example.com/article",
        },
      },
    };
  }
  return { type: "object", required: ["prompt"], properties: {} };
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
  if (kind === "tool") {
    const steps = primaryOutputType === "file"
      ? [
          {
            key: "prepare",
            title: "整理内容",
            type: "text",
            handler: "skill_text_completion",
            outputType: "text",
            outputRole: "intermediate",
            prompt: "{{prompt}}",
          },
          {
            key: "render",
            title: "生成文件",
            type: "tool",
            handler: "render_markdown",
            outputType: "file",
            outputRole: "final",
            prompt: "{{previous}}",
          },
        ]
      : [
          {
            key: "analyze",
            title: "分析网页",
            type: "tool",
            handler: "analyze_webpage",
            outputType: "text",
            outputRole: "final",
            prompt: "{{prompt}}",
          },
        ];
    return { kind, primaryOutputType, outputTypes, steps };
  }
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
