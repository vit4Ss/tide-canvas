"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("页面渲染错误:", error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold">页面出错了</h1>
        <p className="mt-3 text-neutral-500">
          很抱歉，页面在渲染时遇到了意外错误。您可以尝试重试或返回首页。
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-neutral-400">错误 ID: {error.digest}</p>
        )}
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
