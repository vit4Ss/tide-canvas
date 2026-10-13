import { http } from "./http";
import { googleAuthRequest } from "./google-auth";
import { generateAiTaskIdempotent, type AiGenerationJournalOptions } from "./ai-generation-idempotency";
import type { AiGenerateInput, AiTaskVO, UpscaleQuoteVO, ReferenceVideoQuoteVO } from "@/types/ai";
import type { LoginVO, UserVO } from "@/types/user";
import type { ModelConfig } from "@/types/admin-models";
import type { FileVO } from "@/types/file";
import type { Result } from "@/types/api";
import type { OrderVO, CreateOrderDTO } from "@/types/billing";

export interface StudioModel {
  id: string; name: string; modelKey: string; type: string; desc: string; pointCost: string; config: ModelConfig | null;
}
export const authApi = {
  googleChallenge: (signal?: AbortSignal) => googleAuthRequest<{ clientId: string; nonce: string; expiresIn: number }>("/api/auth/google/challenge", {}, signal),
  google: (credential: string, nonce: string, code?: string, signal?: AbortSignal) => googleAuthRequest<LoginVO | { requiresLink: true; email: string; existingAccount: boolean }>("/api/auth/google", { credential, nonce, ...(code ? { code } : {}) }, signal),
  googleEmailCode: (email: string, signal?: AbortSignal) => googleAuthRequest<void>("/api/auth/email-code", { email }, signal),
  me: () => http.get<UserVO>("/api/auth/me", undefined, { signal: AbortSignal.timeout(15_000) }),
  login: (account: string, password: string) => http.post<LoginVO>("/api/auth/login", { account, password }),
  register: (data: { username?: string; email: string; password: string; code: string; nickname?: string }) => http.post<UserVO>("/api/auth/register", data),
  registerLocal: (username: string, password: string) => http.post<LoginVO>("/api/auth/register-local", { username, password }),
  emailCode: (email: string) => http.post<void>("/api/auth/email-code", { email }),
  reset: (email: string, code: string, newPassword: string) => http.post<void>("/api/auth/reset-password", { email, code, newPassword }),
  logout: () => http.post<void>("/api/auth/logout"),
  update: (nickname: string) => http.put<UserVO>("/api/auth/profile", { nickname }),
  password: (oldPassword: string, newPassword: string) => http.put<void>("/api/auth/password", { oldPassword, newPassword }),
};
export const aiApi = {
  models: (type?: string) => http.get<StudioModel[]>("/api/market/studio-models", { type }),
  generate: (data: AiGenerateInput, scope: string, options: AiGenerationJournalOptions) => generateAiTaskIdempotent(data, scope, options),
  task: (id: string, signal?: AbortSignal) => http.get<AiTaskVO>(`/api/ai/tasks/${id}`, undefined, { signal }),
  cancel: (id: string) => http.delete<void>(`/api/ai/tasks/${id}`, { signal: AbortSignal.timeout(30_000) }),
  quote: (modelId: string, videoUrl: string, targetResolution: string, upscaleModel?: string) => http.post<UpscaleQuoteVO>("/api/ai/upscale-quote", { modelId, videoUrl, targetResolution, ...(upscaleModel ? { upscaleModel } : {}) }),
  optimize: (prompt: string) => http.post<{ prompt: string }>("/api/ai/optimize-prompt", { prompt }),
  referenceQuote: (modelId: string, resolution: string, videoUrls: string[]) => http.post<ReferenceVideoQuoteVO>("/api/ai/reference-video-quote", { modelId, resolution, videoUrls }),
};
export const orderApi = {
  create: (data: CreateOrderDTO, signal?: AbortSignal) => http.post<OrderVO>("/api/en/orders", data, { signal }),
  verify: (id: string, signal?: AbortSignal) => http.post<{ paid: boolean; granted: boolean }>(`/api/orders/${encodeURIComponent(id)}/verify`, undefined, { signal }),
  resume: (id: string, signal?: AbortSignal) => http.post<OrderVO>(`/api/orders/${encodeURIComponent(id)}/checkout`, undefined, { signal }),
  cancel: (id: string, signal?: AbortSignal) => http.post<void>(`/api/orders/${encodeURIComponent(id)}/cancel`, undefined, { signal }),
};

export async function uploadFile(file: File): Promise<Result<FileVO>> {
  if (file.size > 50 * 1024 * 1024) return { success: false, code: 3002, message: "Choose a file smaller than 50 MB.", data: null as unknown as FileVO, timestamp: Date.now() };
  const contentType = file.type || "application/octet-stream";
  let contentHash: string | undefined;
  try { const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); contentHash = Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); } catch { /* Hashing is an optimization, never a requirement. */ }
  const pre = await http.post<{ existingFile?: FileVO; direct: boolean; uploadUrl?: string; key?: string; headers?: Record<string, string>; contentType?: string }>("/api/files/presign", { filename: file.name, contentType, size: file.size, ...(contentHash ? { contentHash } : {}) });
  if (pre.success && pre.data?.existingFile) return { ...pre, data: pre.data.existingFile };
  if (pre.success && pre.data?.direct && pre.data.uploadUrl && pre.data.key) {
    try {
      const response = await fetch(pre.data.uploadUrl, { method: "PUT", headers: { "Content-Type": pre.data.contentType || contentType, ...pre.data.headers }, body: file });
      if (!response.ok) throw new Error("Direct upload failed");
      return await http.post<FileVO>("/api/files/register", { key: pre.data.key, originalName: file.name, contentType });
    } catch { return { success: false, code: 0, message: "Upload was not confirmed. Check your library before trying again.", data: null as unknown as FileVO, timestamp: Date.now() }; }
  }
  if (!pre.success && ![0, 404, 500, 502, 503].includes(pre.code)) return { ...pre, data: null as unknown as FileVO };
  const body = new FormData(); body.append("file", file);
  return http.post<FileVO>("/api/files/upload", body);
}
