// 公开技能广场 API（JWTAuth）：列表 + 使用计数。内容由后台 /admin/skills 维护。

import { http, toParams } from "@/lib/http";
import type { PageData, Result } from "@/types/api";
import type {
  SkillEntryPoint,
  SkillInputField,
  SkillInputSchema,
  SkillKind,
  SkillOutputType,
  SkillQuery,
  SkillVO,
} from "@/types/skill";
import { normalizeSkillKind } from "@/types/skill";
import type { SkillRunInput } from "@/types/skill-run";

const PRESET_ENTRY_POINTS: readonly SkillEntryPoint[] = ["studio", "chat", "canvas"];
const TOOL_ENTRY_POINTS: readonly SkillEntryPoint[] = ["studio", "api"];

function normalizeSkill(skill: SkillVO): SkillVO {
  const kind = normalizeSkillKind((skill as { kind?: unknown }).kind);
  const allowedEntries = kind === "tool" ? TOOL_ENTRY_POINTS : PRESET_ENTRY_POINTS;
  const fallbackEntries = kind === "tool" ? (["studio"] as const) : PRESET_ENTRY_POINTS;
  const entryPoints = kind === "agent"
    ? ["canvas" as const]
    : [...new Set((skill.entryPoints ?? fallbackEntries).filter((entry) => allowedEntries.includes(entry)))];
  return {
    ...skill,
    kind,
    entryPoints: entryPoints.length ? entryPoints : [...fallbackEntries],
    outputTypes: kind === "preset"
      ? [skill.outputType as SkillOutputType]
      : skill.outputTypes,
  };
}

function normalizeSkillPage(result: Result<PageData<SkillVO>>): Result<PageData<SkillVO>> {
  if (!result.success || !result.data) return result;
  return {
    ...result,
    data: {
      ...result.data,
      records: result.data.records.map(normalizeSkill),
    },
  };
}

export const skillApi = {
  /** GET /api/skills -> PageData<SkillVO>（仅上架，sortOrder 升序） */
  list: async (query: SkillQuery) => normalizeSkillPage(
    await http.get<PageData<SkillVO>>("/api/skills", toParams(query)),
  ),

  /**
   * GET /api/skills/:id —— 重新编辑/再次生成前重新读取当前已发布版本。
   * entryPoint + targetType 让服务端同时校验该技能仍在当前入口启用，避免
   * 历史快照把已下架或已解绑的技能静默套到新一轮生成上。
   */
  get: async (
    id: string,
    entryPoint?: SkillEntryPoint,
    targetType?: string,
  ): Promise<Result<SkillVO>> => {
    const result = await http.get<SkillVO>(
      `/api/skills/${encodeURIComponent(id)}`,
      toParams({ entryPoint, targetType }),
    );
    if (!result.success || !result.data) return result;
    return { ...result, data: normalizeSkill(result.data) };
  },

  /** GET /api/skills/categories -> string[]（该模态下确实有技能的分类，用于隐藏空页签） */
  categories: (
    outputType?: string,
    entryPoint?: SkillEntryPoint,
    kinds?: SkillKind[],
    targetType?: string,
  ) =>
    http.get<string[]>(
      "/api/skills/categories",
      toParams({ outputType, entryPoint, kinds: kinds?.length ? kinds.join(",") : undefined, targetType }),
    ),

  /** POST /api/skills/:id/use —— 使用计数 +1（发送生成时 fire-and-forget） */
  recordUse: (id: string) => http.post<null>(`/api/skills/${id}/use`, {}),
};

/* 模板与描述的合并已下沉到服务端（handler/ai/work.go 的 applySkill）：四个入口
   只在 input 里带 skillId，后端按「模板在前、用户描述随后」拼好再发上游。
   客户端先拼的话，落库的 input 会变成「模板+描述」，作品标题、日志与
   「重新编辑」读到的就全是技能模板开头——同一技能生成的作品会全部同名。 */

/** 技能默认参数（宽松解析；非法 JSON / 非对象返回空）。各入口只取自己认识的键。 */
export interface SkillParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  quality?: string;
}

export function parseSkillDefaultValues(
  raw: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return Array.isArray(raw) ? {} : { ...raw };
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseSkillParams(raw: string | undefined): SkillParams {
  const o = parseSkillDefaultValues(raw);
  try {
    const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
    const n = (x: unknown) =>
      typeof x === "number" && Number.isFinite(x) && x > 0
        ? x
        : typeof x === "string" && /^\d+$/.test(x.trim())
          ? parseInt(x.trim(), 10)
          : undefined;
    return {
      aspectRatio: s(o.aspectRatio) ?? s(o.ratio),
      resolution: s(o.resolution) ?? s(o.clarity),
      duration: n(o.duration),
      quality: s(o.quality),
    };
  } catch {
    return {};
  }
}

/** Parse the versioned dynamic-input schema without letting malformed admin data break an entry surface. */
export function parseSkillInputSchema(
  raw: SkillInputSchema | string | null | undefined,
): SkillInputSchema | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as SkillInputSchema)
      : null;
  } catch {
    return null;
  }
}

/**
 * Normalize our compact fields format and the common JSON-Schema properties
 * format into one predictable form used by every Skill launcher.
 */
export function skillInputFields(
  raw: SkillInputSchema | string | null | undefined,
): SkillInputField[] {
  const schema = parseSkillInputSchema(raw);
  if (!schema) return [];
  const reserved = new Set(["prompt", "assets", "sourceNodeIds", "parameters"]);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  if (Array.isArray(schema.fields)) {
    return schema.fields
      .filter((field): field is SkillInputField =>
        !!field &&
        typeof field.key === "string" &&
        !!field.key.trim() &&
        !reserved.has(field.key.trim()),
      )
      .map((field) => ({ ...field, key: field.key.trim(), required: field.required || required.has(field.key) }));
  }
  if (!schema.properties || typeof schema.properties !== "object") return [];
  return Object.entries(schema.properties).flatMap(([key, spec]) => {
    if (reserved.has(key)) return [];
    if (!spec || typeof spec !== "object") return [];
    const type = String(spec.type ?? "string");
    const enumValues = Array.isArray(spec.enum)
      ? spec.enum.filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      : undefined;
    const uiWidget = String(spec["x-ui-widget"] ?? spec.format ?? "");
    const fieldType: SkillInputField["type"] = enumValues?.length
      ? "select"
      : type === "boolean"
        ? "boolean"
        : type === "number" || type === "integer"
          ? "number"
          : uiWidget === "textarea" || uiWidget === "multiline"
            ? "textarea"
            : "text";
    return [{
      key,
      label: String(spec.title ?? key),
      type: fieldType,
      description: typeof spec.description === "string" ? spec.description : undefined,
      placeholder: typeof spec.placeholder === "string" ? spec.placeholder : undefined,
      required: required.has(key),
      default:
        typeof spec.default === "string" || typeof spec.default === "number" || typeof spec.default === "boolean"
          ? spec.default
          : undefined,
      enum: enumValues,
      min: typeof spec.minimum === "number" ? spec.minimum : undefined,
      max: typeof spec.maximum === "number" ? spec.maximum : undefined,
      step: typeof spec.multipleOf === "number" ? spec.multipleOf : undefined,
    } satisfies SkillInputField];
  });
}

export function defaultSkillInputValues(
  raw: SkillInputSchema | string | null | undefined,
  defaultParams?: string | Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = skillInputFields(raw);
  for (const field of fields) {
    if (field.default !== undefined) out[field.key] = field.default;
    else if (field.type === "boolean") out[field.key] = false;
  }
  const configured = parseSkillDefaultValues(defaultParams);
  for (const field of fields) {
    if (configured[field.key] !== undefined) out[field.key] = configured[field.key];
  }
  return out;
}

export function validateSkillInputValues(
  raw: SkillInputSchema | string | null | undefined,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of skillInputFields(raw)) {
    const value = values[field.key];
    if (
      field.required &&
      (value === undefined || value === null || (typeof value === "string" && value.trim() === ""))
    ) {
      errors[field.key] = `请填写${field.label}`;
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors[field.key] = `${field.label}必须是数字`;
      continue;
    }
    if (field.type === "boolean" && typeof value !== "boolean") {
      errors[field.key] = `${field.label}必须是布尔值`;
      continue;
    }
    if ((field.type === "text" || field.type === "textarea" || !field.type) && typeof value !== "string") {
      errors[field.key] = `${field.label}必须是文本`;
      continue;
    }
    if (field.type === "select") {
      const allowed = field.options?.map((option) => option.value) ?? field.enum ?? [];
      if (allowed.length && !allowed.some((item) => Object.is(item, value))) {
        errors[field.key] = `请选择有效的${field.label}`;
        continue;
      }
    }
    if (typeof value === "number" && field.min !== undefined && value < field.min) {
      errors[field.key] = `${field.label}不能小于 ${field.min}`;
      continue;
    }
    if (typeof value === "number" && field.max !== undefined && value > field.max) {
      errors[field.key] = `${field.label}不能大于 ${field.max}`;
    }
  }
  return errors;
}

/** Validate both dynamic parameters and the stable top-level run inputs that a
 * JSON Schema may explicitly mark as required. Reserved keys are rendered by
 * each product surface, so they are intentionally absent from SkillInputFields. */
export function validateSkillRunInputValues(
  raw: SkillInputSchema | string | null | undefined,
  input: SkillRunInput,
): Record<string, string> {
  const errors = validateSkillInputValues(raw, input.parameters);
  const schema = parseSkillInputSchema(raw);
  if (!schema) return errors;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  if (Array.isArray(schema.fields)) {
    for (const field of schema.fields) {
      if (field?.required && typeof field.key === "string") required.add(field.key);
    }
  }
  if (required.has("prompt") && !input.prompt.trim()) errors.prompt = "请填写创作描述";
  if (required.has("assets") && input.assets.length === 0) errors.assets = "请至少添加一个参考素材";
  if (required.has("sourceNodeIds") && input.sourceNodeIds.length === 0) {
    errors.sourceNodeIds = "请至少选择一个来源节点";
  }
  if (required.has("parameters") && Object.keys(input.parameters).length === 0) {
    errors.parameters = "请填写技能参数";
  }
  return errors;
}
