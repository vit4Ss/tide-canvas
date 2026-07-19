"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  pageNum: number;
  pageSize: number;
  total: number;
  onChange: (pageNum: number) => void;
}

export function Pagination({ pageNum, pageSize, total, onChange }: Props) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-400">
        第 {pageNum} / {totalPages} 页，共 {total} 条
      </p>
      <div className="flex gap-1">
        <button
          disabled={pageNum <= 1}
          onClick={() => onChange(pageNum - 1)}
          className="rounded-lg p-1.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          disabled={pageNum >= totalPages}
          onClick={() => onChange(pageNum + 1)}
          className="rounded-lg p-1.5 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
