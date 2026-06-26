"use client";

import { useCallback, useEffect, useState } from "react";
import { aiApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { AiTaskStatus, type AiTaskVO, type AiGenerationLogVO } from "@/types/ai";
import { X, RefreshCw, Loader2, CheckCircle2, XCircle, Inbox } from "lucide-react";

const HANDLER_LABEL: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  start_end_to_video: "首尾帧视频",
  creative_desc: "创意描述",
};
const OP_LABEL: Record<string, string> = { generation: "文生图", edits: "图生图", video: "视频" };

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 画布历史面板：当前画布「进行中任务」+「请求历史」（生成日志） */
export function CanvasHistoryPanel({ open, onClose }: Props) {
  const projectId = useCanvasStore((s) => s.currentProjectId);
  const [tasks, setTasks] = useState<AiTaskVO[]>([]);
  const [logs, setLogs] = useState<AiGenerationLogVO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [tRes, lRes] = await Promise.all([
        aiApi.listTasks({ pageNum: 1, pageSize: 50, status: AiTaskStatus.PROCESSING, ...(projectId ? { projectId } : {}) }),
        aiApi.canvasLogs({ pageNum: 1, pageSize: 50, ...(projectId ? { projectId } : {}) }),
      ]);
      if (tRes.success) setTasks(tRes.data.records);
      if (lRes.success) setLogs(lRes.data.records);
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  // 打开时拉取，并每 4s 刷新（进行中任务进度）
  useEffect(() => {
    if (!open) return;
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="absolute bottom-4 left-20 top-4 z-20 flex w-80 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <span className="text-sm font-semibold">历史 · 本画布</span>
        <div className="flex items-center gap-1">
          <button onClick={() => void load()} title="刷新" className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} title="关闭" className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="flex h-40 items-center justify-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            {/* 进行中任务 */}
            <div className="px-3 pt-3">
              <p className="mb-2 px-1 text-xs font-medium text-neutral-400">进行中 ({tasks.length})</p>
              {tasks.length === 0 ? (
                <p className="px-1 pb-2 text-xs text-neutral-400">暂无进行中的任务</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} className="rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 dark:border-blue-900/40 dark:bg-blue-900/10">
                      <div className="flex items-center gap-2 text-xs">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                        <span className="font-medium">{HANDLER_LABEL[t.handler] ?? t.handler}</span>
                        <span className="ml-auto text-neutral-400">{t.createTime?.replace("T", " ").slice(5, 19)}</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${t.progress || 5}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 请求历史 */}
            <div className="px-3 py-3">
              <p className="mb-2 px-1 text-xs font-medium text-neutral-400">请求历史 ({logs.length})</p>
              {logs.length === 0 ? (
                <div className="flex h-24 flex-col items-center justify-center gap-2 text-neutral-400">
                  <Inbox className="h-6 w-6" />
                  <p className="text-xs">本画布还没有生成记录</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {logs.map((l) => (
                    <div key={l.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
                      <button
                        onClick={() => setExpandedId((id) => (id === l.id ? null : l.id))}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs"
                      >
                        {l.success === 1 ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                        <span className="font-medium">{OP_LABEL[l.operation] ?? l.operation}</span>
                        <span className="truncate font-mono text-[10px] text-neutral-400">{l.model}</span>
                        <span className="ml-auto shrink-0 text-neutral-400">{l.durationMs != null ? `${(l.durationMs / 1000).toFixed(0)}s` : ""}</span>
                      </button>
                      {expandedId === l.id && (
                        <div className="space-y-1.5 border-t border-neutral-100 px-2.5 py-2 text-[11px] dark:border-neutral-800">
                          <p className="text-neutral-400">{l.createTime?.replace("T", " ").slice(0, 19)} · HTTP {l.httpStatus}</p>
                          {l.errorMsg ? (
                            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50 p-2 text-red-600 dark:bg-red-900/20 dark:text-red-300">{l.errorMsg}</pre>
                          ) : l.resultUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.resultUrl} alt="" className="max-h-32 rounded border border-neutral-200 object-contain dark:border-neutral-700" />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
