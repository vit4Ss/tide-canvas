"use client";

/* ============================================================================
   /admin/notifications — 消息管理 (REAL data)。

   与用户端通知中心同表同源（LINKAGE）：
   - 消息列表 : GET  /api/admin/notifications（分页 + 类型/关键词筛选）
   - 发送通知 : POST /api/admin/notifications（全体广播 / 按邮箱定向）
   - 删除     : DELETE /api/admin/notifications/:id

   复用共享后台组件（Panel/AdminTable/StatusPill/RowActions/AdminModal/
   FormCard/FormGrid/Field）。
   ============================================================================ */

import { useCallback, useEffect, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminNotifyApi } from "@/lib/admin-notify-api";
import type { AdminNotification, AdminNotifySendDTO } from "@/types/admin-notify";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

const TYPE_LABEL: Record<string, string> = {
  system: "系统",
  like: "点赞",
  comment: "评论",
  follow: "关注",
  order: "订单",
};

interface SendForm {
  title: string;
  content: string;
  linkUrl: string;
  target: "all" | "user";
  email: string;
}
const emptySendForm = (): SendForm => ({
  title: "",
  content: "",
  linkUrl: "",
  target: "all",
  email: "",
});

export default function AdminNotificationsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<AdminNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // send modal
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm, setSendForm] = useState<SendForm>(emptySendForm());
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (page = 1, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const res = await adminNotifyApi.list({ pageNum: page, pageSize });
        if (res.success && res.data) {
          setRows(res.data.records ?? []);
          setTotal(res.data.total ?? 0);
          setPageNum(page);
        } else {
          setError(res.message || "加载消息失败");
        }
      } catch {
        setError("加载失败，请稍后重试");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [ensureSession, pageSize],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  const send = async () => {
    const dto: AdminNotifySendDTO = {
      title: sendForm.title.trim(),
      content: sendForm.content.trim(),
      linkUrl: sendForm.linkUrl.trim(),
      type: "system",
      target: sendForm.target,
      ...(sendForm.target === "user" ? { email: sendForm.email.trim() } : {}),
    };
    if (!dto.title) {
      toast.error("请填写标题");
      return;
    }
    if (sendForm.target === "user" && !dto.email) {
      toast.error("定向发送需要填写用户邮箱");
      return;
    }
    setSending(true);
    const res = await adminNotifyApi.send(dto);
    setSending(false);
    if (res.success && res.data) {
      toast.success(`已发送给 ${res.data.sent} 位用户`);
      setSendOpen(false);
      setSendForm(emptySendForm());
      load(1);
    } else {
      toast.error(res.message || "发送失败");
    }
  };

  const remove = async (n: AdminNotification) => {
    if (
      !(await confirmDialog({
        title: "删除消息",
        message: `确认删除发给「${n.username || n.email || n.userId}」的消息「${n.title}」？用户的通知中心将同步移除。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminNotifyApi.remove(n.id);
    if (res.success) load(pageNum, { silent: true });
    else toast.error(res.message || "删除失败");
  };

  return (
    <>
      {error ? (
        <div className="adm-panel" style={{ padding: 16 }}>
          <span className="tag2 red">
            <i className="dot" />
            {error}
          </span>
        </div>
      ) : null}

      <Panel
        title="消息管理"
        sub="站内通知 · 与用户通知中心同源，发送/删除即时生效"
        tools={
          <button type="button" className="adm-btn" onClick={() => setSendOpen(true)}>
            + 发送通知
          </button>
        }
      >
        {loading ? (
          <div style={{ padding: 18 }} className="muted">
            加载中…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 18 }} className="muted">
            暂无消息，点击「发送通知」向用户推送第一条站内消息。
          </div>
        ) : (
          <AdminTable<AdminNotification>
            rows={rows}
            rowKey={(r) => r.id}
            total={total}
            columns={[
              {
                header: "标题 / 内容",
                className: "strong",
                cell: (r) => (
                  <div style={{ minWidth: 0 }}>
                    <div>{r.title}</div>
                    {r.content ? (
                      <div
                        className="muted"
                        style={{
                          fontWeight: 400,
                          fontSize: 12,
                          marginTop: 2,
                          maxWidth: 420,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.content}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                header: "接收者",
                className: "muted",
                cell: (r) => r.username || r.email || r.userId,
              },
              {
                header: "类型",
                cell: (r) => <StatusPill tone="gray">{TYPE_LABEL[r.type] ?? r.type}</StatusPill>,
              },
              {
                header: "状态",
                cell: (r) => (
                  <StatusPill tone={r.isRead === 1 ? "green" : "blue"}>
                    {r.isRead === 1 ? "已读" : "未读"}
                  </StatusPill>
                ),
              },
              { header: "发送时间", className: "muted mono", cell: (r) => r.createTime },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions actions={[{ label: "删除", onClick: () => remove(r) }]} />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* 发送通知 modal */}
      <AdminModal
        open={sendOpen}
        title="发送通知"
        subtitle="推送站内消息（用户铃铛面板即时可见）"
        onClose={() => setSendOpen(false)}
        onSave={send}
        saveLabel={sending ? "发送中…" : "发送"}
      >
        <FormCard title="消息内容">
          <FormGrid>
            <Field label="标题" required span={4}>
              <input
                placeholder="如：系统升级公告"
                value={sendForm.title}
                onChange={(e) => setSendForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field label="内容" span={4}>
              <input
                placeholder="通知正文（可留空）"
                value={sendForm.content}
                onChange={(e) => setSendForm((f) => ({ ...f, content: e.target.value }))}
              />
            </Field>
            <Field label="跳转链接" span={4} hint="可选；站内路径（如 /pricing）或完整 URL，点击通知后跳转">
              <input
                placeholder="如：/pricing"
                value={sendForm.linkUrl}
                onChange={(e) => setSendForm((f) => ({ ...f, linkUrl: e.target.value }))}
              />
            </Field>
            <Field label="发送对象" span={2}>
              <select
                value={sendForm.target}
                onChange={(e) =>
                  setSendForm((f) => ({ ...f, target: e.target.value as "all" | "user" }))
                }
              >
                <option value="all">全部用户</option>
                <option value="user">指定用户（按邮箱）</option>
              </select>
            </Field>
            {sendForm.target === "user" && (
              <Field label="用户邮箱" required span={2}>
                <input
                  placeholder="如：user@example.com"
                  value={sendForm.email}
                  onChange={(e) => setSendForm((f) => ({ ...f, email: e.target.value }))}
                />
              </Field>
            )}
          </FormGrid>
        </FormCard>
      </AdminModal>
    </>
  );
}
