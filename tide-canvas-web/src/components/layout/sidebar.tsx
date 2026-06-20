"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Layers, Plus, Home, Folder, MessageSquare, BookOpen, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// 左侧竖向导航项（仿 Lovart）
const NAV = [
  { href: "/", icon: Home, key: "home" },
  { href: "/user/projects", icon: Folder, key: "projects" },
  { href: "/community", icon: MessageSquare, key: "community" },
  { href: "/blogs", icon: BookOpen, key: "blog" },
] as const;

function Tooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-xs text-white opacity-0 shadow transition-opacity group-hover:opacity-100 dark:bg-neutral-700">
      {label}
    </span>
  );
}

/** 主页专用左侧竖栏：logo + 新建 + 导航 + 底部用户。 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const tNav = useTranslations("nav");
  const tRecent = useTranslations("recent");
  const tUser = useTranslations("userMenu");

  const newProject = () => router.push(isLoggedIn ? "/canvas/new" : "/login");

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center border-r border-neutral-200 bg-white py-4 dark:border-neutral-800 dark:bg-neutral-950">
      {/* logo */}
      <Link href="/" aria-label="TideCanvas" className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 dark:bg-white">
        <Layers className="h-5 w-5 text-white dark:text-neutral-900" />
      </Link>

      {/* 新建项目 */}
      <button
        type="button"
        onClick={newProject}
        aria-label={tRecent("create")}
        className="group relative mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
      >
        <Plus className="h-5 w-5" />
        <Tooltip label={tRecent("create")} />
      </button>

      {/* 导航 */}
      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ href, icon: Icon, key }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-label={tNav(key)}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                active
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              }`}
            >
              <Icon className="h-5 w-5" />
              <Tooltip label={tNav(key)} />
            </Link>
          );
        })}
      </nav>

      {/* 用户（底部） */}
      <div className="mt-auto">
        <Link
          href="/user"
          aria-label={tUser("profile")}
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          <User className="h-5 w-5" />
          <Tooltip label={tUser("profile")} />
        </Link>
      </div>
    </aside>
  );
}
