"use client";

/* ============================================================================
   HomePricing — React port of renderPricing() from
   design-ref/liuguang/home-render.js. Bill-cycle toggle (年付/月付) over the
   real subscription plans (PlanVO from GET /api/billing/plans, passed via
   `plans`). Uses the liuguang .bill-toggle / .plans / .plan[.feat] / .plan-tag /
   .plan-name / .plan-desc / .plan-price / .plan-cta / .plan-feats classes.

   CTA wiring: the free plan (monthly === 0) → /studio (开始创作); paid plans →
   /pricing (查看完整方案与对比).
   ========================================================================== */

import Link from "next/link";
import { useState } from "react";
import type { PlanVO } from "@/types/billing";

type Cycle = "yr" | "mo";

/** Render a CNY price, dropping trailing ".00" so ¥29.00 reads ¥29. */
function money(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export default function HomePricing({
  plans,
  loading,
}: {
  plans: PlanVO[];
  loading: boolean;
}) {
  const [cycle, setCycle] = useState<Cycle>("yr");

  if (loading) {
    return (
      <div className="sec-sub" style={{ textAlign: "center", padding: "40px 0" }}>
        正在加载价格方案…
      </div>
    );
  }

  if (!plans.length) {
    return (
      <div className="sec-sub" style={{ textAlign: "center", padding: "40px 0" }}>
        价格方案即将上线，敬请期待。
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 34 }}>
        <div className="bill-toggle reveal" id="home-bill">
          <button
            type="button"
            className={cycle === "yr" ? "on" : ""}
            onClick={() => setCycle("yr")}
          >
            年付 <span className="save">省 42%</span>
          </button>
          <button
            type="button"
            className={cycle === "mo" ? "on" : ""}
            onClick={() => setCycle("mo")}
          >
            月付
          </button>
        </div>
      </div>

      <div className="plans" id="home-plans">
        {plans.map((p, i) => {
          const isFree = p.monthly === 0;
          const price = cycle === "yr" ? p.yearly : p.monthly;
          const per = isFree
            ? "永久免费"
            : cycle === "yr"
              ? "/ 月（年付）"
              : "/ 月";
          const num = isFree ? "¥0" : "¥" + money(price);
          const href = isFree ? "/studio" : "/pricing";
          return (
            <div
              key={p.id}
              className={`plan ${p.featured ? "feat" : ""} reveal`}
              style={{ ["--rd" as string]: `${i * 0.06}s` }}
            >
              {p.featured && <span className="plan-tag">最受欢迎</span>}
              <div className="plan-name">{p.name}</div>
              <div className="plan-desc">{p.desc}</div>
              <div className="plan-price">
                <span className="num">{num}</span>
                <span className="per">{per}</span>
              </div>
              <Link
                className={`plan-cta ${p.featured ? "solid" : "ghost"}`}
                href={href}
              >
                {p.cta}
              </Link>
              <ul className="plan-feats">
                {p.items.map((it) => (
                  <li key={it}>
                    <span className="ck">✓</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
