"use client";

import "@mantine/core/styles.css";
import "@douyinfe/semi-ui/lib/es/_base/base.css";
import "@xyflow/react/dist/style.css";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { MantineAppProvider } from "@/components/shared/mantine-provider";
import { UiPreferencesProvider } from "@/components/shared/ui-preferences";

// 界面偏好(ui-preferences)写到 documentElement 上的内联变量与 dataset——
// 离开画布时必须清掉,否则字号/主色会泄漏到站点/工作台页面。
const UI_PREF_INLINE_VARS = [
  "--tc-root-font-size",
  "--tc-font-scale",
  "--tc-primary",
  "--tc-primary-soft",
  "--tc-primary-foreground",
  "--tc-ring",
  "--primary",
  "--primary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
];

/**
 * 画布路由组外壳。登录态门禁:进入画布前先 ensureSession()——有 token 则确保拉过用户
 * 信息后放行;无 token 时 ensureSession 已跳转 /login?redirect=<当前路径>,此处保持
 * loading 直到导航完成,避免未登录用户看到画布(其带鉴权的创建/保存调用必然 401)。
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [ready, setReady] = useState(false);

  // imini 主题的全局样式表在软导航后仍驻留文档（App Router 不卸载布局 CSS），而根布局
  // 给所有路由的 <body> 都盖了 imini 类——从站点/工作台软导航进画布时暗色规则会漏进
  // 这套浅色画布 UI。挂载期间摘除标记类，离开时恢复。
  useEffect(() => {
    document.body.classList.remove("imini");
    return () => document.body.classList.add("imini");
  }, []);

  // 离开画布时清理 ui-preferences 写入的根级内联变量与 dataset,防止偏好泄漏到站点页。
  useEffect(() => {
    return () => {
      const root = document.documentElement;
      for (const name of UI_PREF_INLINE_VARS) root.style.removeProperty(name);
      delete root.dataset.tcDensity;
      delete root.dataset.tcThemeColor;
    };
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
      <div className="flex h-screen w-screen items-center justify-center bg-[#0A0A0B]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-700 border-t-white" />
      </div>
    );
  }

  return (
    <MantineAppProvider>
      <UiPreferencesProvider>
        <div className="canvas-app h-screen w-screen overflow-hidden">{children}</div>
      </UiPreferencesProvider>
    </MantineAppProvider>
  );
}
