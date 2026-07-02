"use client";

/* ============================================================================
   ModelMarquee — React port of FX.renderMarquee() from
   design-ref/liuguang/shell.js. Two .mq-line rows of model cards; each row's
   cards are duplicated so the CSS translateX(-50%) loop is seamless (the
   second line reverses + slows via flux.css).

   Now driven by REAL market models (ModelLiteVO from GET /api/home/feed) passed
   in via `models`. Each card carries the model's logo (coverUrl, else a
   deterministic letter swatch), first tag and 调用量 — click lands on /models.
   If the feed returns none we render nothing (purely decorative social-proof).
   ========================================================================== */

import Link from "next/link";
import { fmt } from "@/mock";
import type { ModelLiteVO } from "@/types/content";

/** Deterministic brand-ish gradient for models without a logo. */
function swGrad(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 56%), hsl(${(h + 52) % 360} 72% 50%))`;
}

export default function ModelMarquee({ models }: { models: ModelLiteVO[] }) {
  const pool = models.filter((m) => m.name);
  if (!pool.length) return null;

  const half = Math.ceil(pool.length / 2);
  // 每行至少 8 张卡，不足时循环补齐——避免模型少时跑马灯出现空档
  const pad = (arr: ModelLiteVO[]) => {
    let out = arr.length ? arr.slice() : pool.slice();
    while (out.length < 8) out = out.concat(out);
    return out;
  };
  const lines = [pad(pool.slice(0, half)), pad(pool.slice(half))];

  return (
    <div className="mq-wrap">
      <div className="mq-head">
        <span className="mq-eyebrow">POWERED BY</span>
        <h3 className="mq-title">
          由业界<span className="gtext">顶级模型</span>驱动
        </h3>
        <Link className="mq-more" href="/models">
          浏览模型市场 →
        </Link>
      </div>
      <div className="mq-row" id="marquee">
        {lines.map((arr, li) => (
          <div className="mq-line" key={li}>
            <div className="mq-track">
              {arr.concat(arr).map((m, i) => (
                <Link className="mq-chip" href="/models" key={`${m.id}-${i}`}>
                  <span
                    className="sw"
                    style={
                      m.coverUrl
                        ? { backgroundImage: `url(${m.coverUrl})` }
                        : { background: swGrad(m.name) }
                    }
                  >
                    {m.coverUrl ? "" : m.name[0].toUpperCase()}
                  </span>
                  <b>{m.name}</b>
                  {m.tags?.[0] && <em>{m.tags[0]}</em>}
                  {m.useCount > 0 && (
                    <span className="uc">{fmt(m.useCount)} 次调用</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
