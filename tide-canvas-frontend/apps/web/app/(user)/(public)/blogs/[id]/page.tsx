"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import {
  ArrowLeft, Eye, Heart, Lock, Loader2, Gift, Coins, Pencil, Trash2,
} from "lucide-react";
import Link from "next/link";
import { blogApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { FollowButton } from "@/components/user/follow-button";
import type { BlogDetailVO } from "@/types/blog";

export default function BlogDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const blogId = params.id as string;

  const [blog, setBlog] = useState<BlogDetailVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Tip dialog
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState("");
  const [tipping, setTipping] = useState(false);

  const fetchBlog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await blogApi.get(blogId);
      if (res.success) {
        setBlog(res.data);
        setLiked(res.data.liked);
        setLikeCount(res.data.likeCount);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [blogId]);

  useEffect(() => {
    if (blogId) fetchBlog();
  }, [blogId, fetchBlog]);

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await blogApi.like(blogId);
      if (res.success) {
        const nowLiked = res.data;
        setLiked(nowLiked);
        setLikeCount((c) => (nowLiked ? c + 1 : c - 1));
      }
    } catch {
      // ignore
    } finally {
      setLiking(false);
    }
  };

  const handlePurchase = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const res = await blogApi.purchase(blogId);
      if (res.success) {
        await fetchBlog();
      } else {
        setError(res.message || "解锁失败，积分可能不足");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setPurchasing(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!confirm("确定要删除这篇博客吗？此操作不可恢复。")) return;
    setDeleting(true);
    setError("");
    try {
      const res = await blogApi.delete(blogId);
      if (res.success) {
        router.push("/blogs");
        return;
      }
      setError(res.message || "删除失败");
      setDeleting(false);
    } catch {
      setError("网络错误，请稍后重试");
      setDeleting(false);
    }
  };

  const handleTip = async () => {
    const amount = Number(tipAmount);
    if (!amount || amount <= 0 || tipping) return;
    setTipping(true);
    try {
      const res = await blogApi.tip(blogId, { amount });
      if (res.success) {
        setTipOpen(false);
        setTipAmount("");
        await fetchBlog();
      } else {
        setError(res.message || "打赏失败");
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setTipping(false);
    }
  };

  const isPremium = blog && blog.pointsRequired > 0;
  const isLocked = isPremium && !blog.purchased && blog.content === null;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-56 w-full rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-8 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 w-full rounded bg-neutral-100 dark:bg-neutral-900" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 博客不存在 / 加载失败 → 404
  if (error && !blog) {
    notFound();
  }

  if (!blog) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Back + Owner Actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回博客
        </Button>
        {user?.id === blog.authorId && (
          <div className="flex items-center gap-2">
            <Link href={`/user/blogs/${blogId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-4 w-4" />
                编辑
              </Button>
            </Link>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              删除
            </Button>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Cover Image */}
      {blog.coverImage && (
        <div className="mt-4 overflow-hidden rounded-xl">
          <img src={blog.coverImage} alt={blog.title} className="w-full object-cover" />
        </div>
      )}

      <article className="mt-6">
        {/* Category + Price */}
        <div className="flex items-center gap-2">
          {blog.category && (
            <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-950 dark:text-purple-400">
              {blog.category}
            </span>
          )}
          {isPremium ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <Lock className="h-3 w-3" />
              {blog.pointsRequired} 积分
            </span>
          ) : (
            <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:bg-green-950 dark:text-green-400">
              免费
            </span>
          )}
        </div>

        <h1 className="mt-3 text-2xl font-bold">{blog.title}</h1>

        {/* Author Info */}
        <div className="mt-4 flex items-center gap-3">
          <Avatar>
            {blog.authorAvatar && <AvatarImage src={blog.authorAvatar} />}
            <AvatarFallback>{blog.authorName?.[0] || "A"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="text-sm font-medium">{blog.authorName}</p>
            <p className="text-xs text-neutral-400">{formatDate(blog.createTime)}</p>
          </div>
          {/* authorId 运行时为作者 public_id；按钮内部已处理「未登录/自己不显示」 */}
          <FollowButton targetUserId={String(blog.authorId)} />
        </div>

        {/* Stats */}
        <div className="mt-4 flex items-center gap-4 text-sm text-neutral-500">
          <span className="flex items-center gap-1">
            <Eye className="h-4 w-4" />
            {blog.viewCount} 阅读
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-4 w-4" />
            {likeCount} 赞
          </span>
          {blog.tipTotal > 0 && (
            <span className="flex items-center gap-1">
              <Gift className="h-4 w-4" />
              {blog.tipTotal} 打赏
            </span>
          )}
        </div>

        {/* Summary */}
        {blog.summary && (
          <div className="mt-6 rounded-lg border-l-4 border-blue-400 bg-blue-50 p-4 text-sm text-neutral-700 dark:bg-blue-950/30 dark:text-neutral-300">
            {blog.summary}
          </div>
        )}

        {/* Content or Locked */}
        {isLocked ? (
          <div className="relative mt-6">
            {/* Blurred placeholder */}
            <div className="select-none blur-sm">
              <p className="text-neutral-600 leading-relaxed dark:text-neutral-300">
                这里是付费内容的预览区域。解锁后即可阅读全文。本文包含丰富的技术细节和实战经验分享，
                帮助你快速掌握核心知识要点。作者精心整理了多个实际案例，配合详细的步骤说明，
                让你能够轻松上手实践。无论你是初学者还是有经验的开发者，都能从中获益。
              </p>
            </div>
            {/* Overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/80 dark:bg-neutral-950/80">
              <Lock className="h-10 w-10 text-amber-500" />
              <p className="mt-3 text-lg font-semibold">付费内容</p>
              <p className="mt-1 text-sm text-neutral-500">
                需要 {blog.pointsRequired} 积分解锁全文
              </p>
              <Button className="mt-4" onClick={handlePurchase} disabled={purchasing}>
                {purchasing ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Coins className="mr-1 h-4 w-4" />
                )}
                解锁全文 ({blog.pointsRequired} 积分)
              </Button>
            </div>
          </div>
        ) : (
          <Markdown content={blog.content ?? ""} className="mt-6" />
        )}

        {/* Actions: Like + Tip */}
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button
            variant={liked ? "default" : "outline"}
            size="lg"
            onClick={handleLike}
            disabled={liking}
          >
            {liking ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Heart className={`mr-1 h-4 w-4 ${liked ? "fill-current" : ""}`} />
            )}
            {liked ? "已赞" : "点赞"} ({likeCount})
          </Button>
          {user && (
            <Button variant="outline" size="lg" onClick={() => setTipOpen(true)}>
              <Gift className="mr-1 h-4 w-4" />
              打赏作者
            </Button>
          )}
        </div>
      </article>

      {/* Author Card */}
      <div className="mt-10 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-4">
          <Avatar size="lg">
            {blog.authorAvatar && <AvatarImage src={blog.authorAvatar} />}
            <AvatarFallback>{blog.authorName?.[0] || "A"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h3 className="font-semibold">{blog.authorName}</h3>
            <p className="text-sm text-neutral-500">博客作者</p>
          </div>
          <FollowButton targetUserId={String(blog.authorId)} size="default" />
          {user && (
            <Button variant="outline" onClick={() => setTipOpen(true)}>
              <Gift className="mr-1 h-4 w-4" />
              打赏
            </Button>
          )}
        </div>
      </div>

      {/* Tip Dialog */}
      <Dialog open={tipOpen} onOpenChange={setTipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>打赏作者</DialogTitle>
            <DialogDescription>输入打赏积分数量，感谢作者的优质内容</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              {[10, 50, 100].map((amount) => (
                <Button
                  key={amount}
                  variant={tipAmount === String(amount) ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTipAmount(String(amount))}
                >
                  {amount} 积分
                </Button>
              ))}
            </div>
            <Input
              type="number"
              placeholder="自定义积分数量"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              min={1}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTipOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleTip}
              disabled={!tipAmount || Number(tipAmount) <= 0 || tipping}
            >
              {tipping && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              确认打赏
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
