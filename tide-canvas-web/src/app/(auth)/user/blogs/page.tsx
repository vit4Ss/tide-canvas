"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, PenLine, Eye, Heart, Lock, Pencil, Trash2, BookOpen, Loader2, Search,
} from "lucide-react";
import { blogApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BlogVO } from "@/types/blog";

const PAGE_SIZE = 10;
const CATEGORIES = ["全部", "技术", "设计", "产品", "教程", "经验"];

export default function MyBlogsPage() {
  const { user } = useAuth();
  const isAuthor = user?.isAuthor === 1;

  const [blogs, setBlogs] = useState<BlogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchBlogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await blogApi.my({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        category: category === "全部" ? undefined : category,
      });
      if (res.success) {
        setBlogs(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [pageNum, keyword, category]);

  useEffect(() => {
    fetchBlogs();
  }, [fetchBlogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilter = keyword !== "" || category !== "全部";

  const handleSearch = () => {
    setKeyword(searchInput.trim());
    setPageNum(1);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setPageNum(1);
  };

  const handleDelete = async (id: number) => {
    if (deletingId !== null) return;
    if (!confirm("确定要删除这篇博客吗？此操作不可恢复。")) return;
    setDeletingId(id);
    try {
      const res = await blogApi.delete(id);
      if (res.success) {
        setBlogs((prev) => prev.filter((b) => b.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        alert(res.message || "删除失败");
      }
    } catch {
      alert("网络错误，请稍后重试");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/user"
            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">我的博客</h1>
            {!loading && <p className="mt-0.5 text-xs text-neutral-400">共 {total} 篇</p>}
          </div>
        </div>
        {isAuthor && (
          <Link href="/user/blogs/new">
            <Button>
              <PenLine className="mr-1 h-4 w-4" />
              写博客
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-2">
          <Input
            placeholder="搜索我的博客标题或摘要..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="max-w-sm"
          />
          <Button variant="outline" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={category === cat ? "default" : "ghost"}
              size="sm"
              onClick={() => handleCategoryChange(cat)}
            >
              {cat}
            </Button>
          ))}
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
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
            >
              <div className="hidden h-20 w-28 shrink-0 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800/50 sm:block" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/50" />
              </div>
            </div>
          ))}
        </div>
      ) : blogs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-neutral-400">
          <BookOpen className="h-12 w-12" />
          {hasFilter ? (
            <>
              <p className="mt-3 text-lg">没有符合条件的博客</p>
              <p className="mt-1 text-sm">换个关键词或分类试试</p>
            </>
          ) : (
            <>
              <p className="mt-3 text-lg">还没有发布博客</p>
              <p className="mt-1 text-sm">
                {isAuthor ? "点击右上角「写博客」发布第一篇" : "成为签约作者后即可发布博客"}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {blogs.map((blog) => (
            <div
              key={blog.id}
              className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center dark:border-neutral-800 dark:bg-neutral-950"
            >
              {/* Cover */}
              <Link
                href={`/blogs/${blog.id}`}
                className="hidden h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900 sm:block"
              >
                {blog.coverImage ? (
                  <img src={blog.coverImage} alt={blog.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-300 dark:text-neutral-700">
                    <BookOpen className="h-7 w-7" />
                  </div>
                )}
              </Link>

              {/* Main */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/blogs/${blog.id}`} className="min-w-0">
                    <h3 className="truncate font-semibold text-neutral-900 hover:text-blue-600 dark:text-neutral-100 dark:hover:text-blue-400">
                      {blog.title}
                    </h3>
                  </Link>
                  {blog.pointsRequired > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                      <Lock className="h-3 w-3" />
                      {blog.pointsRequired} 积分
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600 dark:bg-green-950 dark:text-green-400">
                      免费
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-neutral-500">
                  {blog.summary || "暂无摘要"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                  {blog.category && (
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 font-medium text-purple-600 dark:bg-purple-950 dark:text-purple-400">
                      {blog.category}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Eye className="h-3 w-3" />
                    {blog.viewCount}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Heart className="h-3 w-3" />
                    {blog.likeCount}
                  </span>
                  <span>{formatDate(blog.createTime)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link href={`/blogs/${blog.id}`}>
                  <Button variant="outline" size="sm">
                    <Eye className="mr-1 h-4 w-4" />
                    查看
                  </Button>
                </Link>
                <Link href={`/user/blogs/${blog.id}/edit`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="mr-1 h-4 w-4" />
                    编辑
                  </Button>
                </Link>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(blog.id)}
                  disabled={deletingId === blog.id}
                >
                  {deletingId === blog.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pageNum <= 1}
            onClick={() => setPageNum((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-neutral-500">
            {pageNum} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pageNum >= totalPages}
            onClick={() => setPageNum((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
