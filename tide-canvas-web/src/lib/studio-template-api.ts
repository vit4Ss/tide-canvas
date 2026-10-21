import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";

export interface StudioTemplate {
  id: string;
  kind: "style" | "inspiration";
  mediaType: "image" | "video";
  title: string;
  description: string;
  category: string;
  prompt: string;
  coverUrl: string;
  previewUrl: string;
  authorName: string;
  inputHint: string;
  inputLabels?: { images?: string[]; videos?: string[]; audio?: string[] };
  mode: "t2i" | "i2i" | "t2v" | "i2v" | "flf" | "ref";
  modelKey: string;
  requirements: { images: number; videos: number; audio: number };
  options: {
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    quality?: string;
    batchCount?: number;
  };
  status: number;
  sortOrder: number;
  uses: number;
}
export type StudioTemplateSave = Omit<StudioTemplate, "id" | "uses">;
export type PublicStudioTemplate = Omit<StudioTemplate, "prompt" | "modelKey" | "status" | "sortOrder">;
export type PublicTemplatePage = PageData<PublicStudioTemplate> & { categories: string[] };
export interface TemplateUploads { imageIds: string[]; videoIds: string[]; audioIds: string[] }
export interface TemplateSetup { modelId: string; modelName: string; handler: string; basePointCost: number; referenceVideoBilling: boolean; options: StudioTemplate["options"]; maxUploadBytes: Record<"image" | "video" | "audio", number> }
export interface TemplateQuote { templateId: string; modelId: string; modelName: string; handler: string; pointCost: number; quoteToken: string; options: StudioTemplate["options"]; basePointCost: number; referencePointCost: number }
export type StudioTemplatePage = PageData<StudioTemplate> & {
  categories: string[];
};
export interface TemplateQuery {
  pageNum?: number;
  pageSize?: number;
  kind?: string;
  mediaType?: string;
  category?: string;
  keyword?: string;
  status?: string;
}
export interface TemplateSource {
  id: string;
  userId: string;
  mediaType: "image" | "video";
  prompt: string;
  model: string;
  resultUrl: string;
  createTime: string;
}
const base = "/api/studio-templates";
const admin = "/api/admin/studio-templates";
export const studioTemplateApi = {
  list: (q: TemplateQuery, signal?: AbortSignal) =>
    http.get<PublicTemplatePage>(base, toParams(q), { signal }),
  get: (id: string) => http.get<PublicStudioTemplate>(`${base}/${id}`),
  setup: (id: string, signal?: AbortSignal) => http.get<TemplateSetup>(`/api/ai/template-setup/${id}`, undefined, { signal }),
  quote: (templateId: string, input: TemplateUploads, signal?: AbortSignal) =>
    http.post<TemplateQuote>("/api/ai/template-quote", { templateId, input }, { signal }),
};
export const adminStudioTemplateApi = {
  check: (row: StudioTemplateSave) => http.post<TemplateSetup>(`${admin}/check`, row),
  list: (q: TemplateQuery, signal?: AbortSignal) =>
    http.get<StudioTemplatePage>(admin, toParams(q), { signal }),
  save: (row: StudioTemplateSave, id?: string) =>
    id
      ? http.put<StudioTemplate>(`${admin}/${id}`, row)
      : http.post<StudioTemplate>(admin, row),
  remove: (id: string) => http.delete(`${admin}/${id}`),
  sources: (
    q: { pageNum?: number; userId?: string; taskId?: string },
    signal?: AbortSignal,
  ) =>
    http.get<PageData<TemplateSource>>(`${admin}/sources`, toParams(q), {
      signal,
    }),
  fromTask: (taskId: string) =>
    http.post<StudioTemplate>(`${admin}/from-task`, { taskId }),
};
