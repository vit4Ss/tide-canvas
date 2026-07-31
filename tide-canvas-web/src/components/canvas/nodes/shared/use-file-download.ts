"use client";

import { useCallback, useState } from "react";
import { fetchWithAuth } from "@/lib/http";
import { toast } from "@/components/shared/toast";

/** 下载媒体文件：经后端代理拉取（同源、无跨域），转 blob 触发浏览器下载，全程不导航刷新 */
export function useFileDownload() {
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(async (e: React.MouseEvent, url: string | undefined, name: string, ext: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const api = `/api/files/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
      const res = await fetchWithAuth(api);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${name}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("下载失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  return { downloading, download };
}
