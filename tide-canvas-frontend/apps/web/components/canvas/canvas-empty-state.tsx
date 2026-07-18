"use client";

import { Layers3 } from "lucide-react";

export function CanvasEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex w-[280px] flex-col items-center rounded-2xl border border-neutral-200/80 bg-white/88 px-8 py-10 text-center text-neutral-400 shadow-[0_10px_34px_rgba(15,23,42,0.07)] backdrop-blur dark:border-white/10 dark:bg-[#202124]/90 dark:shadow-black/25">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 dark:bg-white/8 dark:text-neutral-500">
          <Layers3 className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">从一个节点开始创作</p>
        <p className="mt-2 text-xs leading-5">点击底部“＋”或右键画布添加节点</p>
        <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">滚轮缩放 · 拖拽平移</p>
      </div>
    </div>
  );
}
