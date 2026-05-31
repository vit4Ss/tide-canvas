"use client";

import { useCallback, useEffect, useState } from "react";
import { fileApi } from "@/lib/api";
import { FileType, type FileVO } from "@/types/file";
import { X, RefreshCw, Inbox, Video, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 选中素材 → 添加到画布 */
  onPick: (file: FileVO) => void;
  /** 变化时重新拉取（如「保存到我的素材」后） */
  refreshKey?: number;
}

const TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: FileType.IMAGE, label: "图片" },
  { key: FileType.VIDEO, label: "视频" },
];

/** 「我的素材」面板：拉取当前用户已上传/生成的文件，点击即在画布中心新建对应节点 */
export function MyAssetsPanel({ open, onClose, onPick, refreshKey }: Props) {
  const [files, setFiles] = useState<FileVO[]>([]);
  const [tab, setTab] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  // setState 均在 await 之后（不在同步路径置加载态，避免 effect 内同步 setState）
  const load = useCallback(async () => {
    try {
      const res = await fileApi.list({ pageNum: 1, pageSize: 60, ...(tab ? { fileType: tab as FileType } : {}) });
      if (res.success) setFiles(res.data.records);
    } finally {
      setLoaded(true);
    }
  }, [tab]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  if (!open) return null;

  return (
    <div className="absolute bottom-4 left-20 top-4 z-20 flex w-80 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <span className="text-sm font-semibold">我的素材</span>
        <div className="flex items-center gap-1">
          <button onClick={() => void load()} title="刷新" className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} title="关闭" className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1 text-xs transition-colors ${
              tab === t.key
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <div className="flex h-40 items-center justify-center text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : files.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-neutral-400">
            <Inbox className="h-8 w-8" />
            <p className="text-xs">暂无素材，先上传或生成一些吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {files.map((f) => (
              <button
                key={f.id}
                onClick={() => onPick(f)}
                title={f.originalName}
                className="group relative aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 transition-shadow hover:shadow-md dark:border-neutral-700 dark:bg-neutral-800"
              >
                {f.fileType === FileType.VIDEO ? (
                  <>
                    <video src={f.fileUrl} muted preload="metadata" className="h-full w-full object-cover" />
                    <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-black/50 text-white">
                      <Video className="h-3 w-3" />
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.fileUrl} alt={f.originalName} className="h-full w-full object-cover" />
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  点击添加到画布
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
