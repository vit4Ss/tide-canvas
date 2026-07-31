"use client";

/* ============================================================================
   HeroWall — 首屏作品墙背景。

   四列作品封面以不同速度缓慢纵向循环流动（纯 CSS transform 动画），整体
   轻微倾斜制造纵深感；真实作品来自 /api/community/posts（与作品广场同源），
   接口为空或失败时回退到静态 mesh 渐变磁贴（@/content/home），保证首屏
   永不空白。

   可读性由 pages.css 的 .hero-scrim 蒙版层保证（左侧重、右侧轻）。
   prefers-reduced-motion 下停止流动。
   ========================================================================== */

import { useEffect, useState } from "react";
import { communityApi } from "@/lib/community-api";
import { HERO_WALL_FALLBACK_COVERS } from "@/content/home";
import { coverBg } from "@/lib/mesh";

type WallTile = { key: string; img?: string; bg?: string };

const COLS = 4;
/** 每列磁贴的宽高比循环，制造有机的瀑布节奏 */
const RATIOS = ["3/4", "1/1", "4/5", "5/7", "1/1", "3/4"];
/** 每列动画时长（秒）——互质避免同步 */
const DURS = [58, 74, 64, 82];

const fallbackTiles = (): WallTile[] =>
  HERO_WALL_FALLBACK_COVERS.map((hues, i) => ({ key: `m-${i}`, bg: coverBg(hues) }));

export default function HeroWall() {
  const [tiles, setTiles] = useState<WallTile[]>(fallbackTiles);

  useEffect(() => {
    let mounted = true;
    communityApi
      .list({ pageNum: 1, pageSize: 28, sort: "hot" })
      .then((res) => {
        if (!mounted || !res.success || !res.data) return;
        const real = res.data.records
          .filter((p) => p.cover)
          .map((p) => ({ key: `p-${p.id}`, img: p.cover }));
        // 不足 12 张时保留 mesh 兜底混排，避免列太短露馅
        if (real.length >= 12) setTiles(real);
        else if (real.length > 0) setTiles([...real, ...fallbackTiles()]);
      })
      .catch(() => {
        /* 静默回退 mesh 磁贴 */
      });
    return () => {
      mounted = false;
    };
  }, []);

  // round-robin 分列；每列至少 6 块，循环补齐
  const cols: WallTile[][] = Array.from({ length: COLS }, () => []);
  tiles.forEach((t, i) => cols[i % COLS].push(t));
  cols.forEach((col, ci) => {
    let i = 0;
    while (col.length < 6 && tiles.length > 0) {
      const src = tiles[(ci + i * COLS) % tiles.length];
      col.push({ ...src, key: `${src.key}-fill${i}` });
      i++;
    }
  });

  return (
    <div className="hero-wall" aria-hidden>
      {cols.map((col, ci) => (
        <div
          key={ci}
          className="hw-col"
          style={{ ["--dur" as string]: `${DURS[ci % DURS.length]}s` }}
        >
          {/* 内容 ×2 实现无缝循环（translateY(-50%)） */}
          {[0, 1].map((dup) => (
            <div className="hw-run" key={dup} aria-hidden={dup === 1}>
              {col.map((t, ti) => (
                <div
                  key={`${t.key}-${dup}`}
                  className="hw-tile"
                  style={{
                    aspectRatio: RATIOS[(ci + ti) % RATIOS.length],
                    ...(t.img
                      ? { backgroundImage: `url(${t.img})` }
                      : { background: t.bg }),
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
