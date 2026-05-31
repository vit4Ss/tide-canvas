"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { ContentVO, ContentQuery } from "@/types/admin";
import type { PageData } from "@/types/api";
import {
  CheckCircle,
  XCircle,
  FileImage,
  Filter,
} from "lucide-react";
import {
  PageHeader,
  SearchBar,
  Pagination,
  StatusBadge,
  TableSkeleton,
  EmptyState,
} from "@/components/shared";

const STATUS_VARIANTS: Record<number, { label: string; variant: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  0: { label: "草稿", variant: "neutral" },
  1: { label: "已发布", variant: "success" },
  2: { label: "已下架", variant: "danger" },
};

export default function AdminContentsPage() {
  const [contents, setContents] = useState<ContentVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pageSize = 15;

  const loadContents = async (page = pageNum, search = keyword, status = statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const query: ContentQuery = {
        pageNum: page,
        pageSize,
        keyword: search || undefined,
        status,
      };
      const res = await adminApi.contents.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<ContentVO>;
        setContents(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载内容列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContents(1);
  }, []);

  const handleSearch = () => {
    setPageNum(1);
    loadContents(1, keyword, statusFilter);
  };

  const handleStatusFilter = (status: number | undefined) => {
    setStatusFilter(status);
    setPageNum(1);
    loadContents(1, keyword, status);
  };

  const handlePageChange = (newPage: number) => {
    setPageNum(newPage);
    loadContents(newPage);
  };

  const handleAudit = async (id: number, status: number) => {
    setAuditing(id);
    try {
      const res = await adminApi.contents.audit(id, { status });
      if (res.success) {
        loadContents();
      }
    } finally {
      setAuditing(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
      <PageHeader title="作品审核" description={`共 ${total} 个作品`} />

      {/* 搜索和筛选 */}
      <div className="flex flex-wrap gap-3">
        <SearchBar
          value={keyword}
          onChange={setKeyword}
          onSearch={handleSearch}
          placeholder="搜索作品名称..."
        />
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <select
            value={statusFilter ?? ""}
            onChange={(e) => handleStatusFilter(e.target.value === "" ? undefined : Number(e.target.value))}
            className="rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-8 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">全部状态</option>
            <option value={0}>草稿</option>
            <option value={1}>已发布</option>
            <option value={2}>已下架</option>
          </select>
        </div>
        <button
          onClick={handleSearch}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          搜索
        </button>
      </div>

      {/* 内容表格 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">缩略图</th>
                <th className="px-4 py-3 font-medium">作品名称</th>
                <th className="px-4 py-3 font-medium">创建者</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={5} columns={7} />
              ) : contents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-0 py-0">
                    <EmptyState icon={FileImage} title="暂无作品数据" />
                  </td>
                </tr>
              ) : (
                contents.map((item) => {
                  const status = STATUS_VARIANTS[item.status] ?? STATUS_VARIANTS[0];
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                        {String(item.id).slice(-6)}
                      </td>
                      <td className="px-4 py-3">
                        {item.thumbnail ? (
                          <button onClick={() => setPreviewUrl(item.thumbnail)} className="block">
                            <img
                              src={item.thumbnail}
                              alt={item.name}
                              className="h-10 w-16 rounded object-cover border border-neutral-200 dark:border-neutral-700 hover:opacity-80 transition-opacity"
                            />
                          </button>
                        ) : (
                          <div className="flex h-10 w-16 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800">
                            <FileImage className="h-4 w-4 text-neutral-400" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium max-w-[200px] truncate">{item.name}</td>
                      <td className="px-4 py-3 text-neutral-500">{item.ownerName}</td>
                      <td className="px-4 py-3">
                        <StatusBadge label={status.label} variant={status.variant} />
                      </td>
                      <td className="px-4 py-3 text-xs text-neutral-400">
                        {item.createTime ? new Date(item.createTime).toLocaleDateString("zh-CN") : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {item.status !== 1 && (
                            <button
                              onClick={() => handleAudit(item.id, 1)}
                              disabled={auditing === item.id}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-950/30"
                              title="通过审核"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              通过
                            </button>
                          )}
                          {item.status !== 2 && (
                            <button
                              onClick={() => handleAudit(item.id, 2)}
                              disabled={auditing === item.id}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
                              title="下架作品"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              下架
                            </button>
                          )}
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

      {/* 图片预览弹窗 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-h-[80vh] max-w-[80vw]" onClick={(e) => e.stopPropagation()}>
            <img src={previewUrl} alt="预览" className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain" />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-lg hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
