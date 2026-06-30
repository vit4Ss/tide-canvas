"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Box, ChevronLeft, ChevronRight, FolderOpen, ImagePlus, LayoutGrid, Plus } from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { useAuth } from "@/hooks/use-auth";
import { projectApi } from "@/lib/api";
import type { ProjectVO } from "@/types/canvas";
import { displayProjectName } from "@/lib/utils";

const NAV = [
  { href: "/", key: "create", icon: Plus },
  { href: "/user/assets", key: "assets", icon: FolderOpen },
  { href: "/user/projects", key: "projects", icon: LayoutGrid },
] as const;

export function Sidebar({
  collapsed = false,
  onCollapsedChange,
}: {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const pathname = usePathname();
  const { isLoggedIn } = useAuth();
  const t = useTranslations("sidebar");
  const [history, setHistory] = useState<ProjectVO[]>([]);

  useEffect(() => {
    if (!isLoggedIn) {
      setHistory([]);
      return;
    }
    projectApi
      .list({ pageNum: 1, pageSize: 10 })
      .then((res) => {
        if (res.success && res.data) setHistory(res.data.records);
      })
      .catch(() => {});
  }, [isLoggedIn]);

  return (
    <aside className={(collapsed ? "w-[72px]" : "w-[208px]") + " fixed left-0 top-0 z-30 hidden h-screen shrink-0 transition-[width] duration-300 ease-out lg:block"}>
      <div className={(collapsed ? "px-2" : "px-4") + " relative z-10 flex h-full flex-col border-r border-black/[0.06] bg-white/94 py-5 shadow-[8px_0_28px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-[padding] duration-300 dark:border-white/10 dark:bg-[#1a1b20]/94"}>
        <div className={(collapsed ? "justify-center px-1" : "justify-between px-2") + " flex items-center pb-4"}>
          <Link href="/" className={(collapsed ? "justify-center" : "") + " flex min-w-0 items-center gap-2"} title="TideCanvas">
            <BrandMark className="h-6 w-6 shrink-0" />
            {!collapsed && <span className="truncate text-[15px] font-bold tracking-tight">TideCanvas</span>}
          </Link>
          <button
            type="button"
            onClick={() => onCollapsedChange?.(!collapsed)}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="mt-2 flex flex-col gap-1">
          {NAV.map(({ href, key, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={t(key)}
                className={(active
                  ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-white/8") +
                  (collapsed ? " justify-center px-0" : " gap-2.5 px-3") +
                  " flex h-9 items-center rounded-xl py-2 text-sm font-medium transition-colors"}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{t(key)}</span>}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <>
        <div className="mt-6 flex items-center justify-between px-2">
          <span className="text-xs font-medium text-neutral-400">{t("history")}</span>
          <Link href="/user/projects" className="text-xs text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200">
            {t("viewAll")}
          </Link>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-auto pr-1">
          {history.length === 0 ? (
            <div className="mx-1 mt-2 flex items-center gap-2 rounded-2xl bg-neutral-50 px-3 py-3 text-xs text-neutral-400 dark:bg-white/5 dark:text-neutral-500">
              <Box className="h-4 w-4" />
              {t("empty")}
            </div>
          ) : (
            history.map((p) => (
              <Link
                key={p.id}
                href={`/canvas/${p.urlToken}`}
                target="_blank"
                rel="noopener"
                title={displayProjectName(p.name)}
                className="mb-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-300 dark:bg-white/5 dark:text-neutral-600">
                  <ImagePlus className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{displayProjectName(p.name)}</span>
              </Link>
            ))
          )}
        </div>
          </>
        )}
      </div>
    </aside>
  );
}
