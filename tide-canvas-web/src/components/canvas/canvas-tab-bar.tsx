"use client";

import { usePathname, useRouter } from "next/navigation";
import { Plus, X, Layers } from "lucide-react";
import { useCanvasTabs } from "@/stores/use-canvas-tabs";

/** 画布工作区顶部标签栏：多画布切换 / 关闭 / 新建。 */
export function CanvasTabBar() {
  const tabs = useCanvasTabs((s) => s.tabs);
  const closeTab = useCanvasTabs((s) => s.closeTab);
  const pathname = usePathname();
  const router = useRouter();
  const current = pathname.startsWith("/canvas/") ? pathname.slice("/canvas/".length).split("/")[0] : "";

  const handleClose = (e: React.MouseEvent, token: string) => {
    e.stopPropagation();
    const idx = tabs.findIndex((t) => t.token === token);
    const rest = tabs.filter((t) => t.token !== token);
    closeTab(token);
    if (token === current) {
      if (rest.length) router.push(`/canvas/${rest[Math.min(idx, rest.length - 1)].token}`);
      else router.push("/");
    }
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-2 dark:border-neutral-800 dark:bg-neutral-900">
      {tabs.map((t) => {
        const active = t.token === current;
        return (
          <div
            key={t.token}
            onClick={() => router.push(`/canvas/${t.token}`)}
            title={t.name}
            className={`group flex max-w-[180px] shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <span className="truncate">{t.name}</span>
            <button
              type="button"
              onClick={(e) => handleClose(e, t.token)}
              aria-label="关闭"
              className="shrink-0 rounded p-0.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => router.push("/canvas/new")}
        aria-label="新建画布"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
