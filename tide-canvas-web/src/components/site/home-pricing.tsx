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

  // 年付节省比例由真实套餐价推导（yearly = 一年总价，折合月价 = yearly/12）
  const savePct = (() => {
    const paid = plans.filter((p) => Number(p.monthly) > 0 && Number(p.yearly) > 0);
    if (!paid.length) return 0;
    const best = Math.max(
      ...paid.map((p) => 1 - Number(p.yearly) / 12 / Number(p.monthly)),
    );
    return Math.round(best * 100);
  })();

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
            年付 {savePct > 0 && <span className="save">省 {savePct}%</span>}
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

      <div
        className="plans"
        id="home-plans"
        style={
          {
            // 列数=套餐数，全部卡片保持一行（≤900px 由媒体查询回落单列）
            "--plan-cols": Math.max(plans.length, 1),
          } as React.CSSProperties
        }
      >
        {plans.map((p, i) => {
          const isFree = p.monthly === 0;
          // 未配年付价的套餐在年付档回落月付展示（与定价页同口径）。
          const yr = cycle === "yr" && Number(p.yearly) > 0;
          // 年付主价 = 折合月价（yearly/12），旁边划线展示月付原价（与定价页同语言）。
          const eff = yr
            ? Math.round((Number(p.yearly) / 12) * 100) / 100
            : Number(p.monthly);
          const per = isFree ? "永久免费" : "/ 月";
          const num = isFree ? "¥0" : "¥" + money(eff);
          const href = isFree ? "/studio" : "/pricing";
          const orig = Number(p.monthly);
          const showOrig = !isFree && yr && Number(p.yearly) > 0 && orig > eff;
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
                {showOrig && (
                  <span
                    style={{
                      fontSize: 15,
                      color: "var(--text-faint)",
                      textDecoration: "line-through",
                    }}
                  >
                    ¥{money(orig)}
                  </span>
                )}
                <span className="per">{per}</span>
              </div>
              {!isFree && yr && Number(p.yearly) > 0 && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-faint)",
                    marginTop: 4,
                  }}
                >
                  按年支付 ¥{money(p.yearly)}
                </div>
              )}
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
