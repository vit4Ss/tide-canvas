"use client";

/* ============================================================================
   ModelMarquee — React port of FX.renderMarquee() from
   design-ref/liuguang/shell.js. Two .mq-line rows of .mq-chip model names; each
   row's chips are duplicated so the CSS translateX(-50%) loop is seamless (the
   second line reverses + slows via flux.css).

   Now driven by REAL market models (ModelLiteVO from GET /api/home/feed) passed
   in via `models`. Chip labels are the model names; if the feed returns none we
   render nothing (the marquee section is purely decorative social-proof).
   ========================================================================== */

import type { ModelLiteVO } from "@/types/content";

export default function ModelMarquee({ models }: { models: ModelLiteVO[] }) {
  const names = models.map((m) => m.name).filter(Boolean);
  if (!names.length) return null;

  const half = Math.ceil(names.length / 2);
  const lines = [names.slice(0, half), names.slice(half)];

  return (
    <div className="mq-wrap">
      <div className="mq-label">由业界顶级模型驱动 · POWERED BY</div>
      <div className="mq-row" id="marquee">
        {lines.map((arr, li) => (
          <div className="mq-line" key={li}>
            <div className="mq-track">
              {arr.concat(arr).map((n, i) => (
                <span className="mq-chip" key={`${n}-${i}`}>
                  <i />
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
