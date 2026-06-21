// API calls for the admin 灵感 (inspiration) section — CRUD over collections
// (灵感合集/主题/提示词包) and the prompt library. Endpoints from g2_inspiration.go.

import { http, toParams } from "@/lib/http";
import type { PageData, Result } from "@/types/api";
import type {
  CollectionUpsertDTO,
  CollectionVO,
  InspirationQuery,
  PromptUpsertDTO,
  PromptVO,
} from "@/types/admin-inspiration";

export const adminInspirationApi = {
  // --- 灵感合集 (collections) ---
  listCollections: (
    query: InspirationQuery = {},
  ): Promise<Result<PageData<CollectionVO>>> =>
    http.get<PageData<CollectionVO>>(
      "/api/admin/inspiration/collections",
      toParams(query),
    ),

  createCollection: (body: CollectionUpsertDTO): Promise<Result<CollectionVO>> =>
    http.post<CollectionVO>("/api/admin/inspiration/collections", body),

  updateCollection: (
    id: string,
    body: CollectionUpsertDTO,
  ): Promise<Result<CollectionVO>> =>
    http.put<CollectionVO>(`/api/admin/inspiration/collections/${id}`, body),

  deleteCollection: (id: string): Promise<Result<null>> =>
    http.delete<null>(`/api/admin/inspiration/collections/${id}`),

  // --- 提示词库 (prompts) ---
  listPrompts: (query: InspirationQuery = {}): Promise<Result<PageData<PromptVO>>> =>
    http.get<PageData<PromptVO>>("/api/admin/inspiration/prompts", toParams(query)),

  createPrompt: (body: PromptUpsertDTO): Promise<Result<PromptVO>> =>
    http.post<PromptVO>("/api/admin/inspiration/prompts", body),

  updatePrompt: (id: string, body: PromptUpsertDTO): Promise<Result<PromptVO>> =>
    http.put<PromptVO>(`/api/admin/inspiration/prompts/${id}`, body),

  deletePrompt: (id: string): Promise<Result<null>> =>
    http.delete<null>(`/api/admin/inspiration/prompts/${id}`),
};
