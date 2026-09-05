"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/http";
import type { VideoDownloadResolveVO } from "@/lib/social-analysis-api";
import { receiveVideoDownload, type VideoDownloadProgress } from "./video-download-client";

type DownloadState = VideoDownloadProgress & {
  phase: "idle" | "preparing" | "receiving" | "ready" | "failed" | "cancelled";
  name: string;
  error: string;
  savedUrl: string;
};
const empty: DownloadState = { phase: "idle", loaded: 0, total: 0, name: "", error: "", savedUrl: "" };

function saveFile(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function useVideoDownload(ownerUserId: string) {
  const [state, setState] = useState({ ...empty, owner: ownerUserId });
  const active = useRef<AbortController | null>(null);
  const saved = useRef<{ id: string; url: string; name: string; size: number } | null>(null);

  useEffect(() => {
    return () => {
      active.current?.abort();
      active.current = null;
      if (saved.current) URL.revokeObjectURL(saved.current.url);
      saved.current = null;
    };
  }, [ownerUserId]);

  const start = async (result: VideoDownloadResolveVO, maxBytes: number, onStarted: () => void, onFinished: () => void) => {
    if (active.current) return;
    if (saved.current?.id === result.id) {
      const file = saved.current;
      setState({ ...empty, owner: ownerUserId, name: file.name, phase: "ready", loaded: file.size, total: file.size, savedUrl: file.url });
      try { saveFile(file.url, file.name); } catch { /* The visible save link remains available. */ }
      return;
    }
    if (result.expiresAt * 1000 <= Date.now()) {
      setState({ ...empty, owner: ownerUserId, phase: "failed", name: result.fileName, error: "下载地址已过期，请重新获取视频" });
      return;
    }
    if (saved.current) URL.revokeObjectURL(saved.current.url);
    saved.current = null;
    const controller = new AbortController();
    active.current = controller;
    const name = result.fileName || "video.mp4";
    setState({ ...empty, owner: ownerUserId, name, phase: "preparing" });
    onStarted();
    try {
      const blob = await receiveVideoDownload(apiUrl(result.downloadUrl), maxBytes, controller.signal, (progress) => {
        if (active.current === controller) setState({ ...empty, ...progress, owner: ownerUserId, name, phase: "receiving" });
      });
      if (active.current !== controller) return;
      const url = URL.createObjectURL(blob);
      saved.current = { id: result.id, url, name, size: blob.size };
      setState({ ...empty, owner: ownerUserId, name, phase: "ready", loaded: blob.size, total: blob.size, savedUrl: url });
      try { saveFile(url, name); } catch { /* The visible save link remains available. */ }
    } catch (error) {
      if (active.current !== controller) return;
      setState({ ...empty, owner: ownerUserId, name, phase: controller.signal.aborted ? "cancelled" : "failed", error: error instanceof Error ? error.message : "下载失败，请重试" });
    } finally {
      if (active.current === controller) {
        active.current = null;
        onFinished();
      }
    }
  };

  const visibleState = state.owner === ownerUserId ? state : empty;
  return { state: visibleState, start, busy: visibleState.phase === "preparing" || visibleState.phase === "receiving", cancel: () => active.current?.abort() };
}
