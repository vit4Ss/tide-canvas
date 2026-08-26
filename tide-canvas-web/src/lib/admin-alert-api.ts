import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { AlertChannel, AlertChannelInput, AlertDelivery, AlertEvent, AlertRule, AlertRuleInput } from "@/types/admin-alerts";

export const adminAlertApi = {
  channels: () => http.get<AlertChannel[]>("/api/admin/alert-channels"),
  createChannel: (dto: AlertChannelInput) => http.post<AlertChannel>("/api/admin/alert-channels", dto),
  updateChannel: (id: string, dto: AlertChannelInput) => http.put<AlertChannel>(`/api/admin/alert-channels/${id}`, dto),
  deleteChannel: (id: string) => http.delete<null>(`/api/admin/alert-channels/${id}`),
  testChannel: (id: string) => http.post<{ sent: boolean }>(`/api/admin/alert-channels/${id}/test`),
  rules: () => http.get<AlertRule[]>("/api/admin/alert-rules"),
  createRule: (dto: AlertRuleInput) => http.post<AlertRule>("/api/admin/alert-rules", dto),
  updateRule: (id: string, dto: AlertRuleInput) => http.put<AlertRule>(`/api/admin/alert-rules/${id}`, dto),
  deleteRule: (id: string) => http.delete<null>(`/api/admin/alert-rules/${id}`),
  events: (query: { pageNum?: number; pageSize?: number; keyword?: string; level?: string; module?: string; status?: string }) =>
    http.get<PageData<AlertEvent>>("/api/admin/alert-events", toParams(query)),
  deliveries: (eventId: string) => http.get<AlertDelivery[]>(`/api/admin/alert-events/${eventId}/deliveries`),
  retryDelivery: (id: string) => http.post<{ queued: boolean }>(`/api/admin/alert-deliveries/${id}/retry`),
};
