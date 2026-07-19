"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { FollowButton } from "@/components/user/follow-button";
import type { FollowUserVO } from "@/types/follow";
import type { PageData, Result } from "@/types/api";

const PAGE_SIZE = 20;

interface FollowListProps {
  /** 列表数据源：following=我关注的人，followers=关注我的人 */
  fetcher: (query: { pageNum: number; pageSize: number }) => Promise<Result<PageData<FollowUserVO>>>;
  title: string;
  /** 空列表文案 */
  emptyText: string;
}

/** 关注/粉丝列表通用渲染：分页 + 用户摘要 + 行内关注按钮。 */
export function FollowList({ fetcher, title, emptyText }: FollowListProps) {
  const [users, setUsers] = useState<FollowUserVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetcher({ pageNum, pageSize: PAGE_SIZE });
      if (res.success) {
        setUsers(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [fetcher, pageNum]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/user"
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {!loading && <p className="mt-0.5 text-xs text-neutral-400">共 {total} 人</p>}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
            >
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-800/50" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
              </div>
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-neutral-400">
          <Users className="h-12 w-12" />
          <p className="mt-3 text-lg">{emptyText}</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
            >
              <Avatar size="lg">
                {u.avatar && <AvatarImage src={u.avatar} />}
                <AvatarFallback>{u.nickname?.[0] || u.username?.[0] || "U"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {u.nickname || u.username}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {u.followedBy && u.following ? "互相关注" : u.followedBy ? "关注了你" : `关注于 ${formatDate(u.followTime)}`}
                </p>
              </div>
              {/* 列表已知初始状态，直接透传，省去逐行请求 */}
              <FollowButton
                targetUserId={u.id}
                initialStatus={{ following: u.following, followedBy: u.followedBy }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm">
          <button
            disabled={pageNum <= 1}
            onClick={() => setPageNum((p) => p - 1)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            上一页
          </button>
          <span className="text-neutral-500">
            {pageNum} / {totalPages}
          </span>
          <button
            disabled={pageNum >= totalPages}
            onClick={() => setPageNum((p) => p + 1)}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
