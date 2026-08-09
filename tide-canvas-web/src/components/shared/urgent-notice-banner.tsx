"use client";

/* ============================================================================
   UrgentNoticeBanner — type=urgent 的未读通知在工作区顶部满宽横幅展示
   （维护公告 / 补偿通知这类必须第一眼看到的消息）。

   关闭 = 走通知已读接口：服务端持久（跨设备一致），铃铛面板里点开同一条
   也会让横幅消失——「第一次必弹、关过不再弹」由 is_read 一个状态承载，
   不引入额外存储。多条未读按新→旧逐条展示，关一条露下一条。
   仅登录用户可见（通知本就按用户落库）。
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notificationApi } from "@/lib/content-api";
import { useAuth } from "@/hooks/use-auth";
import type { NotificationVO } from "@/types/content";
import "./urgent-notice-banner.css";

/** 轮询间隔：维护公告要能在会话中途送达，但别把通知接口打成心跳。 */
const POLL_MS = 60_000;

export default function UrgentNoticeBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [queue, setQueue] = useState<NotificationVO[]>([]);
  // 会话内已关闭的 id：readOne 在途时恰逢轮询落地，服务端仍视为未读，
  // 不滤会闪回一条刚关掉的横幅（下一轮才消失）。
  const dismissedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await notificationApi.list({
        pageNum: 1,
        pageSize: 5,
        type: "urgent",
        isRead: 0,
        activeOnly: true, // 服务端过滤已过截止时间的
      });
      if (res.success && res.data) {
        // 客户端二次过滤兜底：轮询间隔内到点的横幅下一次渲染即消失
        const now = Date.now();
        setQueue(
          (res.data.records ?? []).filter(
            (n) =>
              !dismissedRef.current.has(n.id) &&
              (!n.expireTime || Date.parse(n.expireTime) > now),
          ),
        );
      }
    } catch {
      /* 静默：下一轮轮询重试 */
    }
  }, []);

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 登出即清空横幅
      setQueue([]);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [user, refresh]);

  if (queue.length === 0) return null;

  const dismiss = (id: string) => {
    // 乐观移除（余下的自然上移）+ 记入会话已关闭名单；已读落库失败也不打断
    // 用户——本会话不再弹，刷新页面后若仍未读会重新出现（服务端为准）
    dismissedRef.current.add(id);
    setQueue((q) => q.filter((n) => n.id !== id));
    void notificationApi.readOne(id).catch(() => {});
  };

  const openLink = (url: string) => {
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener");
    } else {
      router.push(url);
    }
  };

  // 多条活跃紧急提醒纵向叠放（新→旧），各自独立关闭；最多同时铺 3 条，
  // 关掉一条后队列里更旧的补位。
  return (
    <>
      {queue.slice(0, 3).map((n) => (
        <div key={n.id} className="ugb" role="alert" aria-live="assertive">
          <span className="ugb-ic" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M12 3.5 22 20H2L12 3.5Z" />
              <path d="M12 10v4.5M12 17.4v.6" />
            </svg>
          </span>
          <div className="ugb-txt">
            <b>{n.title}</b>
            {n.content && <span>{n.content}</span>}
          </div>
          {n.linkUrl && (
            <button type="button" className="ugb-link" onClick={() => openLink(n.linkUrl)}>
              查看详情
            </button>
          )}
          <button
            type="button"
            className="ugb-x"
            aria-label={`关闭紧急提醒：${n.title}`}
            onClick={() => dismiss(n.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );
}
