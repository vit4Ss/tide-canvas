"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 画布路由组外壳。登录态门禁:进入画布前先 ensureSession()——有 token 则确保拉过用户
 * 信息后放行;无 token 时 ensureSession 已跳转 /login?redirect=<当前路径>,此处保持
 * loading 直到导航完成,避免未登录用户看到画布(其带鉴权的创建/保存调用必然 401)。
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    // 仅在会话有效时放行渲染;ok===false 表示已被重定向到登录页,继续显示 loading。
    // 加 12s 超时兜底:会话检查若卡死(网络挂起),不至于永久转圈——超时后跳登录。
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 12000),
    );
    Promise.race([ensureSession(), timeout])
      .then((ok) => {
        if (!mounted) return;
        if (ok) setReady(true);
        else if (typeof window !== "undefined" && window.location.pathname !== "/login") {
          const here = window.location.pathname + window.location.search;
          window.location.href = `/login?redirect=${encodeURIComponent(here)}`;
        }
      })
      .catch(() => {
        if (mounted && typeof window !== "undefined") window.location.href = "/login";
      });
    return () => {
      mounted = false;
    };
  }, [ensureSession]);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-700 border-t-neutral-200" />
      </div>
    );
  }

  return <div className="canvas-app h-screen w-screen overflow-hidden">{children}</div>;
}
