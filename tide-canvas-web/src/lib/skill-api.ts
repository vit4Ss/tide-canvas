// 公开技能广场 API（JWTAuth）：列表 + 使用计数。内容由后台 /admin/skills 维护。

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { SkillQuery, SkillVO } from "@/types/skill";

export const skillApi = {
  /** GET /api/skills -> PageData<SkillVO>（仅上架，sortOrder 升序） */
  list: (query: SkillQuery) => http.get<PageData<SkillVO>>("/api/skills", toParams(query)),

  /** POST /api/skills/:id/use —— 使用计数 +1（发送生成时 fire-and-forget） */
  recordUse: (id: string) => http.post<null>(`/api/skills/${id}/use`, {}),
};

/** 技能模板与用户描述的合并口径（三个入口统一）：模板在前定基调，用户描述随后。
    用户没写描述时只发模板。 */
export function mergeSkillPrompt(template: string, userText: string): string {
  const t = template.trim();
  const u = userText.trim();
  if (!t) return u;
  if (!u) return t;
  return `${t}\n\n${u}`;
}

/** 技能默认参数（宽松解析；非法 JSON / 非对象返回空）。各入口只取自己认识的键。 */
export interface SkillParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  quality?: string;
}

export function parseSkillParams(raw: string | undefined): SkillParams {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const o = v as Record<string, unknown>;
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
