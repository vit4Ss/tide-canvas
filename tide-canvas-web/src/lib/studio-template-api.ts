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
  requirements: {
    images: number;
    videos: number;
    audio: number;
    optionalImages?: number[];
  };
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
export type PublicStudioTemplate = Omit<
  StudioTemplate,
  "prompt" | "modelKey" | "status" | "sortOrder"
>;
export type PublicTemplatePage = PageData<PublicStudioTemplate> & {
  categories: string[];
};
export interface TemplateUploads {
  imageIds: string[];
  videoIds: string[];
  audioIds: string[];
  imageSlots?: number[];
}
export interface TemplateSetup {
  modelId: string;
  modelName: string;
  handler: string;
  basePointCost: number;
  referenceVideoBilling: boolean;
  options: StudioTemplate["options"];
  maxUploadBytes: Record<"image" | "video" | "audio", number>;
}
export interface TemplateQuote {
  templateId: string;
  modelId: string;
  modelName: string;
  handler: string;
  pointCost: number;
  quoteToken: string;
  options: StudioTemplate["options"];
  basePointCost: number;
  referencePointCost: number;
}
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
  order?: "sort" | "newest";
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
export type TemplateCoverFilter = Pick<
  TemplateQuery,
  "kind" | "mediaType" | "category" | "keyword" | "status"
>;
export interface TemplatePromptFillResult {
  total: number;
  publish: boolean;
  counts: { saved: number; published: number; skipped: number; failed: number };
  items: { id: string; title: string; status: "saved" | "published" | "skipped" | "failed"; message: string }[];
}
export interface TemplateCoverBatchPreview {
  count: number;
  modelId: string;
  modelName: string;
  unitCost: number;
  totalCost: number;
  balance: number;
  quoteToken: string;
}
export interface TemplateCoverBatch {
  id: string;
  status: "running" | "completed" | "stopped";
  modelName: string;
  unitCost: number;
  totalCost: number;
  total: number;
  stopRequested: boolean;
  error: string;
  counts: Record<
    "pending" | "running" | "succeeded" | "failed" | "skipped",
    number
  >;
  items: {
    templateId: string;
    title: string;
    taskId: string;
    status: string;
    message: string;
    resultUrl: string;
    pointCost: number;
  }[];
}
const coverBatchURL = admin + "/cover-batches";
export const templateCoverBatchApi = {
  preview: (filter: TemplateCoverFilter) =>
    http.post<TemplateCoverBatchPreview>(coverBatchURL + "/preview", filter),
  create: (
    filter: TemplateCoverFilter,
    quoteToken: string,
    clientRequestId: string,
  ) =>
    http.post<TemplateCoverBatch>(coverBatchURL, {
      filter,
      quoteToken,
      clientRequestId,
    }),
  current: () =>
    http.get<TemplateCoverBatch | null>(coverBatchURL + "/current"),
  get: (id: string) => http.get<TemplateCoverBatch>(coverBatchURL + "/" + id),
  stop: (id: string) =>
    http.post<{ ok: boolean }>(coverBatchURL + "/" + id + "/stop", {}),
};
export const studioTemplateApi = {
  list: (q: TemplateQuery, signal?: AbortSignal) =>
    http.get<PublicTemplatePage>(base, toParams(q), { signal }),
  get: (id: string) => http.get<PublicStudioTemplate>(`${base}/${id}`),
  setup: (id: string, signal?: AbortSignal) =>
    http.get<TemplateSetup>(`/api/ai/template-setup/${id}`, undefined, {
      signal,
    }),
  quote: (templateId: string, input: TemplateUploads, signal?: AbortSignal) =>
    http.post<TemplateQuote>(
      "/api/ai/template-quote",
      { templateId, input },
      { signal },
    ),
};
export const adminStudioTemplateApi = {
  fillFromPrompts: (filter: TemplateCoverFilter, publish = false) =>
    http.post<TemplatePromptFillResult>(admin + "/fill-from-prompts", { ...filter, publish }),
  check: (row: StudioTemplateSave, fillFromPrompt = false) =>
    http.post<TemplateSetup>(`${admin}/check`, { ...row, ...(fillFromPrompt ? { fillFromPrompt: true } : {}) }),
  list: (q: TemplateQuery, signal?: AbortSignal) =>
    http.get<StudioTemplatePage>(admin, toParams(q), { signal }),
  save: (row: StudioTemplateSave, id?: string, expectedCoverUrl?: string, fillFromPrompt = false, expectedStatus?: number) =>
    id
      ? http.put<StudioTemplate>(`${admin}/${id}`, {
          ...row,
          ...(expectedCoverUrl !== undefined ? { expectedCoverUrl } : {}),
          ...(expectedStatus !== undefined ? { expectedStatus } : {}),
          ...(fillFromPrompt ? { fillFromPrompt: true } : {}),
        })
      : http.post<StudioTemplate>(admin, { ...row, ...(fillFromPrompt ? { fillFromPrompt: true } : {}) }),
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
