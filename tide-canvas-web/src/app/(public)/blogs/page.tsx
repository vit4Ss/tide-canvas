"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Search, Eye, Heart, Lock, Unlock, BookOpen, PenLine,
} from "lucide-react";
import { blogApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { BlogVO } from "@/types/blog";

const PRICE_TABS = ["全部", "免费", "付费"];
const PAGE_SIZE = 12;

export default function BlogsPage() {
  const { user } = useAuth();
  const [blogs, setBlogs] = useState<BlogVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [priceTab, setPriceTab] = useState("全部");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchBlogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await blogApi.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        free: priceTab === "免费" ? true : priceTab === "付费" ? false : undefined,
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
  }, [pageNum, keyword, priceTab]);

  useEffect(() => {
    fetchBlogs();
  }, [fetchBlogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => {
    setKeyword(searchInput);
    setPageNum(1);
  };

  const handlePriceTabChange = (tab: string) => {
    setPriceTab(tab);
    setPageNum(1);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">博客</h1>
          <p className="mt-1 text-sm text-neutral-500">优质原创内容，助力学习与成长</p>
        </div>
        {user?.isAuthor === 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/user/blogs">
              <Button variant="outline">
                <BookOpen className="mr-1 h-4 w-4" />
                我的博客
              </Button>
            </Link>
            <Link href="/user/blogs/new">
              <Button>
                <PenLine className="mr-1 h-4 w-4" />
                写博客
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-2">
          <Input
            placeholder="搜索博客..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="max-w-sm"
          />
          <Button variant="outline" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          {PRICE_TABS.map((tab) => (
            <Button
              key={tab}
              variant={priceTab === tab ? "default" : "ghost"}
              size="sm"
              onClick={() => handlePriceTabChange(tab)}
            >
              {tab}
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

      {/* Blog Grid */}
      {loading ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
            >
              <div className="h-40 rounded-t-xl bg-neutral-200 dark:bg-neutral-800" />
              <div className="p-4 space-y-3">
                <div className="h-5 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-4 w-full rounded bg-neutral-100 dark:bg-neutral-900" />
                <div className="h-4 w-2/3 rounded bg-neutral-100 dark:bg-neutral-900" />
              </div>
            </div>
          ))}
        </div>
      ) : blogs.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center text-neutral-400">
          <BookOpen className="h-12 w-12" />
          <p className="mt-3 text-lg">暂无博客</p>
          <p className="mt-1 text-sm">精彩内容即将呈现</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {blogs.map((blog) => (
            <Link
              key={blog.id}
              href={`/blogs/${blog.id}`}
              className="group overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950"
            >
              {/* Cover Image */}
              <div className="relative h-40 bg-neutral-100 dark:bg-neutral-900">
                {blog.coverImage ? (
                  <img
                    src={blog.coverImage}
                    alt={blog.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <BookOpen className="h-10 w-10 text-neutral-300 dark:text-neutral-700" />
                  </div>
                )}
                {/* Price Badge */}
                <div className="absolute top-2 right-2">
                  {blog.pointsRequired > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">
                      <Lock className="h-3 w-3" />
                      {blog.pointsRequired} 积分
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-xs font-medium text-white">
                      <Unlock className="h-3 w-3" />
                      免费
                    </span>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                {blog.category && (
                  <span className="inline-block rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-950 dark:text-purple-400">
                    {blog.category}
                  </span>
                )}
                <h3 className="mt-2 line-clamp-2 font-semibold text-neutral-900 group-hover:text-blue-600 dark:text-neutral-100 dark:group-hover:text-blue-400">
                  {blog.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                  {blog.summary}
                </p>

                {/* Author */}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      {blog.authorAvatar && <AvatarImage src={blog.authorAvatar} />}
                      <AvatarFallback>{blog.authorName?.[0] || "A"}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-neutral-500">{blog.authorName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-400">
                    <span className="flex items-center gap-0.5">
                      <Eye className="h-3 w-3" />
                      {blog.viewCount}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Heart className="h-3 w-3" />
                      {blog.likeCount}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
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
