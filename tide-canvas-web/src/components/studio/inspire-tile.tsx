"use client";

/* ============================================================================
   InspireTile — React port of FX.tileHTML + FX.bindTiles (shell.js), scoped to
   the 灵感 (Inspire) masonry feed.

   Renders the canonical liuguang tile markup (.tile / .tile-cover / .tile-badge
   / .like / .tile-shade / .tile-meta / .tt / .tb / .remix) so the shared styles
   in flux.css apply unchanged. Covers are MeshHues triplets → coverBg(art.cover).

   - Click the tile  → onOpen (opens the shared <WorkModal/>, FX.openWork).
   - Click 生成同款   → onRemix (carries the prompt to /studio, FX bindTiles).
   - Click ♥         → toggles the local liked state (no persistence — original
                       bindTiles only flips the data-liked attribute).
   ========================================================================== */

import { useState } from "react";
import type { Artwork } from "@/mock";
import { coverBg, fmt } from "@/mock";

export interface InspireTileProps {
  art: Artwork;
  /** reveal stagger delay in seconds (--rd). */
  delay: number;
  onOpen: () => void;
  onRemix: () => void;
}

export default function InspireTile({
  art,
  delay,
  onOpen,
  onRemix,
}: InspireTileProps) {
  // shell.js seeds the heart "on" for popular works (likes > 8000).
  const [liked, setLiked] = useState(art.likes > 8000);

  return (
    <article
      className="tile reveal in"
      style={{ ["--rd" as string]: `${delay}s` }}
      onClick={onOpen}
    >
      <div
        className="tile-cover"
        style={{
          aspectRatio: (1 / art.h).toFixed(3),
          background: coverBg(art.cover),
        }}
      >
        {art.type === "video" && <span className="play-orb">▶</span>}
        <span className="tile-badge">
          {art.type === "video" ? "VIDEO" : art.cat}
        </span>
        <button
          type="button"
          className="like"
          data-liked={liked ? "true" : "false"}
          onClick={(e) => {
            e.stopPropagation();
            setLiked((v) => !v);
          }}
        >
          ♥ {fmt(art.likes)}
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
