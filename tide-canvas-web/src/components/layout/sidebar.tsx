"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Plus, Sparkles, FolderOpen, LayoutGrid } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { projectApi } from "@/lib/api";
import type { ProjectVO } from "@/types/canvas";
import { displayProjectName } from "@/lib/utils";

const NAV = [
  { href: "/", key: "create", icon: Sparkles },
  { href: "/user/assets", key: "assets", icon: FolderOpen },
  { href: "/user/projects", key: "projects", icon: LayoutGrid },
] as const;

/** 主页左侧栏：logo + 新建 + 导航 + 创作历史列表。 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const t = useTranslations("sidebar");
  const [history, setHistory] = useState<ProjectVO[]>([]);

  useEffect(() => {
    if (!isLoggedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory([]);
      return;
    }
    projectApi
      .list({ pageNum: 1, pageSize: 15 })
      .then((res) => {
        if (res.success && res.data) setHistory(res.data.records);
      })
      .catch(() => {});
  }, [isLoggedIn]);

  const newProject = () => router.push(isLoggedIn ? "/canvas/new" : "/login");

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {/* logo */}
      <Link href="/" className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 dark:bg-white">
          <Layers className="h-4 w-4 text-white dark:text-neutral-900" />
        </div>
        <span className="text-base font-bold tracking-tight">TideCanvas</span>
      </Link>

      {/* 新建创作 */}
      <div className="px-3">
        <button
          type="button"
          onClick={newProject}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          {t("create")}
        </button>
      </div>

      {/* 导航 */}
      <nav className="mt-3 flex flex-col gap-0.5 px-3">
        {NAV.map(({ href, key, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(key)}
            </Link>
          );
        })}
      </nav>

      {/* 创作历史 */}
      <div className="mt-5 flex items-center justify-between px-5">
        <span className="text-xs font-medium text-neutral-400">{t("history")}</span>
        <Link href="/user/projects" className="text-xs text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200">
          {t("viewAll")}
        </Link>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-auto px-3 pb-4">
        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-neutral-300 dark:text-neutral-600">{t("empty")}</p>
        ) : (
          history.map((p) => (
            <Link
              key={p.id}
              href={`/canvas/${p.urlToken}`}
              title={displayProjectName(p.name)}
              className="block truncate rounded-lg px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {displayProjectName(p.name)}
            </Link>
          ))
        )}
      </div>
    </aside>
  );
}
