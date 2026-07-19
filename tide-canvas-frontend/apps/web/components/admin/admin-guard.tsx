"use client";

import { notFound } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

/**
 * 管理后台访问守卫：仅管理员（role=9）可进入。
 * 非管理员（含未登录）一律渲染 404，不暴露后台是否存在。
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, initialized, isLoggedIn } = useAuth();

  // 用户信息加载中，先占位，避免误判为非管理员而闪现 404
  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!isLoggedIn || !isAdmin) {
    notFound();
  }

  return <>{children}</>;
}
