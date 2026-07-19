"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "./header";
import { Sidebar, SIDEBAR_COLLAPSED_STORAGE_KEY } from "./sidebar";
import { HeaderActions } from "./header-actions";

export function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (saved === "1" || saved === "0") setSidebarCollapsed(saved === "1");
    });
    return () => { active = false; };
  }, []);

  const handleSidebarCollapsedChange = (next: boolean) => {
    setSidebarCollapsed(next);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
  };

  if (pathname === "/") {
    return (
      <div className={(sidebarCollapsed ? "lg:pl-[56px]" : "lg:pl-[192px]") + " relative min-h-screen overflow-x-hidden bg-[#f5f5f1] text-neutral-950 transition-[padding] duration-300 ease-out dark:bg-[#101114] dark:text-neutral-50"}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={handleSidebarCollapsedChange} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="pointer-events-none fixed right-0 top-0 z-40 flex h-16 items-center justify-end px-5 sm:px-7">
            <div className="pointer-events-auto">
              <HeaderActions />
            </div>
          </header>
          <main className="relative flex-1">{children}</main>
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
