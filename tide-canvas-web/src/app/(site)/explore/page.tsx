"use client";

/* ============================================================================
   作品广场 · Explore — liuguang design markup wired to the REAL community feed.

   Ported from design-ref/作品广场.html + design-ref/liuguang/explore.js. The
   exact liuguang class names are preserved so the shared CSS applies unchanged:
   - .page-hero  → live "本周新增" chip + .page-head
   - .explore-bar → search input (#q), .seg type all/image/video, .select sort
   - .filters    → category chips (derived from real data so each yields results)
   - .masonry    → feed tiles from communityApi.list(...)
   - .empty      → empty state

   Data: GET /api/community/posts with the type/sort/category/keyword filters
   driving the query (public read — no session needed). Sort maps directly to the
   backend hot|new|like. The 视频 category chip maps to type=video (design parity).

   Tiles open the shared <WorkModal/> via communityApi.get(id) for detail. The ♥
   button calls communityApi.like/unlike — those are authed, so ensureSession()
   runs first. Covers are real URLs; an empty URL falls back to a deterministic
   mesh gradient (import { mesh }).
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { PostVO } from "@/types/community";
import { useAuthStore } from "@/stores/use-auth-store";
import WorkModal from "@/components/site/work-modal";
import { toast } from "@/components/shared/toast";
import { useLiveCounter } from "@/components/site/use-live-counter";
import { mesh } from "@/lib/mesh";
import type { Artwork, MeshHues } from "@/mock";
import { fmt } from "@/mock";

type SortKey = "hot" | "new" | "like";
type TypeKey = "all" | "image" | "video";

const TYPE_SEG: { t: TypeKey; label: string }[] = [
  { t: "all", label: "全部" },
  { t: "image", label: "图片" },
  { t: "video", label: "视频" },
];

const SORT_OPTS: { value: SortKey; label: string }[] = [
  { value: "hot", label: "最热" },
  { value: "new", label: "最新" },
  { value: "like", label: "点赞最多" },
];

const ALL = "全部";
const VIDEO = "视频";

/** Deterministic mesh-hue triplet seeded from a post id (covers the shared
 *  components' MeshHues contract; used as the gradient fallback). */
function hues(id: string): MeshHues {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return [h, (h + 132) % 360, (h + 248) % 360];
}

/** Map a backend PostVO to the Artwork shape the shared WorkModal/tiles expect.
 *  `cover` carries the mesh-hue fallback triplet; the real cover URL (if any) is
 *  applied at the tile level. A detail VO adds the generation params. */
type ArtworkX = Artwork & {
  coverUrl: string;
  likes: number;
  liked: boolean;
  authorId: string;
};

function toArtwork(p: PostVO): ArtworkX {
  return {
    id: p.id,
    cover: hues(p.id),
    h: 1.3,
    type: p.type === "video" ? "video" : "image",
    cat: (p.cat || "插画") as Artwork["cat"],
    model: p.model || "—",
    title: p.title,
    author: p.author?.name || "用户",
    authorId: p.author?.id || "",
    likes: p.likes,
    liked: p.liked,
    coverUrl: p.cover || p.thumbnail || "",
  };
}

export default function ExplorePage() {
  const router = useRouter();
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [cat, setCat] = useState<string>(ALL);
  const [type, setType] = useState<TypeKey>("all");
  const [q, setQ] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("hot");

  const [posts, setPosts] = useState<PostVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Real category chips, accumulated across loads so chips never disappear.
  const [cats, setCats] = useState<string[]>([]);

  const PAGE_SIZE = 24;

  // Debounce the keyword so each keystroke doesn't fire a request.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Live "本周新增" counter (ported from FX.liveCounter, base 8902).
  const liveNum = useLiveCounter(8902);

  // reqId bumps on every filter change so an in-flight page (first OR appended)
  // from a stale filter set is discarded.
  const reqId = useRef(0);

  // current filters → backend query params. The 视频 chip is a type filter.
  const queryFor = useCallback(
    (p: number) => {
      const catParam = cat === ALL || cat === VIDEO ? undefined : cat;
      const typeParam = cat === VIDEO ? "video" : type === "all" ? undefined : type;
      return {
        pageNum: p,
        pageSize: PAGE_SIZE,
        sort,
        cat: catParam,
        type: typeParam,
        keyword: debouncedQ || undefined,
      };
    },
    [cat, type, sort, debouncedQ],
  );

  const mergeCats = (records: PostVO[]) =>
    setCats((prev) => {
      const merged = new Set(prev);
      records.forEach((p) => p.cat && merged.add(p.cat));
      return Array.from(merged);
    });

  // (re)load page 1 whenever the filters change (replaces the list).
  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const res = await communityApi.list(queryFor(1));
    if (id !== reqId.current) return; // superseded by a newer filter change
    if (res.success && res.data) {
      setPosts(res.data.records);
      setTotal(res.data.total);
      setPage(1);
      mergeCats(res.data.records);
    } else {
      setPosts([]);
      setTotal(0);
    }
    setLoading(false);
  }, [queryFor]);

  useEffect(() => {
    reload();
  }, [reload]);

  // append the next page (infinite scroll). Bails if a filter change superseded
  // the current result set mid-flight.
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || posts.length >= total) return;
    const id = reqId.current;
    const next = page + 1;
    setLoadingMore(true);
    const res = await communityApi.list(queryFor(next));
    if (id !== reqId.current) {
      setLoadingMore(false);
      return; // filters changed while paging — discard
    }
    if (res.success && res.data) {
      // de-dupe across pages: offset paging can re-surface a row when a new post
      // shifts the window, which would otherwise cause duplicate React keys.
      setPosts((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...res.data.records.filter((r) => !seen.has(r.id))];
      });
      setTotal(res.data.total);
      setPage(next);
      mergeCats(res.data.records);
    }
    setLoadingMore(false);
  }, [loading, loadingMore, posts.length, total, page, queryFor]);

  const hasMore = posts.length < total;

  // auto-load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "800px" },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [hasMore, loadMore]);

  // Chip list: 全部 + real categories (sorted, stable) + 视频 (type shortcut).
  const chips = useMemo(() => {
    const sorted = [...cats].sort((a, b) => a.localeCompare(b, "zh"));
    return [ALL, ...sorted, VIDEO];
  }, [cats]);

  const items = useMemo(() => posts.map(toArtwork), [posts]);

  const remix = (art: Artwork) => {
    try {
      sessionStorage.setItem("flux_prompt", art.prompt || art.title);
    } catch {
      /* sessionStorage may be unavailable */
    }
    toast.info("已带入提示词 · 正在前往创作台");
    router.push("/studio");
  };

  return (
    <>
      <header className="page-hero">
        <div className="ph-scrim" />
        <div className="wrap">
          <div className="live-chip reveal in">
            <span className="live-dot" />
            实时 · <b>{liveNum}</b> 件作品本周新增
          </div>
          <div className="page-head">
            <span className="eyebrow reveal in">
              <span className="d" />
              作品广场 · GALLERY
            </span>
            <h1 className="reveal in">
              在<span className="gtext">流光</span>之中，发现灵感
            </h1>
            <p className="reveal in">
              来自全球创作者的真实作品。点开任意一张，查看提示词与参数，一键生成同款。
            </p>
          </div>
        </div>
      </header>

      <section className="block" style={{ paddingTop: 30 }}>
        <div className="wrap">
          <div className="explore-bar reveal in">
            <label className="search">
              <span style={{ color: "var(--text-faint)" }}>⌕</span>
              <input
                type="text"
                placeholder="搜索作品、作者或模型…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>

            <div className="seg">
              {TYPE_SEG.map((s) => (
                <button
                  key={s.t}
                  type="button"
                  className={type === s.t ? "on" : undefined}
                  onClick={() => setType(s.t)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filters">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                className={`f${c === cat ? " on" : ""}`}
                onClick={() => setCat(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="empty" style={{ display: "block" }}>
              正在加载作品… ✦
            </div>
          ) : (
            <>
              <div className="masonry">
                {items.map((a, i) => (
                  <Tile
                    key={a.id}
                    art={a}
                    delay={(i % 5) * 0.03}
                    onOpen={() => setActiveId(a.id)}
                    onRemix={() => remix(a)}
                    onToggleLike={ensureSession}
                  />
                ))}
              </div>

              <div
                className="empty"
                style={{ display: items.length ? "none" : "block" }}
              >
                没有匹配的作品，换个关键词或分类试试 ✦
              </div>

              {/* infinite-scroll sentinel + manual fallback */}
              {hasMore && (
                <>
                  <div ref={sentinelRef} className="feed-sentinel" />
                  <div style={{ textAlign: "center", marginTop: 24 }}>
                    <button
                      type="button"
                      className="more-btn"
                      disabled={loadingMore}
                      onClick={loadMore}
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>

      <WorkModal
        postId={activeId}
        onClose={() => setActiveId(null)}
        onEngagementChange={(e) =>
          setPosts((prev) =>
            prev.map((p) => (p.id === e.id ? { ...p, liked: e.liked, likes: e.likes } : p)),
          )
        }
      />
    </>
  );
}

/* ── Tile — React port of FX.tileHTML + FX.bindTiles (shell.js), wired to the
   real like endpoint. Cover uses the real URL when present, else the mesh
   gradient fallback. ──────────────────────────────────────────────────────── */

function Tile({
  art,
  delay,
  onOpen,
  onRemix,
  onToggleLike,
}: {
  art: ArtworkX;
  delay: number;
  onOpen: () => void;
  onRemix: () => void;
  onToggleLike: () => Promise<boolean>;
}) {
  const [liked, setLiked] = useState(art.liked);
  const [likes, setLikes] = useState(art.likes);
  const [busy, setBusy] = useState(false);

  // sync local like state when the parent updates this post (e.g. the user liked
  // it inside the detail modal); the card's own optimistic toggle leaves the
  // parent value unchanged, so these effects don't fight the local toggle.
  useEffect(() => setLiked(art.liked), [art.liked]);
  useEffect(() => setLikes(art.likes), [art.likes]);

  const cover = art.coverUrl
    ? `center / cover no-repeat url("${art.coverUrl}")`
    : mesh(art.cover[0], art.cover[1], art.cover[2]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    // optimistic
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const ok = await onToggleLike();
      if (!ok) throw new Error("no session");
      const res = next
        ? await communityApi.like(art.id)
        : await communityApi.unlike(art.id);
      if (res.success && res.data) {
        setLiked(res.data.liked);
        setLikes(res.data.likeCount);
      } else {
        throw new Error(res.message);
      }
    } catch {
      // revert on failure
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error("操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="tile reveal in"
      style={{ ["--rd" as string]: `${delay}s` }}
      onClick={onOpen}
    >
      <div
        className="tile-cover"
        style={{ aspectRatio: (1 / art.h).toFixed(3), background: cover }}
      >
        {art.type === "video" && <span className="play-orb">▶</span>}
        <span className="tile-badge">{art.type === "video" ? "VIDEO" : art.cat}</span>
        <button
          type="button"
          className="like"
          data-liked={liked ? "true" : "false"}
          onClick={toggle}
        >
          ♥ {fmt(likes)}
        </button>
        <div className="tile-shade" />
        <div className="tile-meta">
          <div className="tt">{art.title}</div>
          <div className="tb">
            {art.authorId ? (
              <Link
                href={`/user/${art.authorId}`}
                className="tile-author"
                onClick={(e) => e.stopPropagation()}
              >
                {art.author}
              </Link>
            ) : (
              <span>{art.author}</span>
            )}
            <span className="dot">·</span>
            <span className="mono">{art.model}</span>
          </div>
          <button
            type="button"
            className="remix"
            onClick={(e) => {
              e.stopPropagation();
              onRemix();
            }}
          >
            ↻ 生成同款
          </button>
        </div>
      </div>
    </article>
  );
}
