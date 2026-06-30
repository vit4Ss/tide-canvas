"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Heart, MessageSquare, UserPlus, User, Gift, Loader2, CheckCheck } from "lucide-react";
import { notificationApi, followApi } from "@/lib/api";
import { useImStore } from "@/stores/use-im-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NotificationVO, NotificationType } from "@/types/notification";

/** 类型筛选项（值为空表示「全部」）。 */
const TYPE_FILTERS: { value: "" | NotificationType; label: string }[] = [
  { value: "", label: "全部" },
  { value: "follow", label: "关注" },
  { value: "comment", label: "评论" },
  { value: "like", label: "点赞" },
  { value: "tip", label: "打赏" },
];

/** 类型 → 图标（无文案时的兜底展示）。 */
const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  follow: UserPlus,
  comment: MessageSquare,
  like: Heart,
  tip: Gift,
};

/** 相对时间：刚刚 / N分钟前 / N小时前 / N天前 / 更早显示 月-日。 */
function relativeTime(raw: string): string {
  const t = new Date(raw.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${m[2]}-${m[3]}` : "";
}

/** 通知关联内容的跳转地址（comment/like → 帖子/博客详情）。无目标返回 null。 */
function targetHref(n: NotificationVO): string | null {
  if (!n.targetPublicId) return null;
  if (n.targetType === "post") return `/community/${n.targetPublicId}`;
  if (n.targetType === "blog") return `/blogs/${n.targetPublicId}`;
  return null;
}

/**
 * 头部通知铃铛 + 通知中心下拉面板。
 *
 * - 挂载即拉未读数显示角标（仅登录态由 Header 渲染，故挂载代表已登录）。
 * - 打开面板：拉列表，并「打开即全部已读」（角标清零，调 markAllRead）。
 * - 顶部类型筛选（全部/关注/评论/点赞）+「全部已读」按钮。
 * - 关注类通知带「回关」按钮（followApi.follow(actor.id)）；comment/like 点击跳转帖子/博客详情。
 */
export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"" | NotificationType>("");
  const [items, setItems] = useState<NotificationVO[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 角标未读数：以 IM store 的 notifUnread 为单一数据源（REST 初始化 + WS 实时 +1）。
  const unread = useImStore((s) => s.notifUnread);
  const setNotifUnread = useImStore((s) => s.setNotifUnread);
  const resetNotif = useImStore((s) => s.resetNotif);

  // 挂载拉未读数，写入 store 作为角标初值（之后由 WS notification 事件实时 +1）。
  useEffect(() => {
    notificationApi.unreadCount().then((res) => {
      if (res.success) setNotifUnread(res.data.count);
    });
  }, [setNotifUnread]);

  // 拉列表（按当前筛选）。
  const loadList = useCallback((type: "" | NotificationType) => {
    setLoading(true);
    notificationApi
      .list({ type: type || undefined, pageNum: 1, pageSize: 30 })
      .then((res) => {
        if (res.success) setItems(res.data.records);
      })
      .finally(() => setLoading(false));
  }, []);

  // 打开面板：拉列表 + 打开即全部已读（角标清零）。
  const openPanel = useCallback(() => {
    setOpen(true);
    loadList(filter);
    if (unread > 0) {
      resetNotif();
      void notificationApi.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    }
  }, [filter, unread, loadList, resetNotif]);

  // 点击面板外区域关闭。
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // 切换类型筛选。
  const switchFilter = (type: "" | NotificationType) => {
    setFilter(type);
    loadList(type);
  };

  // 「全部已读」按钮：标记已读并本地置已读。
  const markAll = async () => {
    resetNotif();
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await notificationApi.markAllRead();
  };

  // 本会话内已回关的 actor 集合：作为后端 followedByMe 的本地乐观覆盖层
  // （后端给出持久态基线，会话内点「回关」成功后再叠加，避免重开面板前按钮回退）。
  const [followedActors, setFollowedActors] = useState<Set<string>>(new Set());
  // 回关：调 followApi.follow(actor.id)，成功后本地标记该 actor 已回关（按钮置灰）。
  const followBack = async (actorId: string) => {
    if (!actorId || followedActors.has(actorId)) return;
    setFollowedActors((prev) => new Set(prev).add(actorId));
    const res = await followApi.follow(actorId);
    if (!res.success) {
      // 回滚
      setFollowedActors((prev) => {
        const next = new Set(prev);
        next.delete(actorId);
        return next;
      });
    }
  };

  // 点击通知项：comment/like 跳转关联内容详情，并关闭面板。
  const onItemClick = (n: NotificationVO) => {
    const href = targetHref(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label="通知"
        className="relative flex cursor-pointer items-center justify-center rounded-lg p-2 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 sm:w-96">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {/* 头部：标题 + 全部已读 */}
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
              <span className="text-sm font-semibold text-neutral-900 dark:text-white">通知</span>
              <button
                type="button"
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                全部已读
              </button>
            </div>

            {/* 类型筛选 */}
            <div className="flex items-center gap-1 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-800">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.value || "all"}
                  type="button"
                  onClick={() => switchFilter(f.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    filter === f.value
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* 列表 */}
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-neutral-400">
                  <Bell className="h-6 w-6 opacity-40" />
                  暂无通知
                </div>
              ) : (
                <ul className="flex flex-col">
                  {items.map((n) => {
                    const Icon = TYPE_ICON[n.type] ?? Bell;
                    const href = targetHref(n);
                    const clickable = !!href;
                    const showFollowBack = n.type === "follow" && !!n.actor.id;
                    // 已关注 = 后端持久态(followedByMe) 或 本会话内已点回关。
                    const alreadyFollowed = n.followedByMe || followedActors.has(n.actor.id);
                    return (
                      <li
                        key={n.id}
                        onClick={() => onItemClick(n)}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 transition-colors",
                          clickable && "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
                          !n.isRead && "bg-blue-50/40 dark:bg-blue-950/20",
                        )}
                      >
                        <div className="relative shrink-0">
                          <Avatar size="sm">
                            {n.actor.avatar ? <AvatarImage src={n.actor.avatar} alt="" /> : null}
                            <AvatarFallback>
                              {n.actor.nickname?.[0] || <User className="h-3.5 w-3.5" />}
                            </AvatarFallback>
                          </Avatar>
                          {/* 类型角标 */}
                          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white dark:bg-neutral-900">
                            <Icon className="h-3 w-3 text-neutral-500" />
                          </span>
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="text-sm text-neutral-800 dark:text-neutral-200">
                            <span className="font-medium text-neutral-900 dark:text-white">
                              {n.actor.nickname || n.actor.username || "用户"}
                            </span>{" "}
                            <span className="text-neutral-600 dark:text-neutral-400">{n.content}</span>
                          </div>
                          <span className="text-xs text-neutral-400">{relativeTime(n.createTime)}</span>
                        </div>

                        {showFollowBack && (
                          <Button
                            variant={alreadyFollowed ? "outline" : "default"}
                            size="xs"
                            className="shrink-0"
                            disabled={alreadyFollowed}
                            onClick={(e) => {
                              e.stopPropagation();
                              void followBack(n.actor.id);
                            }}
                          >
                            {alreadyFollowed ? "已关注" : "回关"}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
