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
  { key: "chat", label: "对话" },
  { key: "canvas", label: "画布" },
  { key: "asset", label: "资产管理" },
  { key: "api", label: "API" },
];

const MEDIA_OUTPUTS = new Set<SkillOutputType>(["image", "video", "audio"]);

export function defaultAdminSkillOutputTypes(
  kind: SkillKind,
  primaryOutputType: SkillOutputType,
): SkillOutputType[] {
  if (kind === "workflow" && MEDIA_OUTPUTS.has(primaryOutputType)) {
    return [primaryOutputType, "text"];
  }
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
  const outputTypes = defaultAdminSkillOutputTypes(kind, primaryOutputType);
  if (kind !== "workflow") {
    return { kind, primaryOutputType, outputTypes };
  }

  const configuredModel = modelId.trim();
  if (!MEDIA_OUTPUTS.has(primaryOutputType)) {
    return {
      kind,
      primaryOutputType,
      outputTypes,
      steps: [
        {
          key: "draft",
          title: "生成初稿",
          type: "text",
          handler: "skill_text_completion",
          ...(configuredModel ? { modelId: configuredModel } : {}),
          prompt: "{{prompt}}",
          outputType: primaryOutputType,
          outputRole: "draft",
        },
        {
          key: "confirm_draft",
          title: "确认初稿",
          type: "approval",
          message: "确认后完成；需要调整时请提交修改意见。",
          promotePrevious: true,
        },
      ],
    };
  }

  return {
    kind,
    primaryOutputType,
    outputTypes,
    steps: [
      {
        key: "plan",
        title: "整理生成方案",
        type: "text",
        handler: "skill_text_completion",
        prompt: "将用户目标整理为一份可直接用于生成的清晰提示词：\n{{prompt}}",
        outputType: "text",
        outputRole: "intermediate",
        registerWork: false,
      },
      {
        key: "generate",
        title: "生成结果",
        type: "generate",
        ...(configuredModel ? { modelId: configuredModel } : {}),
        prompt: "{{previous}}",
        outputType: primaryOutputType,
        outputRole: "draft",
      },
      {
        key: "confirm_result",
        title: "确认生成结果",
        type: "approval",
        message: "确认后完成；需要调整时请提交修改意见。",
        promotePrevious: true,
      },
    ],
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
