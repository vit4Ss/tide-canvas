"use client";

import { useEffect, useMemo } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { APP_UPDATE_CAN_RELOAD_EVENT } from "@/lib/app-update";
import {
  claimStaleAssetReload,
  clientErrorReference,
  isStaleClientAssetError,
  scheduleAssetRecovery,
  canAutoRecoverDocument,
} from "@/lib/client-error-recovery";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const staleAsset = useMemo(() => isStaleClientAssetError(error), [error]);
  const reference = useMemo(() => clientErrorReference(error), [error]);

  useEffect(() => {
    console.error("页面渲染错误:", error);
    return scheduleAssetRecovery(error, {
      schedule: (run) => {
        const timer = window.setTimeout(run, 120);
        return () => window.clearTimeout(timer);
      },
      canReload: () => navigator.onLine
        && canAutoRecoverDocument(window as Window & { __flowinglightInteracted?: boolean })
        && window.dispatchEvent(new Event(APP_UPDATE_CAN_RELOAD_EVENT, { cancelable: true })),
      claim: () => claimStaleAssetReload(error, window.location.pathname, window.sessionStorage),
      reload: () => window.location.reload(),
    });
  }, [error, staleAsset]);

  const retry = () => {
    if (staleAsset) window.location.reload();
    else reset();
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30">
          <AlertTriangle className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold">页面出错了</h1>
        <p className="mt-3 text-neutral-500">
          {staleAsset
            ? "页面资源加载失败，请检查网络后重新加载页面。"
            : "很抱歉，页面在渲染时遇到了意外错误。您可以尝试重试或返回首页。"}
        </p>
        <p className="mt-2 text-xs text-neutral-400">错误标识：{reference}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
          >
            <RefreshCw className="h-4 w-4" />
            {staleAsset ? "重新加载" : "重试"}
          </button>
          {/* Native navigation also works when the client router's chunk failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Home className="h-4 w-4" />
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}
