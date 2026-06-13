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
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div
        className="group relative aspect-[16/5] w-full overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900"
        onMouseEnter={() => { if (timerRef.current) clearInterval(timerRef.current); }}
        onMouseLeave={startAutoplay}
      >
        {/* 横向滑动轨道 */}
        <div className="flex h-full transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {banners.map((b) => (
            <div key={b.id} className="h-full w-full shrink-0">
              <BannerSlide banner={b} />
            </div>
          ))}
        </div>

        {/* 左右切换（多于 1 张时显示，hover 浮现） */}
        {count > 1 && (
          <>
            <button
              onClick={() => go(index - 1)}
              aria-label="上一张"
              className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 group-hover:opacity-100 sm:block"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => go(index + 1)}
              aria-label="下一张"
              className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 group-hover:opacity-100 sm:block"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {/* 指示点 */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              {banners.map((b, i) => (
                <button
                  key={b.id}
                  onClick={() => go(i)}
                  aria-label={`第 ${i + 1} 张`}
                  className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
