"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { HeaderActions } from "@/components/layout/header-actions";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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

  // 资产页 / 项目页采用左侧栏工作台布局（与主页一致）；其余账户页保持完整顶栏
  if (pathname.startsWith("/user/assets") || pathname.startsWith("/user/projects")) {
    return (
      <div className="min-h-screen bg-white text-neutral-950 transition-[padding] duration-300 ease-out dark:bg-neutral-950 dark:text-neutral-50 lg:pl-[208px]">
        <Sidebar />
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
