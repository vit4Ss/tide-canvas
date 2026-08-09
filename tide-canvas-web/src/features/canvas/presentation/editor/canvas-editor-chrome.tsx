"use client";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import type { CanvasProjectTitleState } from "../../application/project/use-canvas-project-title";

interface CanvasEditorHeaderProps {
  projectName: string;
  saving: boolean;
  lastSaved: string | null;
  title: CanvasProjectTitleState;
}

export function CanvasEditorHeader({
  projectName,
  saving,
  lastSaved,
  title,
}: CanvasEditorHeaderProps) {
  return (
    <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
      <Link
        href="/projects"
        aria-label="返回项目列表"
        title="返回项目列表"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </Link>
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {title.editing ? (
          <input
            autoFocus
            value={title.draft}
            onChange={(event) => title.setDraft(event.target.value)}
            onBlur={() => void title.confirmEditing()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void title.confirmEditing();
              if (event.key === "Escape") title.cancelEditing();
            }}
            aria-label="项目名称"
            className="w-44 rounded-md border border-neutral-300 px-2 py-0.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800"
          />
        ) : (
          <button
            type="button"
            onClick={title.startEditing}
            title="点击重命名"
            className="group flex items-center gap-1.5"
          >
            <span className="max-w-[220px] truncate text-sm font-medium">{projectName}</span>
            <Pencil className="h-3 w-3 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </button>
        )}
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" aria-label="正在保存" />
        ) : lastSaved ? (
          <span title={`已保存 ${lastSaved}`} className="flex h-4 w-4 shrink-0 items-center justify-center">
            <Check className="h-3.5 w-3.5 text-green-500" aria-label="已保存" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function CanvasSaveConflictAlert() {
  return (
    <div
      role="alert"
      className="absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm text-neutral-700 shadow-sm dark:border-amber-900/70 dark:bg-neutral-900 dark:text-neutral-200"
    >
      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span>此画布已在其他窗口更新，当前窗口已暂停保存。</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 font-medium text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        加载最新版本
      </button>
    </div>
  );
}
