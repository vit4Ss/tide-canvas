"use client";

import { useEffect, useState } from "react";
import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { FileVO } from "@/types/file";
import {
  Trash2,
  FileImage,
  FileVideo,
  File,
  HardDrive,
  X,
  Download,
  Eye,
} from "lucide-react";
import {
  PageHeader,
  SearchBar,
  FilterTabs,
  Pagination,
  StatusBadge,
  TableSkeleton,
  EmptyState,
  ConfirmDialog,
} from "@/components/shared";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

const FILE_TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "other", label: "其他" },
];

const FILE_TYPE_BADGE: Record<string, { icon: typeof FileImage; variant: "success" | "warning" | "danger" | "info" | "neutral"; label: string }> = {
  image: { icon: FileImage, variant: "info", label: "图片" },
  video: { icon: FileVideo, variant: "info", label: "视频" },
  other: { icon: File, variant: "neutral", label: "其他" },
};

export default function AdminFilesPage() {
  const [files, setFiles] = useState<FileVO[]>([]);
  const [total, setTotal] = useState(0);
  const [totalStorageUsed, setTotalStorageUsed] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [fileType, setFileType] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState("");
  const pageSize = 15;

  const loadFiles = async (page = pageNum, search = keyword, type = fileType) => {
    setLoading(true);
    setError("");
    try {
      const params = toParams({
        pageNum: page,
        pageSize,
        keyword: search || undefined,
        fileType: type || undefined,
      });
      const res = await http.get<PageData<FileVO>>("/api/admin/files", params);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<FileVO>;
        setFiles(data.records);
        setTotal(data.total);
        // Calculate total storage used from returned records (approximate)
        const storageSum = data.records.reduce((sum, f) => sum + (f.fileSize || 0), 0);
        setTotalStorageUsed((prev) => (page === 1 ? storageSum : prev));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载文件列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles(1);
  }, []);

  const handleSearch = () => {
    setPageNum(1);
    loadFiles(1, keyword, fileType);
  };

  const handleFileTypeFilter = (type: string) => {
    setFileType(type);
    setPageNum(1);
    loadFiles(1, keyword, type);
  };

  const handlePageChange = (newPage: number) => {
    setPageNum(newPage);
    loadFiles(newPage);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      const res = await http.delete<void>(`/api/admin/files/${deleteTarget.id}`);
      if (res.success) {
        loadFiles();
      }
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  };

  const isImage = (file: FileVO) => {
    return file.fileType === "image" || file.mimeType?.startsWith("image/");
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
      <PageHeader
        title="文件管理"
        description={`共 ${total} 个文件`}
        actions={
          <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-2.5 dark:bg-neutral-800">
            <HardDrive className="h-4 w-4 text-neutral-500" />
            <span className="text-sm text-neutral-600 dark:text-neutral-300">
              已用空间: <strong>{formatFileSize(totalStorageUsed)}</strong>
            </span>
          </div>
        }
      />

      {/* 搜索和筛选 */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={keyword}
          onChange={setKeyword}
          onSearch={handleSearch}
          placeholder="搜索文件名..."
        />
        <FilterTabs<string>
          value={fileType}
          options={FILE_TYPE_OPTIONS}
          onChange={handleFileTypeFilter}
        />
        <button
          onClick={handleSearch}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          搜索
        </button>
      </div>

      {/* 文件表格 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">文件名</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">大小</th>
                <th className="px-4 py-3 font-medium">存储</th>
                <th className="px-4 py-3 font-medium">上传时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} columns={6} />
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-0 py-0">
                    <EmptyState icon={File} title="暂无文件数据" />
                  </td>
                </tr>
              ) : (
                files.map((file) => {
                  const badge = FILE_TYPE_BADGE[file.fileType] ?? FILE_TYPE_BADGE["other"];
                  const IconComp = badge.icon;
                  return (
                    <tr
                      key={file.id}
                      className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 max-w-[300px]">
                          {isImage(file) && file.fileUrl ? (
                            <button
                              onClick={() => setPreviewUrl(file.fileUrl)}
                              className="flex-shrink-0"
                            >
                              <img
                                src={file.fileUrl}
                                alt={file.originalName}
                                className="h-8 w-8 rounded object-cover border border-neutral-200 dark:border-neutral-700 hover:opacity-80 transition-opacity"
                              />
                            </button>
                          ) : (
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800">
                              <IconComp className="h-4 w-4 text-neutral-400" />
                            </div>
                          )}
                          <span className="truncate font-medium" title={file.originalName}>
                            {file.originalName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={badge.label} variant={badge.variant} />
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{formatFileSize(file.fileSize)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                          {file.storageType ?? "local"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-400">
                        {file.createTime
                          ? new Date(file.createTime).toLocaleDateString("zh-CN")
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {isImage(file) && file.fileUrl && (
                            <button
                              onClick={() => setPreviewUrl(file.fileUrl)}
                              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                              title="预览"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          {file.fileUrl && (
                            <a
                              href={file.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
                              title="下载"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                          <button
                            onClick={() => setDeleteTarget({ id: file.id, name: file.originalName })}
                            disabled={deleting === file.id}
                            className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950/30"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination pageNum={pageNum} pageSize={pageSize} total={total} onChange={handlePageChange} />
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除文件"
        message={deleteTarget ? `确定删除文件「${deleteTarget.name}」？此操作不可撤销。` : ""}
        danger
        confirmText="删除"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 图片预览弹窗 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-h-[80vh] max-w-[80vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewUrl}
              alt="预览"
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-lg hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
