"use client";

/* ============================================================================
   作者主页 · /user/[id] — a creator's public profile: header (avatar, stats,
   follow) + a grid of their published works. Clicking a work goes to its detail
   page (/explore/[id]). Reached from any author name/avatar across the plaza.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { AuthorProfileVO, PostVO } from "@/types/community";
import { useAuthStore } from "@/stores/use-auth-store";
import { Avatar } from "@/components/flux/atoms";
import { toast } from "@/components/shared/toast";
import { mesh } from "@/lib/mesh";
import { fmt } from "@/mock";

function coverFallback(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

const PAGE_SIZE = 24;

export default function AuthorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [profile, setProfile] = useState<AuthorProfileVO | null>(null);
  const [following, setFollowing] = useState(false);
  const [posts, setPosts] = useState<PostVO[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  // load the profile header.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState("loading");
    communityApi.authorProfile(id).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setProfile(res.data);
        setFollowing(res.data.isFollowing);
        setState("ok");
      } else {
        setState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // bumps when the author (id) changes, so an in-flight works page from the
  // previous author is discarded instead of replacing the current grid.
  const worksReq = useRef(0);

  // load a page of the author's works.
  const loadPage = useCallback(
    async (p: number) => {
      if (!id) return;
      const rid = worksReq.current;
      setLoading(true);
      const res = await communityApi.authorPosts(id, { pageNum: p, pageSize: PAGE_SIZE });
      if (rid !== worksReq.current) return; // author switched mid-flight — discard
      if (res.success && res.data) {
        setPosts((prev) => {
          if (p === 1) return res.data.records;
          // de-dupe across pages (offset paging can re-surface a row when new posts
          // shift the window) to avoid duplicate React keys / tiles.
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...res.data.records.filter((r) => !seen.has(r.id))];
        });
        setTotal(res.data.total);
        setPage(p);
      }
      setLoading(false);
    },
    [id],
  );

  useEffect(() => {
    worksReq.current++; // invalidate any in-flight page from the previous author
    setPosts([]);
    loadPage(1);
  }, [loadPage]);

  const toggleFollow = useCallback(async () => {
    if (!profile) return;
    const next = !following;
    setFollowing(next); // optimistic
    setProfile((p) => (p ? { ...p, followers: p.followers + (next ? 1 : -1) } : p));
    try {
      if (!(await ensureSession())) throw new Error("no session");
      const res = next ? await communityApi.follow(profile.id) : await communityApi.unfollow(profile.id);
      if (!res.success) throw new Error(res.message);
      toast.success(next ? `已关注 ${profile.name}` : "已取消关注");
    } catch {
      setFollowing(!next);
      setProfile((p) => (p ? { ...p, followers: p.followers + (next ? -1 : 1) } : p));
      toast.error("操作失败，请稍后重试");
    }
  }, [profile, following, ensureSession]);

  const hasMore = posts.length < total;

  return (
    <section className="block" style={{ paddingTop: 30 }}>
      <div className="wrap">
        <Link href="/explore" className="work-back">
          ← 返回作品广场
        </Link>

        {state === "loading" && (
          <div className="empty" style={{ display: "block" }}>
            正在加载… ✦
          </div>
        )}
        {state === "error" && (
          <div className="empty" style={{ display: "block" }}>
            该用户不存在 ✦
          </div>
        )}

        {state === "ok" && profile && (
          <>
            <div className="author-hero">
              <Avatar name={profile.name} size={84} className="av" />
              <div className="info">
                <div className="nm">{profile.name}</div>
                {profile.joinedAt && (
                  <div className="jn">加入于 {profile.joinedAt.slice(0, 10)}</div>
                )}
                <div className="author-stats">
                  <div className="st">
                    <b>{fmt(profile.works)}</b>
                    <span>作品</span>
                  </div>
                  <div className="st">
                    <b>{fmt(profile.likes)}</b>
                    <span>获赞</span>
                  </div>
                  <div className="st">
                    <b>{fmt(profile.followers)}</b>
                    <span>粉丝</span>
                  </div>
                  <div className="st">
                    <b>{fmt(profile.following)}</b>
                    <span>关注</span>
                  </div>
                </div>
              </div>
              <button type="button" className={`foll${following ? " on" : ""}`} onClick={toggleFollow}>
                {following ? "已关注" : "+ 关注"}
              </button>
            </div>

            {posts.length === 0 && !loading ? (
              <div className="empty" style={{ display: "block" }}>
                还没有公开作品 ✦
              </div>
            ) : (
              <div className="masonry">
                {posts.map((p) => {
                  const cover = p.cover || p.thumbnail || "";
                  const bg = cover
                    ? `center / cover no-repeat url("${cover}")`
                    : coverFallback(p.id);
                  return (
                    <Link key={p.id} href={`/explore/${p.id}`} className="tile reveal in">
                      <div className="tile-cover" style={{ aspectRatio: "0.77", background: bg }}>
                        {p.type === "video" && <span className="play-orb">▶</span>}
                        <span className="tile-badge">
                          {p.type === "video" ? "VIDEO" : p.cat || "作品"}
                        </span>
                        <span className="like" data-liked={p.liked ? "true" : "false"}>
                          ♥ {fmt(p.likes)}
                        </span>
                        <div className="tile-shade" />
                        <div className="tile-meta">
                          <div className="tt">{p.title}</div>
                          <div className="tb">
                            <span className="mono">{p.model || "—"}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {hasMore && (
              <div style={{ textAlign: "center", marginTop: 24 }}>
                <button
                  type="button"
                  className="more-btn"
                  disabled={loading}
                  onClick={() => loadPage(page + 1)}
                >
                  {loading ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
