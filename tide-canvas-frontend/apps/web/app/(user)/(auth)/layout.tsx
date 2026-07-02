"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { HeaderActions } from "@/components/layout/header-actions";
import { Sidebar, SIDEBAR_COLLAPSED_STORAGE_KEY } from "@/components/layout/sidebar";
import { useAuth } from "@/hooks/use-auth";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (saved === "1" || saved === "0") setSidebarCollapsed(saved === "1");
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSidebarCollapsedChange = (next: boolean) => {
    setSidebarCollapsed(next);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
  };

  useEffect(() => {
    if (initialized && !isLoggedIn) {
      router.replace("/login");
    }
  }, [initialized, isLoggedIn, router]);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-900" />
      </div>
    );
  }

  if (!isLoggedIn) return null;

  // 资产页和项目页沿用左侧工作台布局，其他账号页保留完整顶部栏。
  if (pathname.startsWith("/user/assets") || pathname.startsWith("/user/projects")) {
    return (
      <div className={(sidebarCollapsed ? "lg:pl-[56px]" : "lg:pl-[192px]") + " min-h-screen bg-white text-neutral-950 transition-[padding] duration-300 ease-out dark:bg-neutral-950 dark:text-neutral-50"}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={handleSidebarCollapsedChange} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-end bg-white/80 px-6 backdrop-blur-lg dark:bg-neutral-950/80">
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
