"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut, User, Settings, LayoutDashboard, Zap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { MessageEntry } from "@/components/im";
import { NotificationCenter } from "@/components/notification";
import { LocaleSwitcher } from "./locale-switcher";

/**
 * 顶部右侧操作区：积分 / 通知 / 消息 / 用户菜单（含语言切换、退出）；未登录显示登录注册。
 * 由完整 Header 与主页精简顶栏（PublicShell）共用，避免逻辑重复。
 */
export function HeaderActions() {
  const t = useTranslations();
  const { user, isLoggedIn, isAdmin } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  if (!isLoggedIn) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {t("auth.login")}
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {t("auth.register")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-white/76 p-1 shadow-[0_10px_32px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.06] backdrop-blur-xl dark:bg-[#1b1c22]/76 dark:ring-white/10">
      {/* 积分余额：点击进入积分中心 */}
      <Link
        href="/user/points"
        title={t("header.pointsTitle")}
        className="flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-neutral-800 shadow-sm ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-50 dark:bg-white/10 dark:text-neutral-100 dark:ring-white/10 dark:hover:bg-white/15"
      >
        <Zap className="h-4 w-4 fill-amber-400 text-amber-400" />
        {user?.points ?? 0}
      </Link>
      {/* 开通会员入口暂时隐藏（保留 /user/recharge?tab=member 路由，恢复时还原此按钮即可） */}
      <NotificationCenter />
      <MessageEntry />
      <div
        className="relative"
        onMouseEnter={() => setUserMenuOpen(true)}
        onMouseLeave={() => setUserMenuOpen(false)}
      >
        <button className="flex h-8 cursor-pointer items-center gap-2 rounded-full px-1.5 pl-3 text-sm text-neutral-700 transition-colors hover:bg-white/70 dark:text-neutral-200 dark:hover:bg-white/10">
          <span className="hidden sm:inline">{user?.nickname || user?.username}</span>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 ring-1 ring-black/[0.04] dark:bg-white/10 dark:ring-white/10">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <User className="h-4 w-4 text-neutral-500" />
            )}
          </div>
        </button>

        {userMenuOpen && (
          /* top-full + pt-1：紧贴触发区，pt-1 作为透明衔接，避免移动到菜单途中 hover 中断 */
          <div className="absolute right-0 top-full z-50 w-48 pt-1">
            <div className="rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <Link
                href="/user"
                className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                onClick={() => setUserMenuOpen(false)}
              >
                <User className="h-4 w-4" />
                {t("userMenu.profile")}
              </Link>
              <Link
                href="/user/settings"
                className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                onClick={() => setUserMenuOpen(false)}
              >
                <Settings className="h-4 w-4" />
                {t("userMenu.settings")}
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  {t("userMenu.admin")}
                </Link>
              )}
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
              <LocaleSwitcher onSwitched={() => setUserMenuOpen(false)} />
              <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
              <button
                onClick={handleLogout}
                className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <LogOut className="h-4 w-4" />
                {t("userMenu.logout")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
