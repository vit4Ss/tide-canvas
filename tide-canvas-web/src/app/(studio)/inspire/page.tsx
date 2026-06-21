"use client";

/* ============================================================================
   灵感 · Inspire — liuguang design markup wired to the REAL community feed.

   Ported from design-ref/灵感.html + design-ref/liuguang/inspire.js, rendered
   inside the (studio) ws-rail layout. Renders ONLY the content to the right of
   the rail (the <main class="insp"> region); the 104px rail, the dark flux
   background, and the liuguang CSS (flux/pages/studio.css) come from the
   (studio) layout. The canonical liuguang class names are preserved so the
   already-imported CSS applies unchanged:
   - .insp h1                → panel title 灵感
   - .insp-search            → search box (#q), debounced
   - .insp-tabs (#insp-tabs) → ✦ 灵感 / 主题 / 提示词 — change sort/curation:
                                 · insp   → sort=hot (mixed/fresh wall)
                                 · theme  → sort=like (curated by likes)
                                 · prompt → sort=new (latest first)
   - .insp-masonry (#feed)   → masonry feed from communityApi.list(...)
   - .empty (#inspEmpty)     → empty state when no matches

   Data: GET /api/community/posts (public read — no session). Tiles open the
   shared <WorkModal/> via communityApi.get(id). 生成同款 (remix) carries the
   prompt to /studio via sessionStorage 'flux_prompt'. The ♥ button calls
   communityApi.like/unlike (authed → ensureSession first). Covers are real URLs;
   an empty URL falls back to a deterministic mesh gradient (import { mesh }).

   The tile markup is inlined here (identical .tile/.tile-cover/… classes as the
   shared InspireTile) so a real cover URL can override the gradient — the shared
   InspireTile only renders a hue-triplet gradient.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { communityApi } from "@/lib/community-api";
import type { PostVO, PostDetailVO } from "@/types/community";
import { useAuthStore } from "@/stores/use-auth-store";
import WorkModal from "@/components/site/work-modal";
import { toast } from "@/components/shared/toast";
import { useReveal } from "@/components/site/use-reveal";
import { mesh } from "@/lib/mesh";
import type { Artwork, MeshHues } from "@/mock";
import { fmt } from "@/mock";
import styles from "./inspire.module.css";

type TabKey = "insp" | "theme" | "prompt";
type SortKey = "hot" | "new" | "like";

const TABS: { t: TabKey; label: string; sort: SortKey }[] = [
  { t: "insp", label: "✦ 灵感", sort: "hot" },
  { t: "theme", label: "主题", sort: "like" },
  { t: "prompt", label: "提示词", sort: "new" },
];

/** Deterministic mesh-hue triplet seeded from a post id (gradient fallback). */
function hues(id: string): MeshHues {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return [h, (h + 132) % 360, (h + 248) % 360];
}

type ArtworkX = Artwork & { coverUrl: string; likes: number; liked: boolean };

/** Map a backend PostVO/PostDetailVO to the Artwork shape WorkModal expects.
 *  `cover` carries the gradient-fallback triplet; the real URL is `coverUrl`.
 *  `h` is a deterministic 1.0–1.5 height seeded from the id for masonry rhythm. */
function toArtwork(p: PostVO | PostDetailVO): ArtworkX {
  const d = p as PostDetailVO;
  let s = 0;
  for (let i = 0; i < p.id.length; i++) s = (s + p.id.charCodeAt(i)) % 6;
  return {
    id: p.id,
    cover: hues(p.id),
    h: 1.0 + s * 0.1,
    type: p.type === "video" ? "video" : "image",
    cat: (p.cat || "插画") as Artwork["cat"],
    model: p.model || "—",
    title: p.title,
    author: p.author?.name || "用户",
    likes: p.likes,
    liked: p.liked,
    prompt: d.prompt,
    negPrompt: d.negPrompt,
    steps: d.steps,
    sampler: d.sampler,
    cfgScale: d.cfgScale,
    size: d.size,
    coverUrl: p.cover || p.thumbnail || "",
  };
}

export default function InspirePage() {
  const router = useRouter();
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [tab, setTab] = useState<TabKey>("insp");
  const [q, setQ] = useState<string>("");
  const [posts, setPosts] = useState<PostVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ArtworkX | null>(null);

  // Debounce the keyword (design uses 180ms).
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const sort = useMemo(
    () => TABS.find((x) => x.t === tab)?.sort ?? "hot",
    [tab],
  );

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const res = await communityApi.list({
      pageNum: 1,
      pageSize: 60,
      sort,
      keyword: debouncedQ || undefined,
    });
    if (id !== reqId.current) return;
    if (res.success && res.data) setPosts(res.data.records);
    else setPosts([]);
    setLoading(false);
  }, [sort, debouncedQ]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => posts.map(toArtwork), [posts]);

  // Re-scan reveal targets whenever the rendered set changes (FX.reveal).
  useReveal([tab, debouncedQ, loading]);

  const openWork = useCallback(async (id: string) => {
    const res = await communityApi.get(id);
    if (res.success && res.data) setActive(toArtwork(res.data));
    else toast.error("作品详情加载失败");
  }, []);

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
    <main className={`insp ${styles.fill}`}>
      <div className="insp-glow" aria-hidden="true" />
      <div className="insp-in">
        <h1>灵感</h1>

        <label className="insp-search">
          <span className="ic">⌕</span>
          <input
            id="q"
            type="text"
            placeholder="试试「国风 Q 版」"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>

        <div className="insp-tabs" id="insp-tabs">
          {TABS.map((x) => (
            <button
              key={x.t}
              type="button"
              className={tab === x.t ? "on" : undefined}
              onClick={() => setTab(x.t)}
            >
              {x.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty" style={{ display: "block" }}>
            正在加载灵感… ✦
          </div>
        ) : (
          <>
            <div className="insp-masonry" id="feed">
              {items.map((a, i) => (
                <Tile
                  key={a.id}
                  art={a}
                  delay={(i % 5) * 0.03}
                  onOpen={() => openWork(a.id)}
                  onRemix={() => remix(a)}
                  onToggleLike={ensureSession}
                />
              ))}
            </div>

            <div
              className="empty"
              id="inspEmpty"
              style={{ display: items.length ? "none" : "block" }}
            >
              没有匹配的灵感，换个关键词试试 ✦
            </div>
          </>
        )}
      </div>

      <WorkModal work={active} onClose={() => setActive(null)} />
    </main>
  );
}

/* ── Tile — inlined liuguang tile markup (identical classes to InspireTile),
   wired to the real like endpoint + real cover URL with gradient fallback. ──── */

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

  const cover = art.coverUrl
    ? `center / cover no-repeat url("${art.coverUrl}")`
    : mesh(art.cover[0], art.cover[1], art.cover[2]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
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
            <span>{art.author}</span>
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
