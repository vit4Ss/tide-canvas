"use client";

/* ============================================================================
   WorkTile — 社区作品瀑布流卡片（自 explore/page.tsx 的本地 Tile 抽出共享，
   供「作品优先」首页与后续页面复用；explore 页暂保留自己的副本，待回归
   验证后再切到本组件统一）。

   封面用真实 URL，缺失时回退确定性 mesh 渐变；♥ 点赞乐观更新并在失败时
   回滚（点赞需要会话，onToggleLike 由调用方传 ensureSession）。
   ========================================================================== */

import Link from "next/link";
import { useEffect, useState } from "react";
import { communityApi } from "@/lib/community-api";
import type { PostVO } from "@/types/community";
import { mesh } from "@/lib/mesh";
import type { Artwork, MeshHues } from "@/mock";
import { fmt } from "@/mock";
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
  const [liked, setLiked] = useState(art.liked);
  const [likes, setLikes] = useState(art.likes);
  const [busy, setBusy] = useState(false);

  // 父级更新该作品时同步本地点赞态（如在详情弹窗里点了赞）。
  useEffect(() => setLiked(art.liked), [art.liked]);
  useEffect(() => setLikes(art.likes), [art.likes]);

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
