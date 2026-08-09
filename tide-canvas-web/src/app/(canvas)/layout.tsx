"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 画布路由组外壳。登录态门禁:进入画布前先 ensureSession()——有 token 则确保拉过用户
 * 信息后放行;无 token 时 ensureSession 已跳转 /login?redirect=<当前路径>,此处保持
 * loading 直到导航完成,避免未登录用户看到画布(其带鉴权的创建/保存调用必然 401)。
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [ready, setReady] = useState(false);

  // imini 主题的全局样式表在软导航后仍驻留文档（App Router 不卸载布局 CSS），而根布局
  // 给所有路由的 <body> 都盖了 imini 类——从站点/工作台软导航进画布时暗色规则会漏进
  // 这套浅色画布 UI。挂载期间摘除标记类，离开时恢复。
  useEffect(() => {
    document.body.classList.remove("imini");
    return () => document.body.classList.add("imini");
  }, []);

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
          router.replace(`/login?redirect=${encodeURIComponent(here)}`);
        }
      })
      .catch(() => {
        if (mounted) router.replace("/login");
      });
    return () => {
      mounted = false;
    };
  }, [ensureSession, router]);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0A0A0B]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-700 border-t-white" />
      </div>
    );
  }

  return <div className="canvas-app h-screen w-screen overflow-hidden">{children}</div>;
}
