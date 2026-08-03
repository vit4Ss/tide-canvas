// Admin 技能管理 API client — wraps /api/admin/skills（admin.skills 模块权限）。
// 与公开技能广场共用 skill 表：这里的增删改上下架立即反映到各入口的技能选择器。

import { http, toParams } from "@/lib/http";
import type { PageData, Result } from "@/types/api";
import {
  normalizeSkillKind,
  type SkillOutputType,
  type SkillQuery,
  type SkillSaveDTO,
} from "@/types/skill";
import type {
  AdminSkillBindingDTO,
  AdminSkillBindingVO,
  AdminSkillImportPackage,
  AdminSkillVO,
  AdminSkillVersionCreateDTO,
  AdminSkillVersionVO,
} from "@/types/admin-skill";
import { constrainAdminSkillEntryPoints } from "@/lib/admin-skill-defaults";

function withNormalizedData<T>(result: Result<T>, normalize: (value: T) => T): Result<T> {
  return result.success && result.data
    ? { ...result, data: normalize(result.data) }
    : result;
}

function normalizeAdminSkill(skill: AdminSkillVO): AdminSkillVO {
  const kind = normalizeSkillKind((skill as { kind?: unknown }).kind);
  return {
    ...skill,
    kind,
    entryPoints: constrainAdminSkillEntryPoints(kind, skill.entryPoints),
    outputTypes: kind === "preset" ? [skill.outputType as SkillOutputType] : skill.outputTypes,
  };
}

function normalizeAdminVersion(version: AdminSkillVersionVO): AdminSkillVersionVO {
  return {
    ...version,
    kind: normalizeSkillKind((version as { kind?: unknown }).kind),
  };
}

export const adminSkillsApi = {
  list: async (query: SkillQuery) => withNormalizedData(
    await http.get<PageData<AdminSkillVO>>("/api/admin/skills", toParams(query)),
    (page) => ({ ...page, records: page.records.map(normalizeAdminSkill) }),
  ),
  create: async (dto: SkillSaveDTO) => withNormalizedData(
    await http.post<AdminSkillVO>("/api/admin/skills", dto),
    normalizeAdminSkill,
  ),
  update: async (id: string, dto: SkillSaveDTO) => withNormalizedData(
    await http.put<AdminSkillVO>(`/api/admin/skills/${id}`, dto),
    normalizeAdminSkill,
  ),
  delete: (id: string) => http.delete<null>(`/api/admin/skills/${id}`),
  listVersions: async (id: string) => withNormalizedData(
    await http.get<AdminSkillVersionVO[]>(`/api/admin/skills/${id}/versions`),
    (versions) => versions.map(normalizeAdminVersion),
  ),
  createVersion: async (id: string, dto: AdminSkillVersionCreateDTO) => withNormalizedData(
    await http.post<AdminSkillVersionVO>(`/api/admin/skills/${id}/versions`, dto),
    normalizeAdminVersion,
  ),
  importVersion: async (id: string, dto: AdminSkillVersionCreateDTO) => withNormalizedData(
    await http.post<AdminSkillVersionVO>(`/api/admin/skills/${id}/versions/import`, dto),
    normalizeAdminVersion,
  ),
  publishVersion: async (skillId: string, versionId: string) => withNormalizedData(
    await http.post<AdminSkillVersionVO>(
      `/api/admin/skills/${skillId}/versions/${versionId}/publish`,
      {},
    ),
    normalizeAdminVersion,
  ),
  getVersion: async (skillId: string, versionId: string) => withNormalizedData(
    await http.get<AdminSkillVersionVO>(`/api/admin/skills/${skillId}/versions/${versionId}`),
    normalizeAdminVersion,
  ),
  importSkills: async (skills: AdminSkillImportPackage[]) => withNormalizedData(
    await http.post<AdminSkillVersionVO[]>("/api/admin/skills/import", { skills }),
    (versions) => versions.map(normalizeAdminVersion),
  ),
  listBindings: (skillId: string) =>
    http.get<AdminSkillBindingVO[]>(`/api/admin/skills/${skillId}/bindings`),
  replaceBindings: (skillId: string, bindings: AdminSkillBindingDTO[]) =>
    http.put<AdminSkillBindingVO[]>(`/api/admin/skills/${skillId}/bindings`, { bindings }),
};
