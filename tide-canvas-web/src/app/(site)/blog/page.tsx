"use client";

/* ============================================================================
   /blog — 博客列表（公开）。

   数据: GET /api/blog/posts（分页，仅已发布；自建 + Telegram 频道同步同表，
   前台展示完全一致，不暴露来源差异）。

   版式（有别于参考站的盒式卡片）：
   - 最新一篇为横向 Featured 大图（细上下分割线圈出，非卡片）
   - 其余三列无框图文网格，靠留白分组
   - 「加载更多」白描边胶囊按钮追加下一页
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { blogApi } from "@/lib/blog-api";
import type { BlogPostLiteVO } from "@/types/blog";
import "./blog.css";

const PAGE_SIZE = 12;

function fmtDate(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Cover({ url, title }: { url: string; title: string }) {
  if (!url) {
    return (
      <div className="blog-cover empty" aria-hidden>
        FLOWINGLIGHT
      </div>
    );
  }
  return (
    <div
      className="blog-cover"
      role="img"
      aria-label={title}
      style={{ backgroundImage: `url("${url}")` }}
    />
  );
}

export default function BlogListPage() {
  const [posts, setPosts] = useState<BlogPostLiteVO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const load = useCallback(async (pageNum: number) => {
    if (pageNum === 1) setLoading(true);
    else setMore(true);
    const res = await blogApi.list(pageNum, PAGE_SIZE);
    if (res.success && res.data) {
      const fresh = res.data.records.filter((p) => !seen.current.has(p.id));
      fresh.forEach((p) => seen.current.add(p.id));
      setPosts((prev) => (pageNum === 1 ? res.data!.records : [...prev, ...fresh]));
      setTotal(res.data.total);
      setPage(pageNum);
      setError(null);
    } else if (pageNum === 1) {
      setError(res.message || "加载失败，请稍后重试");
    }
    setLoading(false);
    setMore(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      seen.current = new Set();
      void load(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const featured = posts[0];
  const rest = posts.slice(1);
  const hasMore = posts.length < total;

  return (
    <div className="block page-top">
      <div className="wrap">
        <div className="sec-head blog-head">
          <div>
            <span className="eyebrow">
              <span className="d" />
              博客
            </span>
            <h1 className="sec-title">灵感与实践</h1>
            <p className="sec-sub">
              生成技巧、模型动态与精选内容，帮你把 AI 创作用得更顺手。
            </p>
          </div>
        </div>

        {loading ? (
          <div className="blog-grid" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div className="blog-skel cover" />
                <div className="blog-skel line" />
                <div className="blog-skel line short" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="blog-empty">{error}</div>
        ) : posts.length === 0 ? (
          <div className="blog-empty">还没有文章，敬请期待 ✦</div>
        ) : (
          <>
            {featured && (
              <Link className="blog-feat" href={`/blog/${featured.id}`}>
                <Cover url={featured.coverUrl} title={featured.title} />
                <div className="blog-feat-body">
                  <div className="blog-meta">
                    <span>{fmtDate(featured.publishedAt)}</span>
                    <span className="dot" />
                    <span>最新</span>
                  </div>
                  <h2 className="blog-feat-title">{featured.title}</h2>
                  {featured.summary && (
                    <p className="blog-feat-sum">{featured.summary}</p>
                  )}
                  <span className="blog-feat-more">阅读全文 →</span>
                </div>
              </Link>
            )}

            <div className="blog-grid">
              {rest.map((p) => (
                <Link className="blog-item" key={p.id} href={`/blog/${p.id}`}>
                  <Cover url={p.coverUrl} title={p.title} />
                  <h3 className="blog-item-title">{p.title}</h3>
                  {p.summary && <p className="blog-item-sum">{p.summary}</p>}
                  <div className="blog-meta">
                    <span>{fmtDate(p.publishedAt)}</span>
                    {p.viewCount > 0 && (
                      <>
                        <span className="dot" />
                        <span>{p.viewCount} 阅读</span>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {hasMore && (
              <div className="blog-more">
                <button
                  type="button"
                  disabled={more}
                  onClick={() => void load(page + 1)}
                >
                  {more ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
