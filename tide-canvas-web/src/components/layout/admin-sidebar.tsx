"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileImage,
  Bot,
  Image,
  FolderOpen,
  ScrollText,
  Settings,
  Layers,
  ChevronLeft,
  Coins,
  PenTool,
  ShoppingCart,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";

const sidebarItems = [
  { href: "/admin", label: "数据面板", icon: LayoutDashboard },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/contents", label: "内容管理", icon: FileImage },
  { href: "/admin/points", label: "积分管理", icon: Coins },
  { href: "/admin/authors", label: "作者管理", icon: PenTool },
  { href: "/admin/orders", label: "订单管理", icon: ShoppingCart },
  { href: "/admin/redeem", label: "兑换码", icon: Ticket },
  { href: "/admin/ai/providers", label: "AI 供应商", icon: Bot },
  { href: "/admin/ai/models", label: "模型管理", icon: Bot },
  { href: "/admin/ai/handlers", label: "Handler 积分", icon: Coins },
  { href: "/admin/ai/logs", label: "操作日志", icon: ScrollText },
  { href: "/admin/banners", label: "Banner 管理", icon: Image },
  { href: "/admin/files", label: "文件管理", icon: FolderOpen },
  { href: "/admin/logs", label: "系统日志", icon: ScrollText },
  { href: "/admin/settings", label: "系统设置", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 dark:bg-white">
            <Layers className="h-4 w-4 text-white dark:text-neutral-900" />
          </div>
          <span className="text-sm font-bold">TideCanvas 管理</span>
        </Link>
        <Link href="/" className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {sidebarItems.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                    : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
