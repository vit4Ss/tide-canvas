"use client";

import { useEffect, useState, useRef } from "react";
import { fileApi } from "@/lib/api";
import type { FileVO, FileQuery } from "@/types/file";
import { Upload, Trash2, Image, Film, FileIcon, X } from "lucide-react";
import { formatFileSize, formatDate } from "@/lib/utils";

const typeIcons: Record<string, typeof Image> = {
  image: Image,
  video: Film,
  other: FileIcon,
};

export default function UserAssetsPage() {
  const [files, setFiles] = useState<FileVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [preview, setPreview] = useState<FileVO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, [filterType]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fileApi.list({
        pageNum: 1,
        pageSize: 100,
        fileType: (filterType || undefined) as FileQuery["fileType"],
      });
      if (res.success && res.data) {
        setFiles(res.data.records);
      }
    } finally {
      setLoading(false);
    }
  };

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

  const filters = [
    { value: "", label: "全部" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "other", label: "其他" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的素材</h1>
          <p className="mt-1 text-sm text-neutral-500">管理上传的图片、视频和其他文件</p>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "上传中..." : "上传文件"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterType(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filterType === f.value
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="mt-20 text-center text-neutral-400">暂无文件</div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {files.map((file) => {
            const Icon = typeIcons[file.fileType] || FileIcon;
            return (
              <div
                key={file.id}
                className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
              >
                <button onClick={() => setPreview(file)} className="block w-full">
                  <div className="aspect-square bg-neutral-50 dark:bg-neutral-900">
                    {file.fileType === "image" ? (
                      <img src={file.fileUrl} alt={file.originalName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Icon className="h-12 w-12 text-neutral-300" />
                      </div>
                    )}
                  </div>
                </button>
                <div className="p-2.5">
                  <p className="truncate text-xs font-medium">{file.originalName}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{formatFileSize(file.fileSize)}</p>
                </div>
                <button
                  onClick={() => handleDelete(file.id)}
                  className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute right-4 top-4 text-white">
            <X className="h-6 w-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] max-w-[80vw]">
            {preview.fileType === "image" ? (
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
