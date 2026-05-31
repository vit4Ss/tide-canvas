"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

const mockWorks = [
  {
    id: 1,
    title: "赛博朋克城市",
    tags: ["illustration", "sci-fi"],
    image: "/placeholder-1.svg",
    author: "创作者A",
  },
  {
    id: 2,
    title: "水墨山水",
    tags: ["painting", "chinese"],
    image: "/placeholder-2.svg",
    author: "创作者B",
  },
  {
    id: 3,
    title: "人物肖像",
    tags: ["portrait", "photography"],
    image: "/placeholder-3.svg",
    author: "创作者C",
  },
  {
    id: 4,
    title: "产品设计",
    tags: ["design", "3d"],
    image: "/placeholder-4.svg",
    author: "创作者D",
  },
  {
    id: 5,
    title: "动漫角色",
    tags: ["anime", "character"],
    image: "/placeholder-5.svg",
    author: "创作者E",
  },
  {
    id: 6,
    title: "建筑概念",
    tags: ["architecture", "concept"],
    image: "/placeholder-6.svg",
    author: "创作者F",
  },
];

export function FeaturedWorks() {
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
            href="/explore"
            className="hidden items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 sm:flex dark:text-neutral-400 dark:hover:text-white"
          >
            查看更多
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {mockWorks.map((work) => (
            <Link
              key={work.id}
              href={`/explore/${work.id}`}
              className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white transition-all hover:border-neutral-300 hover:shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                <div className="flex h-full items-center justify-center text-neutral-400">
                  <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="p-4">
                <div className="flex gap-2">
                  {work.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="mt-2 font-semibold">{work.title}</h3>
                <p className="mt-1 text-sm text-neutral-500">{work.author}</p>
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-center sm:hidden">
          <Link
            href="/explore"
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
