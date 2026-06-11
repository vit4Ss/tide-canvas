"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { checkinApi } from "@/lib/api";
import {
  FolderOpen,
  ImagePlus,
  Settings,
  Coins,
  HardDrive,
  ChevronRight,
  User,
  CalendarCheck,
  ShoppingCart,
  BookOpen,
  Sparkles,
  Ticket,
} from "lucide-react";

export default function UserPage() {
  const { user } = useAuth();
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [streak, setStreak] = useState(0);

  const menuItems = [
    { href: "/user/projects", label: "我的项目", desc: "管理画布项目", icon: FolderOpen },
    ...(user?.isAuthor === 1
      ? [{ href: "/user/blogs", label: "我的博客", desc: "管理已发布的文章", icon: BookOpen }]
      : []),
    { href: "/user/points", label: "积分中心", desc: "余额、签到、流水明细", icon: Coins },
    { href: "/user/recharge", label: "充值积分", desc: "购买积分套餐", icon: ShoppingCart },
    { href: "/user/recharge", label: "兑换码", desc: "充值或输入兑换码兑换积分", icon: Ticket },
    { href: "/user/orders", label: "我的订单", desc: "充值订单记录", icon: ShoppingCart },
    { href: "/user/assets", label: "我的素材", desc: "上传和管理素材", icon: ImagePlus },
    // 团队功能暂时隐藏（保留路由 /user/team 与后端，恢复时取消注释即可）：
    // { href: "/user/team", label: "我的团队", desc: "创建或加入团队，共享素材与项目", icon: Users },
    { href: "/user/settings", label: "账户设置", desc: "密码、通知偏好", icon: Settings },
  ];

  useEffect(() => {
    checkinApi.status().then((res) => {
      if (res.success) {
        setCheckedIn(res.data.checkedInToday);
        setStreak(res.data.streakDays);
      }
    });
  }, []);

  const handleCheckin = async () => {
    if (checkedIn || checkinLoading) return;
    setCheckinLoading(true);
    try {
      const res = await checkinApi.checkin();
      if (res.success) {
        setCheckedIn(true);
        setStreak(res.data.streakDays);
        alert(`签到成功！获得 ${res.data.pointsAwarded} 积分`);
      } else {
        alert(res.message);
      }
    } finally {
      setCheckinLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-5 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <User className="h-10 w-10 text-neutral-400" />
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{user?.nickname || user?.username}</h1>
          <p className="mt-1 text-sm text-neutral-500">{user?.email}</p>
          {user?.isAuthor === 1 && (
            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              签约作者
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2.5 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">积分余额</p>
              <p className="text-2xl font-bold">{user?.points ?? 0}</p>
            </div>
          </div>
          <Link href="/user/recharge" className="mt-3 block text-center text-xs font-medium text-amber-600 hover:underline">
            去充值 →
          </Link>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2.5 text-green-600 dark:bg-green-950 dark:text-green-400">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">连续签到</p>
              <p className="text-2xl font-bold">{streak} 天</p>
            </div>
          </div>
          <button
            onClick={handleCheckin}
            disabled={checkedIn || checkinLoading}
            className={`mt-3 w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
              checkedIn
                ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                : "bg-green-500 text-white hover:bg-green-600"
            }`}
          >
            {checkedIn ? "今日已签到 ✓" : checkinLoading ? "签到中..." : "立即签到"}
          </button>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">存储空间</p>
              <p className="text-xl font-bold">
                {user?.storageQuota ? `${(user.storageQuota / 1073741824).toFixed(1)} GB` : "0 GB"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-neutral-500" />
              <div>
                <p className="font-medium">{item.label}</p>
                <p className="text-sm text-neutral-500">{item.desc}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
