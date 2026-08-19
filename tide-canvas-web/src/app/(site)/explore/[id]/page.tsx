"use client";

/* ============================================================================
   作品详情 · standalone page (/explore/[id]) — a shareable, linkable view of one
   community work. Renders the SAME fullscreen <WorkDetailBody/> the quick-view
   uses（imini 式独立界面，fixed 全屏覆盖站点壳）。Direct URL load + refresh
   both work; 关闭 = 返回作品广场（有来路则后退）。
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { PostDetailVO } from "@/types/community";
import WorkDetailBody from "@/components/site/work-detail";

export default function WorkDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [detail, setDetail] = useState<PostDetailVO | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a route-id change must synchronously replace the previous request state with its loading state.
    setState("loading");
    communityApi.get(id).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setDetail(res.data);
        setState("ok");
      } else {
        setState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/explore");
  }, [router]);

  if (state === "ok" && detail) {
    return <WorkDetailBody detail={detail} onClose={close} />;
  }

  return (
    <section className="block" style={{ paddingTop: 30 }}>
      <div className="wrap">
        <Link href="/explore" className="work-back">
          ← 返回作品广场
        </Link>
        <div className="empty" style={{ display: "block" }}>
          {state === "loading" ? "正在加载作品… ✦" : "作品不存在或已下架 ✦"}
        </div>
      </div>
    </section>
  );
}
