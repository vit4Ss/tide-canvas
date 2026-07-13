"use client";

/* ============================================================================
   PromoBanner — 定价页「限时折扣」横幅（参考 imini 促销条：左侧标签 + 标题 +
   副标题，右侧 天/时/分/秒 倒计时）。

   内容来自 GET /api/billing/promo（后台「价格管理 · 限时折扣横幅」配置）：
   enabled=false、标题为空、endsAt 非法或倒计时到点时整体隐藏，无需手动下线。
   ========================================================================== */

import { useEffect, useState } from "react";
import { billingApi } from "@/lib/billing-api";
import type { PromoVO } from "@/types/billing";

const pad = (n: number) => String(n).padStart(2, "0");

export default function PromoBanner() {
  const [promo, setPromo] = useState<PromoVO | null>(null);
  // 首帧不渲染（left=0 即隐藏）：拿到配置并起跳后才显示，避免 hydration 抖动
  const [left, setLeft] = useState(0);

  useEffect(() => {
    let alive = true;
    billingApi.promo().then((res) => {
      if (alive && res.success && res.data?.enabled && res.data.title) {
        setPromo(res.data);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!promo) return;
    const end = new Date(promo.endsAt).getTime();
    if (!Number.isFinite(end)) return;
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [promo]);

  if (!promo || left <= 0) return null;

  const s = Math.floor(left / 1000);
  const cells = [
    { v: pad(Math.floor(s / 86400)), l: "天" },
    { v: pad(Math.floor((s % 86400) / 3600)), l: "小时" },
    { v: pad(Math.floor((s % 3600) / 60)), l: "分钟" },
    { v: pad(s % 60), l: "秒" },
  ];

  return (
    <div className="promo">
      <div>
        {promo.tag && (
          <span className="promo-tag">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
              <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
            {promo.tag}
          </span>
        )}
        <div className="promo-title">{promo.title}</div>
        {promo.subtitle && <div className="promo-sub">{promo.subtitle}</div>}
      </div>
      <div className="promo-count" role="timer" aria-label="距活动结束">
        {cells.map((c) => (
          <div className="promo-cell" key={c.l}>
            <div className="v">{c.v}</div>
            <div className="l">{c.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
