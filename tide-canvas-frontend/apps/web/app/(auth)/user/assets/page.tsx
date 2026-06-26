"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fileApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { FileVO, FileQuery } from "@/types/file";
import {
  Plus,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List as ListIcon,
  Image as ImageIcon,
  Film,
  FileIcon,
  Trash2,
  X,
  Users,
} from "lucide-react";
import { formatFileSize, formatDate } from "@/lib/utils";

const TABS = [
  { value: "", label: "全部", icon: LayoutGrid },
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "video", label: "视频", icon: Film },
  { value: "other", label: "其他", icon: FileIcon },
] as const;

const typeIcons: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  other: FileIcon,
};

export default function UserAssetsPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<FileVO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fileApi.list({
        pageNum: 1,
        pageSize: 100,
        fileType: (filterType || undefined) as FileQuery["fileType"],
      });
      if (res.success && res.data) setFiles(res.data.records);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        await fileApi.upload(file);
      }
      await loadFiles();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除该文件吗？")) return;
    const res = await fileApi.delete(id);
    if (res.success) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (preview?.id === id) setPreview(null);
    }
  };

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = files.filter((f) => !kw || f.originalName.toLowerCase().includes(kw));
    return [...list].sort((a, b) => {
      const ta = new Date(a.createTime).getTime();
      const tb = new Date(b.createTime).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
  }, [files, search, sortDesc]);

  const isMine = (f: FileVO) => !f.ownerId || f.ownerId === user?.id;

  return (
    <div className="px-6 py-8 lg:px-10">
      <input ref={inputRef} type="file" multiple accept="image/*,video/*" onChange={handleUpload} className="hidden" />

      <h1 className="text-2xl font-bold">资产库</h1>

      {/* 类型 tab + 工具栏 */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {TABS.map((tb) => (
            <button
              key={tb.value}
              onClick={() => setFilterType(tb.value)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filterType === tb.value
                  ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-white"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <tb.icon className="h-4 w-4" />
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Plus className="h-4 w-4" />
            {uploading ? "上传中..." : "新增"}
          </button>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索素材"
              className="w-44 rounded-full border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <button
            onClick={() => setSortDesc((d) => !d)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <ArrowUpDown className="h-4 w-4" />
            {sortDesc ? "倒序" : "正序"}
          </button>

          <button
            onClick={() => setView((v) => (v === "grid" ? "list" : "grid"))}
            aria-label="切换视图"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {view === "grid" ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 内容 */}
      {loading ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-24 text-center text-sm text-neutral-400">暂无素材</div>
      ) : view === "grid" ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((file) => {
            const Icon = typeIcons[file.fileType] || FileIcon;
            return (
              <div key={file.id} className="group">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreview(file)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPreview(file);
                    }
                  }}
                  className="relative block w-full cursor-pointer overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-neutral-900/20 dark:border-neutral-800 dark:bg-neutral-900 dark:focus:ring-white/20"
                >
                  <div className="aspect-[4/3]">
                    {file.fileType === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.fileUrl} alt={file.originalName} className="h-full w-full object-cover" />
                    ) : file.fileType === "video" ? (
                      <video src={file.fileUrl} muted className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Icon className="h-10 w-10 text-neutral-300" />
                      </div>
                    )}
                  </div>
                  {user?.inTeam && !isMine(file) && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      <Users className="h-3 w-3" /> 团队
                    </span>
                  )}
                  {isMine(file) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file.id);
                      }}
                      className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2 px-0.5">
                  <p className="truncate text-sm font-medium">{file.originalName}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{formatDate(file.createTime)}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 divide-y divide-neutral-100 dark:divide-neutral-800">
          {shown.map((file) => {
            const Icon = typeIcons[file.fileType] || FileIcon;
            return (
              <div key={file.id} className="group flex items-center gap-3 py-2.5">
                <button
                  onClick={() => setPreview(file)}
                  className="h-12 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  {file.fileType === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.fileUrl} alt={file.originalName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Icon className="h-5 w-5 text-neutral-300" />
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.originalName}</p>
                  <p className="text-xs text-neutral-400">
                    {formatDate(file.createTime)} · {formatFileSize(file.fileSize)}
                  </p>
                </div>
                {isMine(file) && (
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="rounded-lg p-2 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-neutral-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 预览 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute right-4 top-4 text-white">
            <X className="h-6 w-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] max-w-[80vw]">
            {preview.fileType === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.fileUrl} alt={preview.originalName} className="max-h-[80vh] rounded-lg" />
            ) : preview.fileType === "video" ? (
              <video src={preview.fileUrl} controls className="max-h-[80vh] rounded-lg" />
            ) : (
              <div className="rounded-xl bg-white p-10 text-center dark:bg-neutral-900">
                <FileIcon className="mx-auto h-16 w-16 text-neutral-400" />
                <p className="mt-4 font-medium">{preview.originalName}</p>
                <p className="text-sm text-neutral-500">{formatFileSize(preview.fileSize)}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
