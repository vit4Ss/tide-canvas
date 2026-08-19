"use client";

/* ============================================================================
   WorkModal — 作品快速查看（全屏查看器宿主）。Given a postId it fetches the
   full detail (communityApi.get) and renders the fullscreen <WorkDetailBody/>
   (imini 式独立界面；Esc/滚动锁定/键盘翻页由查看器自包含)。A shareable
   standalone page lives at /explore/[id] (same body).

   - Controlled: parent passes `postId` (open while non-null) + `onClose`.
   - Optional onPrev/onNext enable 翻页箭头 + ←/→ (the opening list supplies
     neighbours).
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import type { PostDetailVO } from "@/types/community";
import { toast } from "@/components/shared/toast";
import WorkDetailBody from "@/components/site/work-detail";
import "./work-viewer.css";

export interface WorkModalProps {
  /** The post id to show; modal is open while this is non-null. */
  postId: string | null;
  onClose: () => void;
  /** 上一件 / 下一件（提供时查看器显示翻页箭头并响应 ←/→）。 */
  onPrev?: () => void;
  onNext?: () => void;
}

export default function WorkModal({ postId, onClose, onPrev, onNext }: WorkModalProps) {
  const [detail, setDetail] = useState<PostDetailVO | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep onClose in a ref so the fetch effect below DOESN'T re-run every time
  // the parent re-renders (inline arrows change identity each render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // fetch the detail whenever the target post changes. 翻页时保留上一件的
  // detail 以免整屏闪白 —— 加载新详情期间只叠加载指示。
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- postId is the request key: close clears stale detail, while navigation keeps the previous detail under a loading overlay. */
    if (!postId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [postId]);

  if (!postId) return null;

  if (!detail) {
    return (
      <div className="wv" role="dialog" aria-modal="true">
        <div className="wv-loading">
          <Loader2 className="h-5 w-5 animate-spin" /> 正在加载作品…
        </div>
      </div>
    );
  }

  return (
    <>
      <WorkDetailBody detail={detail} onClose={onClose} onPrev={onPrev} onNext={onNext} />
      {loading && (
        <div className="wv" style={{ background: "transparent", backdropFilter: "none", pointerEvents: "none" }}>
          <div className="wv-loading">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </div>
      )}
    </>
  );
}
