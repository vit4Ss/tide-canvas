"use client";

/* ============================================================================
   FeedCoverflow — React port of the home LIVE GALLERY feed from
   design-ref/liuguang/home-render.js (renderHomeFilters / feedFor / renderFeed /
   startCoverflow) + FX.tileHTML / FX.bindTiles (design-ref/liuguang/shell.js).

   Now driven by REAL community posts (PostLiteVO from GET /api/home/feed) passed
   in via `works`. Each post is adapted to the WorkModal `Artwork` shape so the
   detail dialog is reused unchanged. Covers use the post's coverUrl; when empty
   a deterministic mesh gradient (seeded from the post id) stands in.

   - Category filters (.filters .f[.on]) drive the visible pool, matching tags.
   - The pool is padded to ≥8 tiles then duplicated once so the CSS marquee
     (translateX(-50%)) loops seamlessly. --dur scales with tile count.
   - A rAF loop applies the 3D coverflow transforms per tile (center spotlight,
     tilt, depth, brightness) — identical math to startCoverflow().
   - Tile click → WorkModal; ♥ toggles liked; ↻ 生成同款 carries the prompt and
     routes to /studio (mirrors FX.bindTiles).
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Artwork } from "@/mock";
import { coverBg, fmt } from "@/mock";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import WorkModal from "@/components/site/work-modal";
import type { PostLiteVO } from "@/types/content";

const FILTERS = [
  "全部",
  "插画",
  "动漫",
  "摄影",
  "3D",
  "人像",
  "科幻",
  "国风",
  "视频",
];

/** A real post adapted for the gallery: an Artwork-shaped record (so WorkModal
 *  works unchanged) plus a ready-to-use CSS `background` for the tile cover. */
interface FeedItem extends Artwork {
  /** CSS background: real cover url, else a deterministic mesh fallback. */
  bg: string;
}

/** Deterministic mesh fallback seeded from a post id string. */
function fallbackBg(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** Adapt a backend PostLiteVO into the Artwork-shaped tile model. */
function toItem(p: PostLiteVO): FeedItem {
  const cat = (p.tags?.[0] || "插画") as Artwork["cat"];
  const bg = p.coverUrl
    ? `center / cover no-repeat url("${p.coverUrl}")`
    : fallbackBg(p.id);
  return {
    id: p.id,
    cover: [0, 0, 0], // unused: tiles render `bg`; WorkModal cover overridden below
    h: 1.34,
    type: "image",
    cat,
    model: p.tags?.[1] || "Flux",
    title: p.title || "未命名作品",
    author: "流光社区",
    likes: p.likeCount,
    prompt: p.title,
    bg,
  };
}

function feedFor(cat: string, pool: FeedItem[]): FeedItem[] {
  let out: FeedItem[] = pool;
  if (cat && cat !== "全部") {
    out = pool.filter((a) => a.cat === cat);
  }
  if (!out.length) out = pool;
  return out;
}

/** Pad short pools to ≥8, then duplicate once for a seamless loop. */
function buildSeq(pool: FeedItem[]): FeedItem[] {
  if (!pool.length) return [];
  let base = pool.slice();
  while (base.length < 8) base = base.concat(pool);
  return base.concat(base);
}

export default function FeedCoverflow({
  works,
  loading,
}: {
  works: PostLiteVO[];
  loading: boolean;
}) {
  const router = useRouter();
  const [cat, setCat] = useState("全部");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<Artwork | null>(null);

  const cfRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => works.map(toItem), [works]);
  const pool = useMemo(() => feedFor(cat, items), [cat, items]);
  const seq = useMemo(() => buildSeq(pool), [pool]);
  const dur = Math.round(Math.max(seq.length, 1) * 2.6);

  const toggleLike = (id: string) =>
    setLiked((m) => ({ ...m, [id]: !m[id] }));

  const remix = (a: FeedItem) => {
    try {
      sessionStorage.setItem("flux_prompt", a.prompt || a.title);
    } catch {
      /* sessionStorage may be unavailable */
    }
    toast.info("已带入提示词 · 正在前往创作台");
    router.push("/studio");
  };

  // 3D coverflow rAF loop (ported from startCoverflow) — runs over the live tiles.
  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const cf = cfRef.current;
    const vp = vpRef.current;
    if (!cf || !vp) return;

    let raf = 0;
    const frame = () => {
      const tiles = Array.from(cf.querySelectorAll<HTMLElement>(".tile"));
      const vr = vp.getBoundingClientRect();
      const cx = vr.left + vr.width / 2;
      const reach = vr.width * 0.78;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const r = t.getBoundingClientRect();
        if (r.right < vr.left - 160 || r.left > vr.right + 160) {
          t.style.opacity = "0.12";
          t.classList.remove("cf-focus");
          continue;
        }
        const tc = r.left + r.width / 2;
        const off = Math.max(-2, Math.min(2, (tc - cx) / reach));
        const k = Math.max(0, 1 - Math.abs(off));
        const e = k * k * (3 - 2 * k); // smoothstep, 1 at center
        const rot = -off * 52;
        const tz = (e * 240 - 200).toFixed(1);
        const ty = ((1 - e) * 14).toFixed(1);
        const scale = (0.6 + 0.62 * e).toFixed(3);
        t.style.transform =
          "perspective(1500px) translateY(" +
          ty +
          "px) translateZ(" +
          tz +
          "px) rotateY(" +
          rot.toFixed(1) +
          "deg) scale(" +
          scale +
          ")";
        t.style.opacity = (0.3 + 0.7 * e).toFixed(3);
        t.style.filter = e < 0.5 ? "brightness(" + (0.5 + e).toFixed(2) + ")" : "none";
        t.style.zIndex = String(Math.round(e * 100));
        t.classList.toggle("cf-focus", e > 0.9);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [seq]);

  return (
    <>
      <div className="filters" id="home-filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`f${f === cat ? " on" : ""}`}
            onClick={() => setCat(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="coverflow" id="feed" ref={cfRef}>
        <div className="cf-viewport" ref={vpRef}>
          {loading && (
            <div className="sec-sub" style={{ textAlign: "center", width: "100%", padding: "60px 0" }}>
              正在加载社区作品…
            </div>
          )}
          {!loading && seq.length === 0 && (
            <div className="sec-sub" style={{ textAlign: "center", width: "100%", padding: "60px 0" }}>
              暂无社区作品，快来发布第一件流光之作。
            </div>
          )}
          <div className="cf-track" style={{ ["--dur" as string]: `${dur}s` }}>
            {seq.map((a, i) => {
              const isLiked = liked[a.id] ?? a.likes > 8000;
              return (
                <article
                  key={`${a.id}-${i}`}
                  className="tile reveal in"
                  onClick={() => setActive(a)}
                >
                  <div
                    className="tile-cover"
                    style={{
                      aspectRatio: (1 / a.h).toFixed(3),
                      background: a.bg,
                    }}
                  >
                    {a.type === "video" && <span className="play-orb">▶</span>}
                    <span className="tile-badge">
                      {a.type === "video" ? "VIDEO" : a.cat}
                    </span>
                    <button
                      type="button"
                      className="like"
                      data-liked={isLiked}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLike(a.id);
                      }}
                    >
                      ♥ {fmt(a.likes)}
                    </button>
                    <div className="tile-shade" />
                    <div className="tile-meta">
                      <div className="tt">{a.title}</div>
                      <div className="tb">
                        <span>{a.author}</span>
                        <span className="dot">·</span>
                        <span className="mono">{a.model}</span>
                      </div>
                      <button
                        type="button"
                        className="remix"
                        onClick={(e) => {
                          e.stopPropagation();
                          remix(a);
                        }}
                      >
                        ↻ 生成同款
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <WorkModal postId={active?.id ?? null} onClose={() => setActive(null)} />
    </>
  );
}
