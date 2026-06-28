"use client";

/* ============================================================================
   作品详情 · standalone page (/explore/[id]) — a shareable, linkable view of one
   community work. Renders the SAME <WorkDetailBody/> the quick-view modal uses,
   in a static page layout (no overlay). Direct URL load + refresh both work.
   ========================================================================== */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { communityApi } from "@/lib/community-api";
import type { PostDetailVO } from "@/types/community";
import WorkDetailBody from "@/components/site/work-detail";

export default function WorkDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [detail, setDetail] = useState<PostDetailVO | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
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

  return (
    <section className="block" style={{ paddingTop: 30 }}>
      <div className="wrap">
        <Link href="/explore" className="work-back">
          ← 返回作品广场
        </Link>

        {state === "loading" && (
          <div className="empty" style={{ display: "block" }}>
            正在加载作品… ✦
          </div>
        )}
        {state === "error" && (
          <div className="empty" style={{ display: "block" }}>
            作品不存在或已下架 ✦
          </div>
        )}
        {state === "ok" && detail && (
          <div className="work-page">
            <WorkDetailBody detail={detail} />
          </div>
        )}
      </div>
    </section>
  );
}
