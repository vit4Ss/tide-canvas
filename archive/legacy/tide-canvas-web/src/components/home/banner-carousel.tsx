"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bannerApi } from "@/lib/api";
import type { BannerVO } from "@/types/admin";

const AUTOPLAY_MS = 5000;

/** 单张 Banner：有 linkUrl 时整图可点击跳转（外链新窗口、内链路由），否则纯展示 */
function BannerSlide({ banner }: { banner: BannerVO }) {
  const isExternal = /^https?:\/\//.test(banner.linkUrl || "");
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={banner.imageUrl} alt={banner.title || "banner"} className="h-full w-full object-cover" draggable={false} />;
  if (!banner.linkUrl) {
    return <div className="block h-full w-full">{img}</div>;
  }
  return isExternal ? (
    <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" className="block h-full w-full">{img}</a>
  ) : (
    <Link href={banner.linkUrl} className="block h-full w-full">{img}</Link>
  );
}

export function BannerCarousel() {
  const [banners, setBanners] = useState<BannerVO[]>([]);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    bannerApi.list()
      .then((res) => {
        if (!cancelled && res.success && res.data) setBanners(res.data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const count = banners.length;
  const go = useCallback((next: number) => {
    if (count === 0) return;
    setIndex(((next % count) + count) % count);
  }, [count]);

  // 自动轮播（多于 1 张时）；hover 暂停由 onMouseEnter/Leave 控制
  const startAutoplay = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (count <= 1) return;
    timerRef.current = setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
  }, [count]);

  useEffect(() => {
    startAutoplay();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startAutoplay]);

  if (count === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <div
        className="relative aspect-[18/5] w-full overflow-hidden"
        onMouseEnter={() => { if (timerRef.current) clearInterval(timerRef.current); }}
        onMouseLeave={startAutoplay}
      >
        {/* coverflow：中间为当前张，两侧露边并压暗，其余隐藏 */}
        {banners.map((b, i) => {
          // 相对中心的「环形」位置：-1 左、0 中、1 右，其余隐藏
          let pos = i - index;
          if (pos > count / 2) pos -= count;
          if (pos < -count / 2) pos += count;
          const visible = Math.abs(pos) <= 1;
          return (
            <div
              key={b.id}
              aria-hidden={pos !== 0}
              className="absolute left-1/2 top-1/2 h-full w-[72%] transition-all duration-500 ease-out"
              style={{
                transform: `translate(-50%, -50%) translateX(${pos * 100}%) scale(${pos === 0 ? 1 : 0.9})`,
                opacity: visible ? (pos === 0 ? 1 : 0.45) : 0,
                zIndex: pos === 0 ? 20 : 10,
                pointerEvents: pos === 0 ? "auto" : "none",
              }}
            >
              <div className={`h-full w-full overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 ${pos === 0 ? "shadow-2xl ring-1 ring-black/5 dark:ring-white/10" : ""}`}>
                <BannerSlide banner={b} />
              </div>
            </div>
          );
        })}

        {/* 左右切换（多于 1 张时显示） */}
        {count > 1 && (
          <>
            <button
              onClick={() => go(index - 1)}
              aria-label="上一张"
              className="absolute left-2 top-1/2 z-30 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/50 sm:block"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => go(index + 1)}
              aria-label="下一张"
              className="absolute right-2 top-1/2 z-30 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/50 sm:block"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* 指示点（位于轮播条下方） */}
      {count > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => go(i)}
              aria-label={`第 ${i + 1} 张`}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-neutral-800 dark:bg-white" : "w-1.5 bg-neutral-300 hover:bg-neutral-400 dark:bg-neutral-600 dark:hover:bg-neutral-500"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
