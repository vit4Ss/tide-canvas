"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";

/**
 * 画布路由组外壳。登录流程暂未做:进入画布前先 ensureSession()(无 token 则静默登录
 * 默认账号),确保 /canvas/new 创建项目、/canvas/[id] 自动保存等带鉴权的调用有 token。
 * 待接入真正登录后,这里改成登录态校验/跳登录即可。
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    // 即使会话建立失败也放行渲染(页面会以未登录态降级,而非永久卡 loading)。
    ensureSession().finally(() => {
      if (mounted) setReady(true);
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
