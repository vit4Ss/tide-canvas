// ============================================================================
// Admin · 消息管理 API — wraps /api/admin/notifications
// (internal/handler/admin/g5_notify.go)。发送/删除即时反映到用户端通知中心。
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { AdminNotification, AdminNotifySendDTO } from "@/types/admin-notify";

export const adminNotifyApi = {
  list: (query: { pageNum?: number; pageSize?: number; type?: string; keyword?: string }) =>
    http.get<PageData<AdminNotification>>("/api/admin/notifications", toParams(query)),
  send: (dto: AdminNotifySendDTO) =>
    http.post<{ sent: number }>("/api/admin/notifications", dto),
  remove: (id: string) => http.delete<null>(`/api/admin/notifications/${id}`),
};
