"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useRouter } from "next/navigation";
import {
  Layers,
  LogOut,
  User,
  Settings,
  LayoutDashboard,
  Menu,
  X,
  MessageSquare,
  BookOpen,
} from "lucide-react";
import { useState } from "react";
import { MessageEntry } from "@/components/im";
import { NotificationCenter } from "@/components/notification";

const navLinks = [
  { href: "/user/projects", label: "画布", icon: Layers },
  { href: "/community", label: "社区", icon: MessageSquare },
  { href: "/blogs", label: "博客", icon: BookOpen },
  // 「发现」功能开发中，暂时隐藏：{ href: "/explore", label: "发现", icon: Compass },
];

export function Header() {
  const { user, isLoggedIn, isAdmin } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/80 backdrop-blur-lg dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 dark:bg-white">
              <Layers className="h-4 w-4 text-white dark:text-neutral-900" />
            </div>
            <span className="text-lg font-bold tracking-tight">TideCanvas</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <>
            <NotificationCenter />
            <MessageEntry />
            <div
              className="relative"
              onMouseEnter={() => setUserMenuOpen(true)}
              onMouseLeave={() => setUserMenuOpen(false)}
            >
              <button
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <User className="h-4 w-4 text-neutral-500" />
                  )}
                </div>
                <span className="hidden sm:inline">{user?.nickname || user?.username}</span>
              </button>

              {userMenuOpen && (
                /* top-full + pt-1：紧贴触发区，pt-1 作为透明衔接，避免移动到菜单途中 hover 中断 */
                <div className="absolute left-0 top-full z-50 w-48 pt-1">
                  <div className="rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    <Link
                      href="/user"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <User className="h-4 w-4" />
                      个人中心
                    </Link>
                    {/* 团队功能暂时隐藏（保留路由与后端，恢复时还原此链接即可） */}
                    <Link
                      href="/user/settings"
                      className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Settings className="h-4 w-4" />
                      账户设置
                    </Link>
                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        管理后台
                      </Link>
                    )}
                    <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                    <button
                      onClick={handleLogout}
                      className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                注册
              </Link>
            </div>
          )}

          <button
            className="rounded-lg p-2 md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-neutral-200 bg-white px-4 py-3 md:hidden dark:border-neutral-800 dark:bg-neutral-950">
          <nav className="flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                onClick={() => setMobileMenuOpen(false)}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
