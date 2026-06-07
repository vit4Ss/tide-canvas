"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import type { LogVO, LogQuery } from "@/types/admin";
import type { PageData } from "@/types/api";
import {
  Filter,
  ScrollText,
  Calendar,
  Info,
} from "lucide-react";
import {
  PageHeader,
  SearchBar,
  Pagination,
  TableSkeleton,
  EmptyState,
} from "@/components/shared";

const ACTION_OPTIONS = [
  { value: "", label: "全部操作" },
  { value: "LOGIN", label: "登录" },
  { value: "LOGOUT", label: "登出" },
  { value: "CREATE", label: "创建" },
  { value: "UPDATE", label: "更新" },
  { value: "DELETE", label: "删除" },
  { value: "UPLOAD", label: "上传" },
  { value: "DOWNLOAD", label: "下载" },
  { value: "AI_GENERATE", label: "AI生成" },
  { value: "AUDIT", label: "审核" },
  { value: "EXPORT", label: "导出" },
];

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pageSize = 20;

  const loadLogs = async (
    page = pageNum,
    search = keyword,
    action = actionFilter,
    start = startTime,
    end = endTime
  ) => {
    setLoading(true);
    setError("");
    try {
      const query: LogQuery = {
        pageNum: page,
        pageSize,
        keyword: search || undefined,
        action: action || undefined,
        startTime: start || undefined,
        endTime: end || undefined,
      };
      const res = await adminApi.logs.list(query);
      if (res.success && res.data) {
        const data = res.data as unknown as PageData<LogVO>;
        setLogs(data.records);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载日志列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
  }, []);

  const handleSearch = () => {
    setPageNum(1);
    loadLogs(1, keyword, actionFilter, startTime, endTime);
  };

  const handleActionFilter = (action: string) => {
    setActionFilter(action);
    setPageNum(1);
    loadLogs(1, keyword, action, startTime, endTime);
  };

  const handlePageChange = (newPage: number) => {
    setPageNum(newPage);
    loadLogs(newPage);
  };

  const truncateDetail = (detail: string, maxLen = 60) => {
    if (!detail) return "-";
    return detail.length > maxLen ? detail.slice(0, maxLen) + "..." : detail;
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}
      <PageHeader title="系统日志" description={`共 ${total} 条记录`} />

      {/* 搜索和筛选 */}
      <div className="flex flex-wrap gap-3">
        <SearchBar
          value={keyword}
          onChange={setKeyword}
          onSearch={handleSearch}
          placeholder="搜索操作详情..."
          className="max-w-sm flex-1"
        />
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <select
            value={actionFilter}
            onChange={(e) => handleActionFilter(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-8 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="date"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="开始日期"
            />
          </div>
          <span className="text-neutral-400">-</span>
          <input
            type="date"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="结束日期"
          />
        </div>
        <button
          onClick={handleSearch}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          搜索
        </button>
      </div>

      {/* 日志表格 */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">操作</th>
                <th className="px-4 py-3 font-medium">目标</th>
                <th className="px-4 py-3 font-medium">详情</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={8} columns={6} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-0 py-0">
                    <EmptyState icon={ScrollText} title="暂无日志记录" />
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/50 dark:border-neutral-900 dark:hover:bg-neutral-900/30"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium">{log.username || "-"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500 max-w-[150px] truncate">
                      {log.target || "-"}
                    </td>
                    <td className="px-4 py-3 max-w-[250px]">
                      {log.detail ? (
                        <div>
                          <button
                            onClick={() =>
                              setExpandedId(expandedId === log.id ? null : log.id)
                            }
                            className="inline-flex items-center gap-1 text-left text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                          >
                            <span
                              className={
                                expandedId === log.id ? "" : "truncate max-w-[200px] inline-block"
                              }
                            >
                              {expandedId === log.id ? log.detail : truncateDetail(log.detail)}
                            </span>
                            {log.detail.length > 60 && (
                              <Info className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-neutral-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-400">{log.ip || "-"}</td>
                    <td className="px-4 py-3 text-xs text-neutral-400 whitespace-nowrap">
                      {log.createTime
                        ? new Date(log.createTime).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination pageNum={pageNum} pageSize={pageSize} total={total} onChange={handlePageChange} />
      </div>
    </div>
  );
}
