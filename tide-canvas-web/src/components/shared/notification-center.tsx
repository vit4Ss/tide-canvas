"use client";

/* ============================================================================
   NotificationCenter — reusable notification bell + dropdown, wired to the real
   backend notification API (tide-canvas-server/internal/handler/content):

     GET    /api/notifications                 -> PageData<NotificationVO>
     GET    /api/notifications/unread-count     -> { count }
     POST   /api/notifications/read-all
     POST   /api/notifications/items/:id/read
     DELETE /api/notifications/items/:id

   The host provides the trigger markup via `renderTrigger` so the same logic +
   dropdown works in the studio rail (ws-tool button) and the admin topbar.
   The component owns: unread-badge polling, open/close, outside-click, marking
   read (single + all), delete, and link navigation.
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { isHiddenPricingRoute } from "@/lib/public-routes";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { notificationApi } from "@/lib/content-api";
import { toast } from "@/components/shared/toast";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { NotificationVO } from "@/types/content";
import "./notification-center.css";

/** Relative "x 分钟前" style timestamp; falls back to the date for old items. */
function relativeTime(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

/** 类型 → 线性图标 path（24 viewBox，stroke 风格，与站内 Lucide 语言一致）。 */
const TYPE_ICON: Record<string, React.ReactNode> = {
  system: (
    <path d="M12 2a7 7 0 0 0-7 7v3.5L3 16h18l-2-3.5V9a7 7 0 0 0-7-7Zm-2.3 17a2.5 2.5 0 0 0 4.6 0" />
  ),
  urgent: (
    <>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 10v4.5M12 17.4v.6" />
    </>
  ),
  like: (
    <path d="M19 14c1.5-1.4 3-3.2 3-5.5A4.5 4.5 0 0 0 17.5 4c-1.7 0-3 .8-4 2-.9-1.2-2.3-2-4-2A4.5 4.5 0 0 0 5 8.5C5 10.8 6.5 12.6 8 14l4 4 4-4Z" />
  ),
  comment: <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />,
  follow: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M19 8v6M22 11h-6" />
    </>
  ),
  order: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
    </>
  ),
};

const TYPE_LABEL: Record<string, string> = {
  system: "系统通知",
  urgent: "紧急提醒",
  like: "点赞",
  comment: "评论",
  follow: "关注",
  order: "订单",
};

interface Props {
  /** Host-supplied trigger button. */
  renderTrigger: (state: {
    unread: number;
    open: boolean;
    panelId: string;
    toggle: () => void;
  }) => React.ReactNode;
  /** Poll interval for the unread badge in ms (0 disables). Default 60s. */
  pollMs?: number;
  /** 面板色调。面板 portal 到 body，会继承 body 级主题令牌（如 imini 暗色）；
   *  浅色宿主（后台工作台）传 "light" 让面板自带浅色令牌。默认跟随 body。 */
  tone?: "inherit" | "light";
}

export default function NotificationCenter({
  renderTrigger,
  pollMs = 60000,
  tone = "inherit",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  // 详情弹窗：点条目打开，展示完整正文；带链接的在弹窗内提供「前往查看」。
  const [detail, setDetail] = useState<NotificationVO | null>(null);
  const detailRef = useFocusTrap<HTMLDivElement>(Boolean(detail));
  const uid = useId().replace(/:/g, "");
  const panelId = `notification-panel-${uid}`;
  const panelTitleId = `${panelId}-title`;
  const detailTitleId = `${panelId}-detail-title`;
  const detailBodyId = `${panelId}-detail-body`;

  const closePanel = useCallback(() => setOpen(false), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const refreshUnread = useCallback(async () => {
    const res = await notificationApi.unreadCount();
    if (res.success && res.data) setUnread(res.data.count ?? 0);
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const res = await notificationApi.list({ pageNum: 1, pageSize: 20 });
    setLoading(false);
    if (res.success && res.data) {
      setItems(res.data.records ?? []);
      // 未读数以 unread-count 端点为准(此处只取首页 20 条，>20 未读时按页派生会偏小)，
      // 打开面板时刷新一次权威计数。
      refreshUnread();
    } else {
      setItems([]);
      setListError(res.message || "加载失败，请稍后重试");
    }
  }, [refreshUnread]);

  // Unread badge: initial load + polling. Silent on failure (e.g. logged out).
  useEffect(() => {
    const initialId = window.setTimeout(refreshUnread, 0);
    const pollId = pollMs > 0 ? window.setInterval(refreshUnread, pollMs) : null;
    return () => {
      window.clearTimeout(initialId);
      if (pollId !== null) window.clearInterval(pollId);
    };
  }, [refreshUnread, pollMs]);

  // Load the full list whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(loadList, 0);
    return () => window.clearTimeout(id);
  }, [open, loadList]);

  // Esc 关闭面板（外部点击由居中蒙层的 onClick 承担）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePanel, open]);

  // Esc 关闭详情弹窗（独立于面板的 Esc 处理）。
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDetail, detail]);

  const markOneRead = async (n: NotificationVO) => {
    if (n.isRead === 1) return;
    // optimistic
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, isRead: 1 } : x)),
    );
    setUnread((u) => Math.max(0, u - 1));
    const res = await notificationApi.readOne(n.id);
    if (!res.success) loadList(); // 失败时整体回滚(列表+计数)，避免 UI 与后端不一致
  };

  // 点条目 = 标记已读 + 打开详情弹窗（面板收起）；跳转移到弹窗内的「前往查看」。
  const onItemClick = async (n: NotificationVO) => {
    setDetail(n);
    setOpen(false);
    await markOneRead(n);
  };

  const goDetailLink = () => {
    const url = detail?.linkUrl;
    setDetail(null);
    if (!url || isHiddenPricingRoute(url)) return;
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener");
      return;
    }
    // 已在目标页时 router.push 无感——给出明确反馈，避免按钮"点了没反应"。
    const targetPath = url.split(/[?#]/)[0];
    if (typeof window !== "undefined" && window.location.pathname === targetPath) {
      toast.info("你已经在该页面了");
      return;
    }
    router.push(url);
  };

  const markAll = async () => {
    // 用权威未读数守卫(与按钮显隐的 unread>0 同源)：未读项可能在已加载首页 20 条之外，
    // 若按已加载项判断会误判为"无未读"而 return，导致按钮点了没反应、红点清不掉。
    if (unread === 0) return;
    setItems((prev) => prev.map((x) => ({ ...x, isRead: 1 })));
    setUnread(0);
    const res = await notificationApi.readAll();
    if (res.success) toast.success("已全部标为已读");
    else loadList(); // 失败时整体回滚
  };

  const removeOne = async (e: React.MouseEvent, n: NotificationVO) => {
    e.stopPropagation();
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (n.isRead === 0) setUnread((u) => Math.max(0, u - 1));
    const res = await notificationApi.remove(n.id);
    if (!res.success) loadList();
  };

  return (
    <div className="notif-center" ref={wrapRef}>
      {renderTrigger({
        unread,
        open,
        panelId,
        toggle: () => setOpen((value) => !value),
      })}

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            className={`notif-mask${tone === "light" ? " tone-light" : ""}`}
            onClick={closePanel}
          >
          <div
            id={panelId}
            ref={panelRef}
            className={`notif-panel${tone === "light" ? " tone-light" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={panelTitleId}
            aria-busy={loading}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="notif-head">
              <h2 className="notif-title" id={panelTitleId}>
                通知
              </h2>
              <div className="notif-head-actions">
                {unread > 0 && (
                  <button type="button" className="notif-readall" onClick={markAll}>
                    全部已读
                  </button>
                )}
                <button
                  type="button"
                  className="notif-close"
                  aria-label="关闭通知"
                  data-autofocus
                  onClick={closePanel}
                >
                  ×
                </button>
              </div>
            </div>

            <div
              className="notif-list"
              role={!loading && !listError && items.length > 0 ? "list" : undefined}
            >
              {loading ? (
                <div className="notif-empty" role="status">
                  加载中…
                </div>
              ) : listError ? (
                <div className="notif-empty" role="alert">
                  {listError}
                </div>
              ) : items.length === 0 ? (
                <div className="notif-empty rich">
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 2a7 7 0 0 0-7 7v3.5L3 16h18l-2-3.5V9a7 7 0 0 0-7-7Zm-2.3 17a2.5 2.5 0 0 0 4.6 0" />
                  </svg>
                  <b>暂无通知</b>
                  <span>生成结果、系统公告会在这里提醒你</span>
                </div>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    className={`notif-item${n.isRead === 0 ? " unread" : ""}`}
                    role="listitem"
                  >
                    {n.isRead === 0 && <span className="notif-dot" aria-hidden />}
                    <button
                      type="button"
                      className="notif-item-open"
                      onClick={() => onItemClick(n)}
                    >
                      <span className="notif-ic" aria-hidden>
                        <svg viewBox="0 0 24 24">
                          {TYPE_ICON[n.type] ?? TYPE_ICON.system}
                        </svg>
                      </span>
                      <span className="notif-body">
                        <span className="notif-item-title">{n.title || "通知"}</span>
                        {n.content && <span className="notif-item-text">{n.content}</span>}
                        <span className="notif-item-time">{relativeTime(n.createTime)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="notif-del"
                      title="删除"
                      aria-label={`删除通知：${n.title || "通知"}`}
                      onClick={(e) => removeOne(e, n)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>,
          document.body,
        )}

      {/* 详情弹窗：完整正文 + 类型/时间元信息；带链接时提供「前往查看」 */}
      {detail && typeof document !== "undefined" &&
        createPortal(
          <div
            className={`notif-dmask${tone === "light" ? " tone-light" : ""}`}
            onClick={closeDetail}
          >
            <div
              ref={detailRef}
              className="notif-detail"
              role="dialog"
              aria-modal="true"
              aria-labelledby={detailTitleId}
              aria-describedby={detailBodyId}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="nd-x"
                aria-label="关闭"
                data-autofocus
                onClick={closeDetail}
              >
                ×
              </button>
              <div className="nd-head">
                <span className="notif-ic" aria-hidden>
                  <svg viewBox="0 0 24 24">{TYPE_ICON[detail.type] ?? TYPE_ICON.system}</svg>
                </span>
                <div className="nd-ht">
                  <h2 id={detailTitleId}>{detail.title || "通知"}</h2>
                  <span>
                    {TYPE_LABEL[detail.type] ?? "通知"} · {relativeTime(detail.createTime)}
                  </span>
                </div>
              </div>
              <div className="nd-body" id={detailBodyId}>
                {detail.content || "（该通知没有正文）"}
              </div>
              {detail.linkUrl && !isHiddenPricingRoute(detail.linkUrl) && (
                <div className="nd-acts">
                  <button type="button" className="nd-btn pri" onClick={goDetailLink}>
                    前往查看 →
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
