"use client";

/* ============================================================================
   WorkDetailBody — the shared 作品详情 content (media column + info column),
   used by BOTH the quick-view modal (<WorkModal/>) and the standalone detail
   page (/explore/[id]). Self-contained: it owns the like / bookmark / follow /
   comment state and calls the real community API.

   Rendered inside a `.modal` container by the caller (the modal wraps it in a
   `.mask`; the page renders it in a centered page section). Uses the liuguang
   modal markup classes (.modal-media / .modal-side / .pblock / .pgrid …) plus a
   few new comment/share classes added to pages.css.
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { CommentVO, PostDetailVO } from "@/types/community";
import { useAuthStore } from "@/stores/use-auth-store";
import { Avatar } from "@/components/flux/atoms";
import { toast } from "@/components/shared/toast";
import { mesh } from "@/lib/mesh";
import { fmt } from "@/mock";

/** A profile link for a real user id, or null for the missing-author sentinel
 *  (idgen 0 → "0") so we don't render a dead /user/0 link. */
function userHref(id: string): string | null {
  return id && id !== "0" ? `/user/${id}` : null;
}

/** Deterministic mesh-hue triplet seeded from a post id (cover fallback). */
function coverFallback(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** RFC3339 → short "YYYY.MM.DD HH:mm" (or "" when unparseable). */
function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Download a media URL as a file (blob fetch; falls back to a new tab on CORS). */
async function downloadMedia(url: string, name: string): Promise<void> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("fetch failed");
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export interface WorkDetailBodyProps {
  detail: PostDetailVO;
  /** When provided, a ✕ close button is shown (modal usage). */
  onClose?: () => void;
  /** Fired after a confirmed like toggle so the originating card/list can sync. */
  onEngagementChange?: (e: { id: string; liked: boolean; likes: number }) => void;
}

export default function WorkDetailBody({ detail, onClose, onEngagementChange }: WorkDetailBodyProps) {
  const router = useRouter();
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const isVid = detail.type === "video";
  const cover = detail.cover || detail.thumbnail || "";
  const coverBgVal = cover ? `center / cover no-repeat url("${cover}")` : coverFallback(detail.id);
  const canZoom = !!cover && !isVid;

  // engagement state (seeded from the detail, then driven by the API).
  const [liked, setLiked] = useState(detail.liked);
  const [likes, setLikes] = useState(detail.likes);
  const [bookmarked, setBookmarked] = useState(detail.bookmarked);
  const [following, setFollowing] = useState(detail.following);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);

  // comments
  const [comments, setComments] = useState<CommentVO[]>([]);
  const [commentCount, setCommentCount] = useState(detail.comments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  // re-seed when the detail changes (modal reused for a different work). Comments
  // are cleared here too so a reused body never flashes the previous post's
  // comments before the [detail.id] effect refetches them.
  useEffect(() => {
    setLiked(detail.liked);
    setLikes(detail.likes);
    setBookmarked(detail.bookmarked);
    setFollowing(detail.following);
    setCommentCount(detail.comments);
    setComments([]);
    setZoom(false);
  }, [detail]);

  // load comments for this post.
  useEffect(() => {
    let cancelled = false;
    communityApi.comments(detail.id, { pageNum: 1, pageSize: 50 }).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setComments(res.data.records);
    });
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  const prompt =
    detail.prompt || `${detail.title}，${detail.model || "AI"} 生成，高清细节，电影级布光`;
  const neg = detail.negPrompt || "低质量, 模糊, 多余肢体, 水印, 畸变, 文字";
  const sampler = detail.sampler || "DPM++ 2M Karras";
  const steps = detail.steps || 30;
  const cfg = detail.cfgScale || 7.5;
  const size = detail.size || "1024×1536";
  const seed = detail.seed ? String(detail.seed) : "—";

  const goCreate = () => {
    try {
      sessionStorage.setItem("flux_prompt", detail.prompt || detail.title);
      if (detail.model) sessionStorage.setItem("flux_model", detail.model);
    } catch {
      /* sessionStorage may be unavailable */
    }
    toast.info("已带入参数 · 前往创作台");
    router.push("/studio");
  };

  const toggleLike = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      if (!(await ensureSession())) throw new Error("no session");
      const res = next ? await communityApi.like(detail.id) : await communityApi.unlike(detail.id);
      if (res.success && res.data) {
        setLiked(res.data.liked);
        setLikes(res.data.likeCount);
        onEngagementChange?.({ id: detail.id, liked: res.data.liked, likes: res.data.likeCount });
      } else throw new Error(res.message);
    } catch {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error("操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }, [busy, liked, detail.id, ensureSession, onEngagementChange]);

  const toggleBookmark = useCallback(async () => {
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    try {
      if (!(await ensureSession())) throw new Error("no session");
      const res = next
        ? await communityApi.bookmark(detail.id)
        : await communityApi.unbookmark(detail.id);
      if (res.success && res.data) setBookmarked(res.data.bookmarked);
      else throw new Error(res.message);
      toast.success(next ? "已收藏" : "已取消收藏");
    } catch {
      setBookmarked(!next);
      toast.error("操作失败，请稍后重试");
    }
  }, [bookmarked, detail.id, ensureSession]);

  const toggleFollow = useCallback(async () => {
    const next = !following;
    setFollowing(next); // optimistic
    try {
      if (!(await ensureSession())) throw new Error("no session");
      const res = next
        ? await communityApi.follow(detail.author.id)
        : await communityApi.unfollow(detail.author.id);
      if (!res.success) throw new Error(res.message);
      toast.success(next ? `已关注 ${detail.author.name}` : "已取消关注");
    } catch {
      setFollowing(!next);
      toast.error("操作失败，请稍后重试");
    }
  }, [following, detail.author.id, detail.author.name, ensureSession]);

  const onDownload = () => {
    if (!cover) {
      toast.info("该作品暂无可下载文件");
      return;
    }
    downloadMedia(cover, `${detail.title || "work"}-${detail.id}${isVid ? ".mp4" : ".png"}`);
  };

  const onShare = async () => {
    const link =
      typeof window !== "undefined" ? `${window.location.origin}/explore/${detail.id}` : "";
    try {
      await navigator.clipboard?.writeText(link);
      toast.success("链接已复制");
    } catch {
      toast.info(link);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard?.writeText(prompt);
      toast.success("提示词已复制");
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const submitComment = useCallback(async () => {
    const v = draft.trim();
    if (!v || posting) return;
    setPosting(true);
    try {
      if (!(await ensureSession())) {
        toast.error("请先登录后再评论");
        return;
      }
      const res = await communityApi.createComment(detail.id, { content: v });
      if (res.success && res.data) {
        setComments((prev) => [res.data, ...prev]);
        setCommentCount((n) => n + 1);
        setDraft("");
      } else {
        toast.error(res.message || "评论失败");
      }
    } finally {
      setPosting(false);
    }
  }, [draft, posting, detail.id, ensureSession]);

  return (
    <>
      <div className="modal-media">
        {isVid && detail.videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="cov"
            src={detail.videoUrl}
            poster={cover || undefined}
            controls
            playsInline
            preload="metadata"
            style={{ objectFit: "cover", background: cover ? undefined : coverBgVal }}
          />
        ) : (
          <div
            className="cov"
            style={{ background: coverBgVal, ...(canZoom ? { cursor: "zoom-in" } : {}) }}
            onClick={canZoom ? () => setZoom(true) : undefined}
            role={canZoom ? "button" : undefined}
            aria-label={canZoom ? "放大查看" : undefined}
          />
        )}
        {/* play-orb only on a still poster (no inline player) */}
        {isVid && !detail.videoUrl && <span className="play-orb">▶</span>}
        {onClose && (
          <button type="button" className="modal-x" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      <div className="modal-side">
        <h3 className="mt">{detail.title}</h3>

        <div className="modal-author">
          {(() => {
            const href = userHref(detail.author.id);
            const inner = (
              <>
                <Avatar name={detail.author.name} size={42} className="av" />
                <div>
                  <div className="an">{detail.author.name}</div>
                  <div className="as">
                    {fmt(likes)} 喜欢 · {fmt(detail.views)} 浏览 · {detail.cat || "作品"}
                  </div>
                </div>
              </>
            );
            return href ? (
              <Link href={href} className="modal-author-link" aria-label="查看作者">
                {inner}
              </Link>
            ) : (
              <div className="modal-author-link">{inner}</div>
            );
          })()}
          <button
            type="button"
            className={`foll${following ? " on" : ""}`}
            onClick={toggleFollow}
          >
            {following ? "已关注" : "+ 关注"}
          </button>
        </div>

        <div className="pblock">
          <div className="pl">
            提示词{" "}
            <button type="button" onClick={copyPrompt}>
              复制
            </button>
          </div>
          <div className="pv">{prompt}</div>
        </div>

        <div className="pblock">
          <div className="pl">反向提示词</div>
          <div className="pv">{neg}</div>
        </div>

        <div className="pgrid">
          <div className="pcell">
            <div className="k">模型</div>
            <div className="v">{(detail.model || "—").split(" ")[0]}</div>
          </div>
          <div className="pcell">
            <div className="k">采样器</div>
            <div className="v">{sampler.split(" ")[0]}</div>
          </div>
          <div className="pcell">
            <div className="k">步数</div>
            <div className="v">{steps}</div>
          </div>
          <div className="pcell">
            <div className="k">CFG</div>
            <div className="v">{cfg}</div>
          </div>
          <div className="pcell">
            <div className="k">尺寸</div>
            <div className="v">{size}</div>
          </div>
          <div className="pcell">
            <div className="k">种子</div>
            <div className="v">{seed.slice(0, 10)}</div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="pri" onClick={goCreate}>
            ✦ 生成同款
          </button>
          <button
            type="button"
            className="sec"
            data-on={liked ? "true" : "false"}
            aria-label="点赞"
            title="点赞"
            onClick={toggleLike}
          >
            ♥ {fmt(likes)}
          </button>
          <button
            type="button"
            className="sec"
            data-on={bookmarked ? "true" : "false"}
            aria-label="收藏"
            title="收藏"
            onClick={toggleBookmark}
          >
            {bookmarked ? "★" : "☆"}
          </button>
          <button type="button" className="sec" aria-label="下载" title="下载" onClick={onDownload}>
            ⤓
          </button>
          <button type="button" className="sec" aria-label="分享" title="分享链接" onClick={onShare}>
            ⤴
          </button>
        </div>

        {/* comments */}
        <div className="cmt-block">
          <div className="cmt-h">评论 · {fmt(commentCount)}</div>
          <div className="cmt-new">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="友善地说点什么…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitComment();
                }
              }}
            />
            <button type="button" onClick={submitComment} disabled={posting || !draft.trim()}>
              发表
            </button>
          </div>
          <div className="cmt-list">
            {comments.length === 0 ? (
              <div className="cmt-empty">还没有评论，来抢沙发 ✦</div>
            ) : (
              comments.map((c) => {
                const href = userHref(c.author.id);
                return (
                <div key={c.id} className="cmt">
                  {href ? (
                    <Link href={href} aria-label="查看作者">
                      <Avatar name={c.author.name} size={32} className="cmt-av" />
                    </Link>
                  ) : (
                    <Avatar name={c.author.name} size={32} className="cmt-av" />
                  )}
                  <div className="cmt-body">
                    <div className="cmt-top">
                      <span className="cmt-name">{c.author.name}</span>
                      <span className="cmt-time">{fmtTime(c.createTime)}</span>
                    </div>
                    <div className="cmt-text">{c.content}</div>
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {zoom && cover && (
        <div className="modal-zoom" onClick={() => setZoom(false)}>
          <button type="button" className="modal-zoom-x" aria-label="关闭" onClick={() => setZoom(false)}>
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={detail.title} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
