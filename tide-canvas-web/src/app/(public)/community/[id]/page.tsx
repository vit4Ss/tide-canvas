"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import {
  ArrowLeft, Eye, Heart, MessageCircle, Send, Loader2, Reply, Pencil, Trash2, Hash,
} from "lucide-react";
import Link from "next/link";
import { communityApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Markdown } from "@/components/shared/markdown";
import type { PostDetailVO, CommentVO } from "@/types/community";

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const postId = params.id as string;

  const [post, setPost] = useState<PostDetailVO | null>(null);
  const [comments, setComments] = useState<CommentVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Comment form
  const [commentContent, setCommentContent] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; nickname: string } | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [postRes, commentsRes] = await Promise.all([
        communityApi.get(postId),
        communityApi.listComments(postId),
      ]);
      if (postRes.success) {
        setPost(postRes.data);
        setLiked(postRes.data.liked);
        setLikeCount(postRes.data.likeCount);
      } else {
        setError(postRes.message || "帖子加载失败");
      }
      if (commentsRes.success) {
        setComments(commentsRes.data);
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (postId) fetchPost();
  }, [postId, fetchPost]);

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await communityApi.like(postId);
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

  const handleDelete = async () => {
    if (deleting) return;
    if (!confirm("确定要删除这篇帖子吗？此操作不可恢复。")) return;
    setDeleting(true);
    try {
      const res = await communityApi.delete(postId);
      if (res.success) {
        router.push("/community");
        return;
      }
      alert(res.message || "删除失败");
      setDeleting(false);
    } catch {
      alert("网络错误，请稍后重试");
      setDeleting(false);
    }
  };

  const handleAddComment = async () => {
    if (!commentContent.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await communityApi.addComment(postId, {
        content: commentContent.trim(),
        parentId: replyTo?.id,
      });
      if (res.success) {
        setCommentContent("");
        setReplyTo(null);
        // Re-fetch comments
        const commentsRes = await communityApi.listComments(postId);
        if (commentsRes.success) setComments(commentsRes.data);
      }
    } catch {
      // ignore
    } finally {
      setSubmittingComment(false);
    }
  };

  // Recursive comment renderer
  const renderComment = (comment: CommentVO, depth = 0) => (
    <div
      key={comment.id}
      className={`${depth > 0 ? "ml-8 border-l-2 border-neutral-100 pl-4 dark:border-neutral-800" : ""}`}
    >
      <div className="flex gap-3 py-4">
        <Avatar size="sm">
          {comment.avatar && <AvatarImage src={comment.avatar} />}
          <AvatarFallback>{comment.nickname?.[0] || "U"}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{comment.nickname}</span>
            <span className="text-xs text-neutral-400">{formatDate(comment.createTime)}</span>
          </div>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            {comment.content}
          </p>
          <button
            onClick={() => setReplyTo({ id: comment.id, nickname: comment.nickname })}
            className="mt-1 flex items-center gap-1 text-xs text-neutral-400 hover:text-blue-500"
          >
            <Reply className="h-3 w-3" />
            回复
          </button>
        </div>
      </div>
      {comment.replies?.map((reply) => renderComment(reply, depth + 1))}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="animate-pulse space-y-4">
              <div className="h-7 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-3 w-28 rounded bg-neutral-200 dark:bg-neutral-800" />
              </div>
              <div className="space-y-2 pt-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-4 w-full rounded bg-neutral-100 dark:bg-neutral-800/60" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 帖子不存在 / 加载失败 → 404
  if (error || !post) {
    notFound();
  }

  const isOwner = !!user && user.id === post.userId;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {/* Top bar: back + owner actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          {isOwner && (
            <div className="flex items-center gap-2">
              <Link href={`/community/${postId}/edit`}>
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

        {/* Article card */}
        <article className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-7 dark:border-neutral-800 dark:bg-neutral-900">
          {/* Title */}
          <h1 className="text-2xl font-bold leading-snug text-neutral-900 dark:text-neutral-100">
            {post.title}
          </h1>

          {/* Author row */}
          <div className="mt-4 flex items-center gap-3">
            <Avatar>
              {post.avatar && <AvatarImage src={post.avatar} />}
              <AvatarFallback>{post.nickname?.[0] || "U"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{post.nickname}</p>
              <p className="text-xs text-neutral-400">{formatDate(post.createTime)}</p>
            </div>
            {post.category && (
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Hash className="h-3 w-3" />
                {post.category}
              </span>
            )}
          </div>

          {/* Content */}
          <Markdown content={post.content} className="mt-5" />

          {/* Footer: stats + like */}
          <div className="mt-6 flex items-center justify-between border-t border-neutral-100 pt-4 dark:border-neutral-800">
            <div className="flex items-center gap-4 text-sm text-neutral-400">
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" />
                {post.viewCount}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="h-4 w-4" />
                {post.commentCount}
              </span>
            </div>
            <Button
              variant={liked ? "default" : "outline"}
              onClick={handleLike}
              disabled={liking}
            >
              {liking ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Heart className={`mr-1 h-4 w-4 ${liked ? "fill-current" : ""}`} />
              )}
              {liked ? "已赞" : "点赞"} {likeCount}
            </Button>
          </div>
        </article>

        {/* Comments card */}
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold">评论 ({comments.length})</h2>

          {/* Add Comment */}
          <div className="mt-4">
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 text-sm text-blue-600">
                <span>回复 @{replyTo.nickname}</span>
                <button
                  onClick={() => setReplyTo(null)}
                  className="text-neutral-400 hover:text-neutral-600"
                >
                  取消
                </button>
              </div>
            )}
            <Textarea
              placeholder={user ? "写下你的评论..." : "请登录后评论"}
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              rows={3}
              disabled={!user}
            />
            <div className="mt-2 flex justify-end">
              <Button
                onClick={handleAddComment}
                disabled={!commentContent.trim() || submittingComment || !user}
              >
                {submittingComment ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                发表评论
              </Button>
            </div>
          </div>

          {/* Comments List */}
          {comments.length === 0 ? (
            <div className="mt-8 text-center text-neutral-400">
              <MessageCircle className="mx-auto h-8 w-8" />
              <p className="mt-2">暂无评论，来说两句吧</p>
            </div>
          ) : (
            <div className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
              {comments.map((comment) => renderComment(comment))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
