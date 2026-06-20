"use client";

import { usePathname } from "next/navigation";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { HeaderActions } from "./header-actions";

/**
 * 前台布局外壳：
 * - 主页（/）：仿 Lovart —— 左侧竖栏 + 精简顶栏（仅右上角积分/通知/消息/头像）
 * - 其它页：保持完整 Header（含横向导航），避免无导航入口
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/") {
    return (
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-end px-6 bg-white/80 backdrop-blur-lg dark:bg-neutral-950/80">
            <HeaderActions />
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
    </>
  );
}
