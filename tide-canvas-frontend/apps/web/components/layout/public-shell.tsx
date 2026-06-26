"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { HeaderActions } from "./header-actions";

export function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (pathname === "/") {
    return (
      <div className={(sidebarCollapsed ? "lg:pl-[72px]" : "lg:pl-[208px]") + " relative min-h-screen overflow-x-hidden bg-[#f5f5f1] text-neutral-950 transition-[padding] duration-300 ease-out dark:bg-[#101114] dark:text-neutral-50"}>
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
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
