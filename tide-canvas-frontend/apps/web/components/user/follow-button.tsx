"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, UserCheck, Users, Loader2 } from "lucide-react";
import { followApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FollowStatusVO } from "@/types/follow";

interface FollowButtonProps {
  /** 关注目标的 public_id（运行时字符串） */
  targetUserId: string;
  /** 可选：初始关注状态（已知时传入可省去挂载请求） */
  initialStatus?: FollowStatusVO;
  /** 透传给 Button 的尺寸/样式 */
  size?: "default" | "xs" | "sm" | "lg";
  className?: string;
  /** 关注状态变化回调（用于上层联动粉丝数等） */
  onChange?: (status: FollowStatusVO) => void;
}

/**
 * 关注按钮：挂载查状态，按状态显示「关注 / 已关注 / 互相关注」，点击切换（乐观更新 + 调 API）。
 * 未登录、目标为自己、或 targetUserId 为空时不渲染。
 *
 * 当前用户标识取 useAuthStore 的 user?.id（运行时为 public_id 字符串），与 targetUserId 直接比对。
 */
export function FollowButton({
  targetUserId,
  initialStatus,
  size = "sm",
  className,
  onChange,
}: FollowButtonProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  // user?.id 类型上为 number，但运行时为 public_id 字符串；统一转字符串比对。
  const isSelf = !!currentUserId && String(currentUserId) === targetUserId;
  const visible = !!currentUserId && !isSelf && !!targetUserId;

  const [status, setStatus] = useState<FollowStatusVO | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(false);
  const [hovering, setHovering] = useState(false);

  // 挂载/目标变化时拉取状态（已给初始状态则跳过）。
  useEffect(() => {
    if (!visible || initialStatus) return;
    let active = true;
    followApi.status(targetUserId).then((res) => {
      if (active && res.success) setStatus(res.data);
    });
    return () => {
      active = false;
    };
  }, [visible, targetUserId, initialStatus]);

  const toggle = useCallback(async () => {
    if (loading || !status) return;
    const next: FollowStatusVO = { ...status, following: !status.following };
    setStatus(next); // 乐观更新
    setLoading(true);
    try {
      const res = next.following
        ? await followApi.follow(targetUserId)
        : await followApi.unfollow(targetUserId);
      if (res.success) {
        onChange?.(next);
      } else {
        setStatus(status); // 回滚
      }
    } catch {
      setStatus(status); // 回滚
    } finally {
      setLoading(false);
    }
  }, [loading, status, targetUserId, onChange]);

  if (!visible) return null;

  const following = status?.following ?? false;
  const mutual = following && (status?.followedBy ?? false);

  // 已关注态：悬停提示「取关」，否则展示「互相关注 / 已关注」。
  let label: string;
  let Icon = UserPlus;
  if (!following) {
    label = "关注";
    Icon = UserPlus;
  } else if (hovering) {
    label = "取消关注";
    Icon = UserCheck;
  } else if (mutual) {
    label = "互相关注";
    Icon = Users;
  } else {
    label = "已关注";
    Icon = UserCheck;
  }

  return (
    <Button
      variant={following ? "outline" : "default"}
      size={size}
      className={cn(className)}
      disabled={loading || !status}
      onClick={toggle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {loading ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <Icon className="mr-1 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

export default FollowButton;
