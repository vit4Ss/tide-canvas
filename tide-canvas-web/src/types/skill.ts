// ============================================================================
// 技能(Skill)有三种产品形态：preset 是单一输出的预设生成；
// agent 在画布中持续对话与编排；tool 是创作台/API 中受控执行的工具能力。
// ============================================================================

export type SkillKind = "preset" | "agent" | "tool";

export type SkillEntryPoint = "studio" | "chat" | "canvas" | "asset" | "api";

export type SkillOutputType = "image" | "video" | "audio" | "text" | "file";

export interface SkillInputFieldOption {
  label: string;
  value: string | number;
}

/**
 * 后台可以直接保存 fields 结构，也可以保存标准 JSON Schema 的 properties。
 * 前端动态表单只消费这组稳定的最小字段，未知扩展会被安全忽略。
 */
export interface SkillInputField {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select" | "boolean";
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: SkillInputFieldOption[];
  enum?: Array<string | number>;
  min?: number;
  max?: number;
  step?: number;
}

export interface SkillInputSchema {
  fields?: SkillInputField[];
  required?: string[];
  properties?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SkillVO {
  id: string;
  title: string;
  description: string;
  usageScenario?: string;
  howTo?: string;
  outputDescription?: string;
  coverUrl: string;
  category: string;
  /** image | video | audio | text —— 卡片角标 + 各入口按模态过滤 */
  outputType: string;
  /** 旧数据可能暂时不返回；消费端统一用 skillKindOf 回退为 preset。 */
  kind?: SkillKind;
  /** 当前已发布版本。preset/旧数据没有版本时为空。 */
  currentVersionId?: string;
  /** 允许启动该技能的产品入口；空数组/缺省表示兼容全部旧入口。 */
  entryPoints?: SkillEntryPoint[];
  /** 智能技能可产生多个类型；预设技能始终只使用 outputType。 */
  outputTypes?: SkillOutputType[];
  /** 动态输入表单定义。后端迁移期间同时兼容 JSON 字符串与对象。 */
  inputSchema?: SkillInputSchema | string | null;
  /** Legacy-only preset internals. Public callers send skillId and let the server resolve these. */
  promptTemplate?: string;
  /** 关联模型卡（AiModelVO.modelId 上游键；空 = 不指定） */
  modelId?: string;
  /** JSON 对象串，如 {"aspectRatio":"16:9","resolution":"720P","duration":5} */
  defaultParams?: string;
  authorName: string;
  /** 0 下架 / 1 上架 */
  status: number;
  sortOrder: number;
  useCount: number;
  createTime: string;
  updateTime: string;
}

export interface SkillQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  outputType?: string;
  kind?: SkillKind;
  kinds?: string;
  entryPoint?: SkillEntryPoint;
  /** Surface-specific placement target, e.g. a canvas node type or asset category. */
  targetType?: string;
  /** admin 专用：按状态过滤 */
  status?: number;
}

/** admin 新建/编辑技能（AdminSkillSaveDTO） */
export interface SkillSaveDTO {
  title: string;
  description?: string;
  usageScenario?: string;
  howTo?: string;
  outputDescription?: string;
  coverUrl?: string;
  category?: string;
  outputType: string;
  kind?: SkillKind;
  entryPoints?: SkillEntryPoint[];
  outputTypes?: SkillOutputType[];
  inputSchema?: SkillInputSchema | string;
  promptTemplate: string;
  modelId?: string;
  defaultParams?: string;
  authorName?: string;
  status?: number;
  sortOrder?: number;
}

/** 分类目录（前后台同一份；分类存自由串，这里是推荐值） */
export const SKILL_CATEGORIES = [
  "专业影视",
  "商业广告",
  "短剧漫剧",
  "动漫游戏",
  "音乐MV",
  "自媒体创作",
  "通用技能",
  "办公文档",
  "内容分析",
] as const;

export const SKILL_OUTPUT_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
  file: "文件",
};

export const SKILL_KIND_LABEL: Record<SkillKind, string> = {
  preset: "预设",
  agent: "智能技能",
  tool: "技能工具",
};

/**
 * 数据迁移期可能仍收到历史 workflow。它已是智能技能的旧名，
 * 只在边界归一，不再向产品层暴露 workflow 这一历史类型。
 */
export function normalizeSkillKind(kind: unknown): SkillKind {
  if (kind === "tool") return "tool";
  return kind === "agent" || kind === "workflow" ? "agent" : "preset";
}

export function skillKindOf(skill: { kind?: unknown }): SkillKind {
  return normalizeSkillKind(skill.kind);
}

export function skillOutputTypesOf(
  skill: Pick<SkillVO, "kind" | "outputType" | "outputTypes">,
): SkillOutputType[] {
  const fallback = skill.outputType as SkillOutputType;
  if (skillKindOf(skill) === "preset") return fallback ? [fallback] : [];
  const values = Array.isArray(skill.outputTypes)
    ? skill.outputTypes.filter((v): v is SkillOutputType =>
        v === "image" || v === "video" || v === "audio" || v === "text" || v === "file",
      )
    : [];
  if (values.length) return [...new Set(values)];
  return fallback ? [fallback] : [];
}

export function skillSupportsEntryPoint(
  skill: Pick<SkillVO, "kind" | "entryPoints">,
  entryPoint?: SkillEntryPoint,
): boolean {
  if (!entryPoint) return true;
  const kind = skillKindOf(skill);
  if (kind === "agent") return entryPoint === "canvas";
  if (kind === "tool") {
    if (entryPoint !== "studio" && entryPoint !== "api") return false;
    if (!Array.isArray(skill.entryPoints) || skill.entryPoints.length === 0) return entryPoint === "studio";
    return skill.entryPoints.includes(entryPoint);
  }
  if (entryPoint !== "studio" && entryPoint !== "chat" && entryPoint !== "canvas") return false;
  if (!Array.isArray(skill.entryPoints) || skill.entryPoints.length === 0) return true;
  return skill.entryPoints.includes(entryPoint);
}

export function skillSupportsOutput(
  skill: Pick<SkillVO, "kind" | "outputType" | "outputTypes">,
  outputType?: string,
): boolean {
  if (!outputType) return true;
  const outputs = skillOutputTypesOf(skill);
  // Presets are deliberately single-output; agents may declare multiple
  // products from one conversational canvas run.
  return outputs.includes(outputType as SkillOutputType);
}
