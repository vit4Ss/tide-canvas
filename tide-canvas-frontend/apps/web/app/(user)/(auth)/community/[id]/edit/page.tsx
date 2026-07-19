"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { communityApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PostForm, type PostFormValues } from "@/components/community/post-form";
import type { PostDetailVO } from "@/types/community";

export default function EditPostPage() {
  const params = useParams();
  const { user } = useAuth();
  const postId = params.id as string;

  const [post, setPost] = useState<PostDetailVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!postId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await communityApi.get(postId);
        if (!active) return;
        if (res.success) {
          setPost(res.data);
        } else {
          setError(res.message || "加载失败");
        }
      } catch {
        if (active) setError("网络错误，请稍后重试");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [postId]);

  const initialValues: PostFormValues | null = useMemo(() => {
    if (!post) return null;
    return {
      title: post.title ?? "",
      content: post.content ?? "",
      category: post.category ?? "",
    };
  }, [post]);

  const denied = !!(user && post && post.userId !== user.id);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-neutral-400" />
      </div>
    );
  }

  // 不存在 / 无权编辑 → 统一 404
  if (error || !post || !initialValues || denied) {
    notFound();
  }

  return <PostForm mode="edit" postId={postId} initialValues={initialValues} />;
}
