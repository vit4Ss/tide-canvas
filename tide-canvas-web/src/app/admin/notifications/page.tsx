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

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, Send, X } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
  TableSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminNotifyApi } from "@/lib/admin-notify-api";
import type { AdminNotification, AdminNotifySendDTO } from "@/types/admin-notify";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

function fmtTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

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
  // 关键词搜索（标题/内容，后端 LIKE）：query = 输入框实时值，keyword = 已提交检索词。
  // ref 供 load 读取，避免 load 依赖 keyword 导致回调身份反复变化。
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const keywordRef = useRef("");

  // send modal
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm, setSendForm] = useState<SendForm>(emptySendForm());
  const [sending, setSending] = useState(false);

  // reqId 守卫：快速搜索/清除时并发请求，慢的旧响应后到不能覆盖新筛选结果
  const loadReqRef = useRef(0);
  const load = useCallback(
    async (page = 1, opts?: { silent?: boolean }) => {
      const id = ++loadReqRef.current;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const res = await adminNotifyApi.list({
          pageNum: page,
          pageSize,
          keyword: keywordRef.current || undefined,
        });
        if (id !== loadReqRef.current) return; // 过期响应丢弃
        if (res.success && res.data) {
          setRows(res.data.records ?? []);
          setTotal(res.data.total ?? 0);
          setPageNum(page);
        } else {
          setError(res.message || "加载消息失败");
        }
      } catch {
        if (id !== loadReqRef.current) return;
        setError("加载失败，请稍后重试");
      } finally {
        if (id === loadReqRef.current && !opts?.silent) setLoading(false);
      }
    },
    [ensureSession, pageSize],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(1));
    return () => cancelAnimationFrame(frame);
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
      return false;
    }
    if (sendForm.target === "user" && !dto.email) {
      toast.error("定向发送需要填写用户邮箱");
      return false;
    }
    setSending(true);
    try {
      const res = await adminNotifyApi.send(dto);
      if (res.success && res.data) {
        toast.success(`已发送给 ${res.data.sent} 位用户`);
        setSendOpen(false);
        setSendForm(emptySendForm());
        load(1);
        return true;
      }
      toast.error(res.message || "发送失败");
      return false;
    } catch {
      toast.error("发送失败，请稍后重试");
      return false;
    } finally {
      setSending(false);
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
    try {
      const res = await adminNotifyApi.remove(n.id);
      if (res.success) {
        toast.success("消息已从用户通知中心移除");
        load(pageNum, { silent: true });
      } else toast.error(res.message || "删除失败");
    } catch {
      toast.error("删除失败，请稍后重试");
    }
  };

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="站内消息加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={() => load(pageNum)}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="通知列表"
        sub="站内通知 · 与用户通知中心同源，发送/删除即时生效"
        tools={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const kw = query.trim();
                keywordRef.current = kw;
                setKeyword(kw);
                load(1);
              }}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div className="adm-search" style={{ margin: 0 }}>
                <Search aria-hidden size={15} />
                <input
                  placeholder="标题 / 内容"
                  aria-label="搜索通知标题或内容"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {/* 不随 loading 禁用：默认提交按钮被禁用时按 Enter 的隐式提交会静默失效
                  （列表加载中提交搜索无反应）；并发安全由 load 的 reqId 守卫保证 */}
              <button type="submit" className="adm-btn ghost">
                搜索
              </button>
              {keyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    keywordRef.current = "";
                    setQuery("");
                    setKeyword("");
                    load(1);
                  }}
                >
                  <X aria-hidden size={14} />
                  清除
                </button>
              ) : null}
            </form>
            <button type="button" className="adm-btn" onClick={() => setSendOpen(true)}>
              <Send aria-hidden size={15} />
              发送通知
            </button>
          </div>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title={keyword ? "未找到匹配消息" : "暂无站内消息"}
            description={
              keyword
                ? `没有标题或内容匹配「${keyword}」的消息。`
                : "发送系统公告或定向通知后，消息会同步出现在用户通知中心。"
            }
            action={
              keyword ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    keywordRef.current = "";
                    setQuery("");
                    setKeyword("");
                    load(1);
                  }}
                >
                  <X aria-hidden size={14} />
                  清除搜索
                </button>
              ) : (
                <button type="button" className="adm-btn" onClick={() => setSendOpen(true)}>
                  <Plus aria-hidden size={15} />
                  新建通知
                </button>
              )
            }
          />
        ) : (
          <AdminTable<AdminNotification>
            label="站内消息列表"
            rows={rows}
            rowKey={(r) => r.id}
            server={{ page: pageNum, pageSize, total, onPage: (p) => load(p) }}
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
              { header: "发送时间", className: "muted mono", cell: (r) => fmtTime(r.createTime) },
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
        size="lg"
        title="发送通知"
        subtitle={sendForm.target === "all" ? "向全部用户广播站内消息" : "按邮箱向指定用户发送站内消息"}
        footNote={
          sendForm.target === "all"
            ? "广播会立即进入所有用户的通知中心，请在发送前复核标题、正文与链接"
            : "通知发送后立即可见；删除只会移除对应的单条消息"
        }
        onClose={() => setSendOpen(false)}
        onSave={send}
        saveLabel={sending ? "发送中…" : sendForm.target === "all" ? "确认广播" : "发送通知"}
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
              <textarea
                rows={5}
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
                  type="email"
                  autoComplete="off"
                  placeholder="如：user@example.com"
                  value={sendForm.email}
                  onChange={(e) => setSendForm((f) => ({ ...f, email: e.target.value }))}
                />
              </Field>
            )}
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}
