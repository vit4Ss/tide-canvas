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
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { fmt } from "@/mock";
import { matchBrandIcon } from "@/lib/model-brand";
import { grayscaleSwatch } from "@/lib/swatch";
import type { ModelLiteVO } from "@/types/content";

/** Deterministic brand-ish gradient for models without a logo. */
const swGrad = (seed: string): string => grayscaleSwatch(seed);

export default function ModelMarquee({ models }: { models: ModelLiteVO[] }) {
  // swatch 每模型只算一遍：concat 复制后同一模型要渲染 2~4 次，matchBrandIcon 又是
  // 一组正则，memo 掉避免父级每次重渲染都全量重算。
  const swatches = useMemo(() => {
    const map = new Map<string, { style: CSSProperties; letter: string }>();
    for (const m of models) {
      if (!m.name || map.has(m.id)) continue;
      // 图标三级回退（与创作台/对话页一致）：接口封面 → 品牌官方 logo → 字母灰阶兜底。
      // 品牌 logo 是黑图形配透明底，必须衬白底 + contain，直接铺在暗色芯片上会隐形。
      const brand = m.coverUrl ? null : matchBrandIcon(m.name);
      map.set(
        m.id,
        m.coverUrl
          ? { style: { backgroundImage: `url(${m.coverUrl})`, backgroundSize: "cover" }, letter: "" }
          : brand
            ? {
                style: {
                  background: `#fff center/66% no-repeat url(${brand})`,
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)",
                },
                letter: "",
              }
            : { style: { background: swGrad(m.name) }, letter: m.name[0].toUpperCase() },
      );
    }
    return map;
  }, [models]);

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
              {arr.concat(arr).map((m, i) => {
                const sw = swatches.get(m.id) ?? {
                  style: { background: swGrad(m.name) },
                  letter: m.name[0].toUpperCase(),
                };
                return (
                <Link className="mq-chip" href="/models" key={`${m.id}-${i}`}>
                  <span className="sw" style={sw.style}>
                    {sw.letter}
                  </span>
                  <b>{m.name}</b>
                  {m.tags?.[0] && <em>{m.tags[0]}</em>}
                  {m.useCount > 0 && (
                    <span className="uc">{fmt(m.useCount)} 次调用</span>
                  )}
                </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
