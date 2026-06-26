"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Search, MessageCircle, Plus, Hash, ChevronRight,
  FolderOpen, BookOpen, Compass, Layers, MoreHorizontal, Pencil, Trash2, FileText,
} from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { communityApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PostVO } from "@/types/community";

const CATEGORIES = ["全部", "问答", "分享", "教程"];
const PAGE_SIZE = 12;

const QUICK_LINKS = [
  { href: "/canvas/new", label: "开始创作", icon: Layers },
  { href: "/user/projects", label: "我的项目", icon: FolderOpen },
  { href: "/blogs", label: "博客", icon: BookOpen },
  { href: "/explore", label: "发现", icon: Compass },
];

export default function CommunityPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState("全部");
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await communityApi.list({
        pageNum,
        pageSize: PAGE_SIZE,
        keyword: keyword || undefined,
        category: category === "全部" ? undefined : category,
      });
      if (res.success) {
        setPosts(res.data.records);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId !== null) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpenId]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = () => {
    setKeyword(searchInput);
    setPageNum(1);
  };

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    setPageNum(1);
  };

  const handleDelete = async (id: number) => {
    setMenuOpenId(null);
    if (!confirm("确定要删除这篇帖子吗？")) return;
    const res = await communityApi.delete(id);
    if (res.success) {
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      alert(res.message || "删除失败");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[200px_minmax(0,1fr)_280px]">
        {/* ===== Left rail ===== */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            <nav className="rounded-xl border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryChange(cat)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    category === cat
                      ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  <Hash className="h-4 w-4 opacity-70" />
                  {cat === "全部" ? "全部内容" : cat}
                </button>
              ))}
            </nav>
            <Link href="/community/new" className="block">
              <Button className="w-full" size="lg">
                <Plus className="mr-1 h-4 w-4" />
                发布帖子
              </Button>
            </Link>
          </div>
        </aside>

        {/* ===== Center feed ===== */}
        <main className="min-w-0">
          {/* Search bar */}
          <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center gap-2">
              <Input
                placeholder="搜索帖子..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSearch}>
                <Search className="h-4 w-4" />
              </Button>
              <Link href="/community/new" className="lg:hidden">
                <Button>
                  <Plus className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            {/* Mobile category pills */}
            <div className="mt-3 flex flex-wrap gap-1 lg:hidden">
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
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Feed panel */}
          {loading ? (
            <div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-4 sm:gap-4 sm:p-5">
                  <div className="h-20 w-28 shrink-0 animate-pulse rounded-lg bg-neutral-200 sm:h-28 sm:w-44 dark:bg-neutral-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
                    <div className="h-4 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900">
              <MessageCircle className="h-12 w-12" />
              <p className="mt-3 text-lg">暂无帖子</p>
              <p className="mt-1 text-sm">快来发表第一篇帖子吧</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
              {posts.map((post) => {
                const thumb = post.contentImages?.[0];
                const isOwner = !!user && user.id === post.userId;
                return (
                  <div key={post.id} className="group relative">
                    <Link
                      href={`/community/${post.id}`}
                      className="flex gap-3 p-4 transition-colors hover:bg-neutral-50 sm:gap-4 sm:p-5 dark:hover:bg-neutral-800/40"
                    >
                      {/* Thumbnail */}
                      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg sm:h-28 sm:w-44">
                        {thumb ? (
                          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-300 dark:from-neutral-800 dark:to-neutral-800/40 dark:text-neutral-600">
                            <FileText className="h-7 w-7" />
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <h2 className="line-clamp-1 pr-6 font-semibold text-neutral-900 group-hover:text-blue-600 dark:text-neutral-100 dark:group-hover:text-blue-400">
                          {post.title}
                        </h2>
                        {post.contentPreview && (
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-neutral-500">
                            {post.contentPreview}
                          </p>
                        )}
                        {/* Meta */}
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2 text-xs text-neutral-400">
                          <div className="flex items-center gap-3">
                            <span>作者：{post.nickname}</span>
                            <span className="flex items-center gap-1">
                              <MessageCircle className="h-3.5 w-3.5" />
                              {post.commentCount}
                            </span>
                            {post.category && (
                              <span className="hidden items-center gap-1 sm:inline-flex">
                                <Hash className="h-3 w-3" />
                                {post.category}
                              </span>
                            )}
                          </div>
                          <span>
                            已有 <span className="text-blue-500">{post.viewCount}</span> 人阅读 ·{" "}
                            {formatDate(post.createTime)}
                          </span>
                        </div>
                      </div>
                    </Link>

                    {/* Owner menu */}
                    {isOwner && (
                      <div
                        className="absolute right-3 top-3 sm:right-4 sm:top-4"
                        ref={menuOpenId === post.id ? menuRef : null}
                      >
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === post.id ? null : post.id);
                          }}
                          className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700"
                          aria-label="更多操作"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {menuOpenId === post.id && (
                          <div className="absolute right-0 top-8 z-20 w-28 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                            <Link
                              href={`/community/${post.id}/edit`}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                            >
                              <Pencil className="h-3.5 w-3.5" /> 编辑
                            </Link>
                            <button
                              onClick={() => handleDelete(post.id)}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> 删除
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
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
        </main>

        {/* ===== Right rail ===== */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {/* Quick links */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h3 className="mb-2 px-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                快捷入口
              </h3>
              <div className="space-y-0.5">
                {QUICK_LINKS.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      <q.icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm text-neutral-700 dark:text-neutral-200">{q.label}</span>
                    <ChevronRight className="h-4 w-4 text-neutral-300 dark:text-neutral-600" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Promo */}
            <div className="rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 p-5 text-center dark:border-cyan-900 dark:from-cyan-950/40 dark:to-blue-950/40">
              <BrandMark className="mx-auto h-10 w-10" />
              <p className="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">TideCanvas</p>
              <p className="mt-1 text-xs text-neutral-500">AI 无限画布 · 把灵感连成网络</p>
              <Link href="/canvas/new" className="mt-3 block">
                <Button size="sm" className="w-full">
                  开始创作
                </Button>
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
