"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { communityApi } from "@/lib/api";
import type { PostVO } from "@/types/community";

/**
 * 精选作品：取社区最新的带图帖子作为首页展示。
 * 无数据（或全部无图）时整个区块不渲染——不展示任何假占位卡片。
 */
export function FeaturedWorks() {
  const [works, setWorks] = useState<PostVO[]>([]);

  useEffect(() => {
    let active = true;
    communityApi
      .list({ pageNum: 1, pageSize: 12 })
      .then((res) => {
        if (!active || !res.success) return;
        const withImage = (res.data.records ?? []).filter((p) => p.contentImages?.[0]);
        setWorks(withImage.slice(0, 6));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (works.length === 0) return null;

  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">精选作品</h2>
            <p className="mt-2 text-neutral-600 dark:text-neutral-400">
              收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始
            </p>
          </div>
          <Link
            href="/community"
            className="hidden items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 sm:flex dark:text-neutral-400 dark:hover:text-white"
          >
            查看更多
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {works.map((work) => {
            const tags = (work.tags ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 2);
            return (
              <Link
                key={work.id}
                href={`/community/${work.id}`}
                className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-all hover:border-neutral-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={work.contentImages[0]}
                    alt={work.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="p-4">
                  {tags.length > 0 && (
                    <div className="flex gap-2">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <h3 className="mt-2 truncate font-semibold">{work.title}</h3>
                  <p className="mt-1 text-sm text-neutral-500">{work.nickname}</p>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link
            href="/community"
            className="inline-flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
          >
            查看更多作品
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
