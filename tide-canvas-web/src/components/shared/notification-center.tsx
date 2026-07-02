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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { notificationApi } from "@/lib/content-api";
import { toast } from "@/components/shared/toast";
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

interface Props {
  /** Host-supplied trigger button. */
  renderTrigger: (state: {
    unread: number;
    open: boolean;
    toggle: () => void;
  }) => React.ReactNode;
  /** Dropdown horizontal anchor relative to the trigger. Default "right". */
  align?: "left" | "right";
  /** Poll interval for the unread badge in ms (0 disables). Default 60s. */
  pollMs?: number;
}

export default function NotificationCenter({
  renderTrigger,
  align = "right",
  pollMs = 60000,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // 面板通过 portal 渲染到 body 并用 fixed 定位，避免被宿主容器(如 studio 侧栏的
  // overflow:auto、104px 窄栏)裁剪；据触发器位置决定向上/下弹与左右对齐。
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const [openUp, setOpenUp] = useState(false); // 向上弹出时用反向入场动画

  const positionPanel = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const openUp = r.bottom > vh * 0.6; // 触发器靠下半屏 → 向上弹，避免被视口/容器裁掉
    const style: React.CSSProperties = { position: "fixed", zIndex: 300 };
    if (openUp) {
      style.bottom = Math.round(vh - r.top + gap);
      style.top = "auto";
      style.maxHeight = Math.max(160, Math.round(r.top - gap - margin));
    } else {
      style.top = Math.round(r.bottom + gap);
      style.bottom = "auto";
      style.maxHeight = Math.max(160, Math.round(vh - r.bottom - gap - margin));
    }
    // 水平方向统一夹紧到视口内：align 只表达锚定意图(left=左对齐触发器左缘, right=右对齐右缘)，
    // 但触发器靠右/移动端 wrap 时仍需 clamp，否则 340px 面板会溢出视口右侧点不到。
    const panelW = Math.min(340, vw - 24); // 与 CSS max-width 一致
    const ideal = align === "left" ? r.left : r.right - panelW;
    style.left = Math.round(Math.min(Math.max(margin, ideal), vw - panelW - margin));
    style.right = "auto";
    style.width = panelW;
    setOpenUp(openUp);
    setPanelStyle(style);
  }, [align]);

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
    refreshUnread();
    if (pollMs <= 0) return;
    const id = window.setInterval(refreshUnread, pollMs);
    return () => window.clearInterval(id);
  }, [refreshUnread, pollMs]);

  // Load the full list whenever the panel opens.
  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  // Position the portaled panel on open, and keep it anchored on resize/scroll.
  useLayoutEffect(() => {
    if (!open) return;
    positionPanel();
    const onWin = () => positionPanel();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true); // capture: 跟随任意祖先滚动
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open, positionPanel]);

  // Close on outside click / Escape. The panel is portaled outside wrapRef, so
  // exempt both the trigger wrapper and the panel from the outside-click check.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  const onItemClick = async (n: NotificationVO) => {
    await markOneRead(n);
    if (n.linkUrl) {
      setOpen(false);
      if (/^https?:\/\//i.test(n.linkUrl)) {
        window.open(n.linkUrl, "_blank", "noopener");
      } else {
        router.push(n.linkUrl);
      }
    }
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
      {renderTrigger({ unread, open, toggle: () => setOpen((v) => !v) })}

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className={`notif-panel${openUp ? " up" : ""}`}
            role="menu"
            aria-label="通知"
            style={panelStyle}
          >
          <div className="notif-head">
            <span className="notif-title">通知</span>
            {unread > 0 && (
              <button type="button" className="notif-readall" onClick={markAll}>
                全部已读
              </button>
            )}
          </div>

          <div className="notif-list">
            {loading ? (
              <div className="notif-empty">加载中…</div>
            ) : listError ? (
              <div className="notif-empty">{listError}</div>
            ) : items.length === 0 ? (
              <div className="notif-empty">暂无通知</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item${n.isRead === 0 ? " unread" : ""}`}
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => onItemClick(n)}
                  onKeyDown={(e) => {
                    // 仅当焦点在整行本身时才把 Enter/Space 当作「打开」；焦点在行内删除按钮上时
                    // 交由该按钮处理，避免同一次按键既删除又打开/跳转。
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onItemClick(n);
                    }
                  }}
                >
                  {n.isRead === 0 && <span className="notif-dot" aria-hidden />}
                  <div className="notif-body">
                    <div className="notif-item-title">{n.title || "通知"}</div>
                    {n.content && <div className="notif-item-text">{n.content}</div>}
                    <div className="notif-item-time">{relativeTime(n.createTime)}</div>
                  </div>
                  <button
                    type="button"
                    className="notif-del"
                    title="删除"
                    aria-label="删除通知"
                    onClick={(e) => removeOne(e, n)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
