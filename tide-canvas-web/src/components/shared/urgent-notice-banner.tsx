"use client";

/* ============================================================================
   UrgentNoticeBanner — type=urgent 的未读通知在工作区顶部满宽横幅展示
   （维护公告 / 补偿通知这类必须第一眼看到的消息）。

   关闭 = 走通知已读接口：服务端持久（跨设备一致），铃铛面板里点开同一条
   也会让横幅消失——「第一次必弹、关过不再弹」由 is_read 一个状态承载，
   不引入额外存储。多条未读按新→旧逐条展示，关一条露下一条。
   仅登录用户可见（通知本就按用户落库）。
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(async () => {
    try {
      const res = await notificationApi.list({
        pageNum: 1,
        pageSize: 5,
        type: "urgent",
        isRead: 0,
      });
      if (res.success && res.data) setQueue(res.data.records ?? []);
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

  const current = queue[0];
  if (!current) return null;

  const dismiss = () => {
    // 乐观移除（露出下一条未读）；已读落库失败也不打断用户，下轮轮询会纠偏
    setQueue((q) => q.filter((n) => n.id !== current.id));
    void notificationApi.readOne(current.id).catch(() => {});
  };

  const openLink = () => {
    if (!current.linkUrl) return;
    if (/^https?:\/\//i.test(current.linkUrl)) {
      window.open(current.linkUrl, "_blank", "noopener");
    } else {
      router.push(current.linkUrl);
    }
  };

  return (
    <div className="ugb" role="alert" aria-live="assertive">
      <span className="ugb-ic" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path d="M12 3.5 22 20H2L12 3.5Z" />
          <path d="M12 10v4.5M12 17.4v.6" />
        </svg>
      </span>
      <div className="ugb-txt">
        <b>{current.title}</b>
        {current.content && <span>{current.content}</span>}
      </div>
      {current.linkUrl && (
        <button type="button" className="ugb-link" onClick={openLink}>
          查看详情
        </button>
      )}
      <button type="button" className="ugb-x" aria-label="关闭紧急提醒" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}
