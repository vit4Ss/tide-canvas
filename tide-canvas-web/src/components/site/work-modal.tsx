"use client";

/* ============================================================================
   WorkModal — quick-view dialog for a community work. Given a postId it fetches
   the full detail (communityApi.get) and renders the shared <WorkDetailBody/>
   inside the liuguang `.mask`/`.modal` shell. A shareable standalone page lives
   at /explore/[id] (same body), reachable via the 在新页打开 link.

   - Controlled: parent passes `postId` (open while non-null) + `onClose`.
   - Backdrop click + Escape close; body scroll lock while open.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { PostDetailVO } from "@/types/community";
import { toast } from "@/components/shared/toast";
import WorkDetailBody from "@/components/site/work-detail";

export interface WorkModalProps {
  /** The post id to show; modal is open while this is non-null. */
  postId: string | null;
  onClose: () => void;
  /** Fired after a confirmed like toggle so the opening list can sync its card. */
  onEngagementChange?: (e: { id: string; liked: boolean; likes: number }) => void;
}

export default function WorkModal({ postId, onClose, onEngagementChange }: WorkModalProps) {
  const open = !!postId;
  const [detail, setDetail] = useState<PostDetailVO | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep onClose in a ref so the fetch/Escape effects below DON'T re-run every
  // time the parent re-renders (the parent's inline `onClose` arrow changes
  // identity — e.g. the explore page re-renders on a 2s live-counter tick, which
  // would otherwise refetch the detail and wipe the user's state on a loop).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // fetch the detail whenever the target post changes.
  useEffect(() => {
    if (!postId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    communityApi.get(postId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.success && res.data) setDetail(res.data);
      else {
        toast.error("作品详情加载失败");
        onCloseRef.current();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Escape + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [open]);

  if (!postId) return null;

  return (
    <div
      className="mask show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {loading || !detail ? (
          <div className="modal-loading">正在加载作品… ✦</div>
        ) : (
          <>
            <WorkDetailBody detail={detail} onClose={onClose} onEngagementChange={onEngagementChange} />
            <Link className="modal-openpage" href={`/explore/${detail.id}`}>
              在新页打开 ↗
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
