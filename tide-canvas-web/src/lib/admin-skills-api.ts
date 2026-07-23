// Admin 技能管理 API client — wraps /api/admin/skills（admin.skills 模块权限）。
// 与公开技能广场共用 skill 表：这里的增删改上下架立即反映到各入口的技能选择器。

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { SkillQuery, SkillSaveDTO, SkillVO } from "@/types/skill";

export const adminSkillsApi = {
  list: (query: SkillQuery) => http.get<PageData<SkillVO>>("/api/admin/skills", toParams(query)),
  create: (dto: SkillSaveDTO) => http.post<SkillVO>("/api/admin/skills", dto),
  update: (id: string, dto: SkillSaveDTO) => http.put<SkillVO>(`/api/admin/skills/${id}`, dto),
  delete: (id: string) => http.delete<null>(`/api/admin/skills/${id}`),
};
