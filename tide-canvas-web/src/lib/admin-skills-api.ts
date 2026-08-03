// Admin 技能管理 API client — wraps /api/admin/skills（admin.skills 模块权限）。
// 与公开技能广场共用 skill 表：这里的增删改上下架立即反映到各入口的技能选择器。

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { SkillQuery, SkillSaveDTO } from "@/types/skill";
import type {
  AdminSkillBindingDTO,
  AdminSkillBindingVO,
  AdminSkillImportPackage,
  AdminSkillVO,
  AdminSkillVersionCreateDTO,
  AdminSkillVersionVO,
} from "@/types/admin-skill";

export const adminSkillsApi = {
  list: (query: SkillQuery) => http.get<PageData<AdminSkillVO>>("/api/admin/skills", toParams(query)),
  create: (dto: SkillSaveDTO) => http.post<AdminSkillVO>("/api/admin/skills", dto),
  update: (id: string, dto: SkillSaveDTO) => http.put<AdminSkillVO>(`/api/admin/skills/${id}`, dto),
  delete: (id: string) => http.delete<null>(`/api/admin/skills/${id}`),
  listVersions: (id: string) =>
    http.get<AdminSkillVersionVO[]>(`/api/admin/skills/${id}/versions`),
  createVersion: (id: string, dto: AdminSkillVersionCreateDTO) =>
    http.post<AdminSkillVersionVO>(`/api/admin/skills/${id}/versions`, dto),
  importVersion: (id: string, dto: AdminSkillVersionCreateDTO) =>
    http.post<AdminSkillVersionVO>(`/api/admin/skills/${id}/versions/import`, dto),
  publishVersion: (skillId: string, versionId: string) =>
    http.post<AdminSkillVersionVO>(
      `/api/admin/skills/${skillId}/versions/${versionId}/publish`,
      {},
    ),
  getVersion: (skillId: string, versionId: string) =>
    http.get<AdminSkillVersionVO>(`/api/admin/skills/${skillId}/versions/${versionId}`),
  importSkills: (skills: AdminSkillImportPackage[]) =>
    http.post<AdminSkillVersionVO[]>("/api/admin/skills/import", { skills }),
  listBindings: (skillId: string) =>
    http.get<AdminSkillBindingVO[]>(`/api/admin/skills/${skillId}/bindings`),
  replaceBindings: (skillId: string, bindings: AdminSkillBindingDTO[]) =>
    http.put<AdminSkillBindingVO[]>(`/api/admin/skills/${skillId}/bindings`, { bindings }),
};
