"use client";

/* ============================================================================
   WorkTile — 社区作品瀑布流卡片（唯一实现，explore 等页面共用；原 explore
   本地 Tile 副本已删除）。

   封面用真实 URL，缺失时回退确定性 mesh 渐变；♥ 点赞乐观更新并在失败时
   回滚（点赞需要会话，onToggleLike 由调用方传 ensureSession）。
   ========================================================================== */

import Link from "next/link";
import { useState } from "react";
import { communityApi } from "@/lib/community-api";
import type { PostVO } from "@/types/community";
import { mesh, type MeshHues } from "@/lib/mesh";
import type { Artwork } from "@/types/artwork";
import { fmt } from "@/lib/utils";
import { toast } from "@/components/shared/toast";

/** 由作品 id 派生确定性 mesh 色相三元组（无封面时的渐变回退）。 */
function hues(id: string): MeshHues {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return [h, (h + 132) % 360, (h + 248) % 360];
}

/** 确定性纵横比,让瀑布流有自然节奏;视频固定横幅。 */
const H_STEPS = [1.05, 1.2, 1.33, 1.5] as const;
function tileH(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) % 9973;
  return H_STEPS[h % H_STEPS.length];
}

export type ArtworkX = Artwork & {
  coverUrl: string;
  likes: number;
  liked: boolean;
  authorId: string;
};

/** 后端 PostVO → 共享卡片/弹窗期望的 Artwork 形状。 */
export function toArtwork(p: PostVO): ArtworkX {
  return {
    id: p.id,
    cover: hues(p.id),
    h: p.type === "video" ? 0.75 : tileH(p.id),
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

export default function WorkTile({
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
  const [likeOverride, setLikeOverride] = useState<{
    artworkId: string;
    sourceLiked: boolean;
    sourceLikes: number;
    liked: boolean;
    likes: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // 乐观值只在其来源 props 仍有效时生效；父级刷新点赞数据后自动回落到新 props。
  const hasCurrentOverride =
    likeOverride?.artworkId === art.id &&
    likeOverride.sourceLiked === art.liked &&
    likeOverride.sourceLikes === art.likes;
  const liked = hasCurrentOverride ? likeOverride.liked : art.liked;
  const likes = hasCurrentOverride ? likeOverride.likes : art.likes;

  const cover = art.coverUrl
    ? `center / cover no-repeat url("${art.coverUrl}")`
    : mesh(art.cover[0], art.cover[1], art.cover[2]);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !liked;
    const setOptimisticLike = (nextLiked: boolean, nextLikes: number) => {
      setLikeOverride({
        artworkId: art.id,
        sourceLiked: art.liked,
        sourceLikes: art.likes,
        liked: nextLiked,
        likes: nextLikes,
      });
    };
    setOptimisticLike(next, likes + (next ? 1 : -1));
    try {
      const ok = await onToggleLike();
      if (!ok) throw new Error("no session");
      const res = next
        ? await communityApi.like(art.id)
        : await communityApi.unlike(art.id);
      if (res.success && res.data) {
        setOptimisticLike(res.data.liked, res.data.likeCount);
      } else {
        throw new Error(res.message);
      }
    } catch {
      setLikeOverride(null);
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
