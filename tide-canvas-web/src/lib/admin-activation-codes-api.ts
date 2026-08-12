import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminActivationCode,
  AdminActivationCodeClaim,
  AdminActivationCodeClaimQuery,
  AdminActivationCodeGenerateDTO,
  AdminActivationCodeGenerateResult,
  AdminActivationCodeQuery,
  AdminActivationCodeSummary,
} from "@/types/admin-activation-codes";

export const adminActivationCodesApi = {
  summary: () => http.get<AdminActivationCodeSummary>("/api/admin/activation-codes/summary"),
  list: (query: AdminActivationCodeQuery = {}) =>
    http.get<PageData<AdminActivationCode>>("/api/admin/activation-codes", toParams(query)),
  generate: (dto: AdminActivationCodeGenerateDTO) =>
    http.post<AdminActivationCodeGenerateResult>("/api/admin/activation-codes/generate", dto),
  updateStatus: (id: string, enabled: boolean) =>
    http.put<AdminActivationCode>(`/api/admin/activation-codes/${id}/status`, { enabled }),
  listClaims: (query: AdminActivationCodeClaimQuery = {}) =>
    http.get<PageData<AdminActivationCodeClaim>>("/api/admin/activation-code-claims", toParams(query)),
};
