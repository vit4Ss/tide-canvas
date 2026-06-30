"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { blogApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { BlogForm, type BlogFormValues } from "@/components/blog/blog-form";
import type { BlogDetailVO } from "@/types/blog";

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export default function EditBlogPage() {
  const params = useParams();
  const { user } = useAuth();
  const blogId = params.id as string;

  const [blog, setBlog] = useState<BlogDetailVO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!blogId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await blogApi.get(blogId);
        if (!active) return;
        if (res.success) {
          setBlog(res.data);
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
  }, [blogId]);

  const initialValues: BlogFormValues | null = useMemo(() => {
    if (!blog) return null;
    return {
      title: blog.title ?? "",
      summary: blog.summary ?? "",
      content: blog.content ?? "",
      coverImage: blog.coverImage ?? "",
      category: blog.category ?? "",
      tags: parseTags(blog.tags),
      pointsRequired: blog.pointsRequired ?? 0,
    };
  }, [blog]);

  const denied = !!(user && blog && blog.authorId !== user.id);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-neutral-400" />
      </div>
    );
  }

  // 不存在 / 无权编辑 → 统一 404
  if (error || !blog || !initialValues || denied) {
    notFound();
  }

  return <BlogForm mode="edit" blogId={blogId} initialValues={initialValues} />;
}
