// Admin · 风格管理 API — wraps /api/admin/styles（画布风格广场预设的后台维护）
import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { StylePresetVO, StylePresetSaveDTO } from "@/types/style";

export interface AdminStyleQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  status?: string; // "" | "0" | "1"
  ownerType?: string; // "" | system | user
}

export const adminStyleApi = {
  list: (query: AdminStyleQuery = {}) =>
    http.get<PageData<StylePresetVO>>("/api/admin/styles", toParams(query)),
  create: (dto: StylePresetSaveDTO) =>
    http.post<StylePresetVO>("/api/admin/styles", dto),
  update: (id: string, dto: StylePresetSaveDTO) =>
    http.put<StylePresetVO>(`/api/admin/styles/${id}`, dto),
  remove: (id: string) => http.delete<void>(`/api/admin/styles/${id}`),
};
