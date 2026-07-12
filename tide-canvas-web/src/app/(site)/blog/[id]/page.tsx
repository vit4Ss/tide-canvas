"use client";

/* ============================================================================
   /blog/[id] — 博客详情（公开）。

   数据: GET /api/blog/posts/:id（草稿 404）。正文为 Markdown，用与聊天页
   相同的 react-markdown + remark-gfm 渲染；排版走 blog.css 的 .blog-md
   （720px 阅读宽度、1.85 行高）。来源（自建 / Telegram）不对外区分。
   ========================================================================== */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { blogApi } from "@/lib/blog-api";
import type { BlogPostVO } from "@/types/blog";
import "../blog.css";

function fmtDate(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function BlogDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [post, setPost] = useState<BlogPostVO | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState("loading");
      blogApi.detail(id).then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setPost(res.data);
          setState("ok");
        } else {
          setState("error");
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  return (
    <div className="block page-top">
      <div className="wrap">
        <article className="blog-article">
          <Link href="/blog" className="blog-back">
            ← 返回博客
          </Link>

          {state === "loading" && (
            <div aria-hidden>
              <div className="blog-skel line" style={{ height: 30, width: "80%" }} />
              <div className="blog-skel line short" />
              <div className="blog-skel cover" style={{ marginTop: 24 }} />
            </div>
          )}

          {state === "error" && (
            <div className="blog-empty">文章不存在或已下架 ✦</div>
          )}

          {state === "ok" && post && (
            <>
              <h1>{post.title}</h1>
              <div className="blog-meta">
                <span>{fmtDate(post.publishedAt)}</span>
                {post.viewCount > 0 && (
                  <>
                    <span className="dot" />
                    <span>{post.viewCount} 阅读</span>
                  </>
                )}
              </div>
              {post.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="blog-article-cover"
                  src={post.coverUrl}
                  alt={post.title}
                />
              )}
              <div className="blog-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {post.content}
                </ReactMarkdown>
              </div>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
