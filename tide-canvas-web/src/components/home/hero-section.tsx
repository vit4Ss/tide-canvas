"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function HeroSection() {
  const { isLoggedIn, initialized } = useAuth();

  // 登录态加载中(initialized=false)或已登录 → 不展示营销 Hero：
  // 登录用户直接进入工作台(Banner 顶到顶部)，且加载期不渲染可避免 Hero 闪现
  if (!initialized || isLoggedIn) return null;

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(120,119,198,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_60%,rgba(255,182,72,0.06),transparent_50%)]" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 lg:py-40">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            无限画布
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-neutral-600 dark:text-neutral-400 sm:text-xl">
            在{" "}
            <span className="border-b-2 border-amber-400 font-medium text-neutral-900 dark:text-white">
              无限画布
            </span>
            {" "}中生成、连接和重组{" "}
            <span className="border-b-2 border-amber-400 font-medium text-neutral-900 dark:text-white">
              图片、文字与图形
            </span>
            ，让创作从单次生成变成连续推演。
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/canvas/new"
              className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:bg-neutral-800 hover:shadow-xl dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
            >
              开始使用
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-8 py-3.5 text-base font-semibold text-neutral-700 transition-all hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Play className="h-4 w-4" />
              浏览作品
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
