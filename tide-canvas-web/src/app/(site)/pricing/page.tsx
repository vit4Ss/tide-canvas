"use client";

/* ============================================================================
   价格方案 · Pricing — React port of design-ref/定价.html +
   design-ref/liuguang/pricing.js into the (site) route group.

   The (site) layout already renders the WebGL field, nav, footer, and imports
   the liuguang CSS, so this file renders ONLY the page content using the exact
   liuguang class names (.block, .wrap, .sec-head, .bill-toggle, .plans, .plan,
   .cmp, .faq, .price-faq, .cta, …) so the shared styles apply unchanged.

   Dynamic logic ported to idiomatic React:
   - bill cycle toggle (年付 / 月付) → `cycle` state drives plan prices.
   - plans grid from billingApi.plans() (public read; featured plan
     emphasized, CTA → /studio). Backend PlanVO maps to the design's plan
     shape: monthly→mo, yearly→yr, featured→feat, desc/cta/name/items direct.
   - feature comparison table + FAQ accordion are STATIC design content: the
     billing backend exposes no comparison/FAQ equivalents, so CMP_ROWS /
     PRICING_FAQS below are kept inline (not from @/mock DATA) to preserve the
     exact liuguang markup.
   - FAQ accordion (single-open, first open by default).
   ========================================================================== */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { billingApi } from "@/lib/billing-api";
import type { CompareRow, FaqItem, PlanVO } from "@/types/billing";
import { useReveal } from "@/components/site/use-reveal";
import { useAuthStore } from "@/stores/use-auth-store";
import PayModal, { type PurchaseIntent } from "@/components/site/pay-modal";
import PromoBanner from "@/components/site/promo-banner";

type Cycle = "yr" | "mo";

/* Feature comparison table — 列 = 真实套餐（跟随套餐管理的名称/排序/推荐），
   行 = GET /api/billing/compare（后台价格管理可编辑）。
   格子约定："✓" 支持 / "—" 不支持 / 其余按字面文字展示。 */

/* Pricing FAQ — GET /api/billing/faq（后台价格管理可编辑，缺省回落出厂内容）。 */

export default function PricingPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [cycle, setCycle] = useState<Cycle>("yr");
  // First FAQ open by default (matches pricing.js renderFaq()).
  const [openFaq, setOpenFaq] = useState<number>(0);
  // Open pay-method chooser for a chosen paid plan.
  const [payIntent, setPayIntent] = useState<PurchaseIntent | null>(null);

  const requireLogin = () => {
    const loggedIn =
      user != null ||
      (typeof window !== "undefined" && !!localStorage.getItem("access_token"));
    if (!loggedIn) router.push("/login?redirect=/pricing");
    return loggedIn;
  };

  // Plan CTA: free plans go straight to the studio; paid plans require a session
  // then open the pay-method chooser. The order is priced server-side from the
  // chosen cycle（年付 = 一年总价，用户口径 2026-07-12），so the modal mirrors
  // exactly what will be charged.
  const onPlanCta = (p: PlanVO) => {
    if (p.monthly === 0) {
      router.push("/studio");
      return;
    }
    // 已是该档（或更高档）会员：不再进入收银台（服务端下单同样拦截）。
    if (user && p.vipLevel > 0 && (user.vipLevel ?? 0) >= p.vipLevel) {
      return;
    }
    if (!requireLogin()) return;
    const yearly = cycle === "yr" && p.yearly > 0;
    // 活动价（限时折扣）：展示与弹窗金额跟随活动价；实际收款价由服务端
    // 用同一活动判定重算，弹窗只是镜像。
    const promoM = p.promo && p.promo.monthly > 0 ? p.promo.monthly : 0;
    const promoY = p.promo && p.promo.yearly > 0 ? p.promo.yearly : 0;
    const payY = promoY > 0 ? promoY : p.yearly;
    setPayIntent(
      yearly
        ? {
            planId: p.id,
            cycle: "yearly",
            name: `${p.name}（年付）`,
            amount: Math.round(payY * 100) / 100,
            amountNote: `折合 ¥${Math.round((payY / 12) * 100) / 100}/月`,
          }
        : {
            planId: p.id,
            cycle: "monthly",
            name: p.name,
            amount: promoM > 0 ? promoM : p.monthly,
          },
    );
  };

  // Real plan cards from the public billing endpoint. 积分只随套餐发放，
  // 不提供单独充值（产品决策，2026-07）。
  const [plans, setPlans] = useState<PlanVO[]>([]);
  const [cmpRows, setCmpRows] = useState<CompareRow[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 年付节省比例由真实套餐价推导（yearly = 一年总价，折合月价 = yearly/12），
  // 无付费套餐时不显示
  const savePct = (() => {
    const paid = plans.filter((p) => Number(p.monthly) > 0 && Number(p.yearly) > 0);
    if (!paid.length) return 0;
    const best = Math.max(
      ...paid.map((p) => 1 - Number(p.yearly) / 12 / Number(p.monthly)),
    );
    return Math.round(best * 100);
  })();

  useEffect(() => {
    let alive = true;
    // Public reads — no session required.
    billingApi
      .plans()
      .then((res) => {
        if (alive && res.success && res.data) setPlans(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    billingApi.compare().then((res) => {
      if (alive && res.success && res.data?.rows) setCmpRows(res.data.rows);
    });
    billingApi.faq().then((res) => {
      if (alive && res.success && res.data?.items) setFaqs(res.data.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Re-scan reveal targets when the plan markup changes (toggle/load re-renders
  // the .reveal plan cards, mirroring renderPlans() + FX.reveal() in the design).
  useReveal([cycle, plans.length]);

  return (
    <div className="block page-top">
      <div className="wrap">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div
          className="sec-head"
          style={{
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 0,
          }}
        >
          <span className="eyebrow reveal">
            <span className="d" />
            价格方案 · PRICING
          </span>
          <h1
            className="reveal"
            style={{
              fontFamily: "var(--disp)",
              fontSize: "clamp(32px,4.8vw,58px)",
              fontWeight: 800,
              letterSpacing: "-.03em",
              margin: "14px 0 0",
              lineHeight: 1.04,
            }}
          >
            选一个节奏，<span className="gtext">开始创作</span>
          </h1>
          <p
            className="reveal"
            style={{
              fontSize: "15.5px",
              color: "var(--text-dim)",
              margin: "14px 0 0",
              maxWidth: "72ch",
              lineHeight: 1.6,
            }}
          >
            免费开始，无需信用卡。随时升级或取消——你只为真正用到的算力付费。
          </p>
        </div>

        {/* ── Bill cycle toggle ──────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 30 }}>
          <div className="bill-toggle reveal" id="bill">
            <button
              type="button"
              className={cycle === "mo" ? "on" : ""}
              onClick={() => setCycle("mo")}
            >
              月付
            </button>
            <button
              type="button"
              className={cycle === "yr" ? "on" : ""}
              onClick={() => setCycle("yr")}
            >
              年付 {savePct > 0 && <span className="save">省 {savePct}%</span>}
            </button>
          </div>
        </div>

        {/* ── 限时折扣横幅（倒计时到点自动隐藏，配置见 promo-banner.tsx） ── */}
        <PromoBanner />

        {/* ── Plans grid ─────────────────────────────────────────────── */}
        <div
          className="plans"
          id="plans"
          style={
            {
              marginTop: 36,
              // 列数=套餐数，全部卡片保持一行（≤900px 由媒体查询回落单列）
              "--plan-cols": Math.max(plans.length, 1),
            } as React.CSSProperties
          }
        >
          {loading && plans.length === 0 && (
            <p
              className="reveal"
              style={{
                gridColumn: "1 / -1",
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: "15px",
                padding: "40px 0",
              }}
            >
              正在加载方案…
            </p>
          )}

          {!loading && plans.length === 0 && (
            <p
              className="reveal"
              style={{
                gridColumn: "1 / -1",
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: "15px",
                padding: "40px 0",
              }}
            >
              暂无可用方案，请稍后再试。
            </p>
          )}

          {plans.map((p, i) => {
            const free = p.monthly === 0;
            // 未配年付价的套餐在年付档回落月付展示（下单同样按月收）。
            const yr = cycle === "yr" && Number(p.yearly) > 0;
            // 限时折扣活动价（服务端仅在活动进行中附加 promo 字段）：
            // 命中当前周期时活动价做主价，原价划线；结算价服务端同判定重算。
            const promoM = p.promo && p.promo.monthly > 0 ? Number(p.promo.monthly) : 0;
            const promoY = p.promo && p.promo.yearly > 0 ? Number(p.promo.yearly) : 0;
            const dealHit = yr ? promoY > 0 : !free && promoM > 0;
            // 年付主价 = 折合月价（yearly/12），旁边划线展示月付原价；
            // 实际收款仍是年付总价，价格下方注明。活动价命中时主价换活动价，
            // 划线价换成对应周期的常规价。
            const payYearly = promoY > 0 ? promoY : Number(p.yearly);
            const eff = yr
              ? Math.round((payYearly / 12) * 100) / 100
              : promoM > 0
                ? promoM
                : Number(p.monthly);
            const num = free ? "¥0" : "¥" + eff;
            const per = free ? "永久免费" : "/ 月";
            const orig = yr && promoY > 0
              ? Math.round((Number(p.yearly) / 12) * 100) / 100
              : Number(p.monthly);
            const showOrig = !free && (dealHit || (yr && Number(p.yearly) > 0)) && orig > eff;
            // 会员态：等级相同 =「当前套餐」，已持有更高档 =「已包含」，均不可
            // 再购（套餐只能升级）。FREE 是默认档：登录且无付费等级 = 当前套餐，
            // 已是付费会员 = 已包含。
            const myLevel = user?.vipLevel ?? 0;
            const isCurrent = user
              ? free
                ? myLevel === 0
                : p.vipLevel > 0 && myLevel === p.vipLevel
              : false;
            const isCovered = user
              ? free
                ? myLevel > 0
                : p.vipLevel > 0 && myLevel > p.vipLevel
              : false;
            const owned = isCurrent || isCovered;
            return (
              <div
                key={p.id}
                className={`plan ${p.featured ? "feat" : ""} reveal`}
                style={{ "--rd": `${i * 0.06}s` } as React.CSSProperties}
              >
                {/* 六区固定结构（与 pages.css 的 subgrid 轨道一一对应）：
                    区块恒渲染，缺内容留空占轨——任意后台参数组合不破对齐 */}
                <div className="plan-head">
                  <div className="plan-name">{p.name}</div>
                  {p.featured && <span className="plan-tag">最受欢迎</span>}
                  {/* 活动角标：命中当前计费周期的活动价才显示，与横幅同色系 */}
                  {dealHit && (
                    <span className="plan-tag deal">{p.promo?.tag || "限时"}</span>
                  )}
                </div>
                <div className="plan-desc">{p.desc}</div>
                <div className="plan-price">
                  <span className="num">{num}</span>
                  {showOrig && <span className="orig">¥{orig}</span>}
                  <span className="per">{per}</span>
                </div>
                <div className="plan-meta">
                  {!free && yr && Number(p.yearly) > 0
                    ? promoY > 0
                      ? `按年支付 ¥${payYearly}（原价 ¥${p.yearly}）`
                      : `按年支付 ¥${p.yearly}`
                    : ""}
                </div>
                <div className="plan-cta-slot">
                  {/* hideCta：后台按套餐配置隐藏按钮；槽位保留，权益区跨卡齐线 */}
                  {!p.hideCta && (
                    <button
                      type="button"
                      className={`plan-cta ${p.featured && !owned ? "solid" : "ghost"}`}
                      disabled={owned}
                      style={owned ? { opacity: 0.55, cursor: "default" } : undefined}
                      onClick={() => onPlanCta(p)}
                    >
                      {isCurrent ? "当前套餐" : isCovered ? "已包含" : p.cta}
                    </button>
                  )}
                </div>
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

        {/* ── Feature comparison table ───────────────────────────────── */}
        {/* 列=在售套餐（名称/顺序/推荐徽章跟随套餐管理），行=后台可编辑的对比配置 */}
        {plans.length > 0 && cmpRows.length > 0 && (
          <section className="block" style={{ paddingBottom: 0 }}>
            <div
              className="sec-head"
              style={{ flexDirection: "column", alignItems: "flex-start" }}
            >
              <span className="eyebrow reveal">
                <span className="d" />
                方案对比 · COMPARE
              </span>
              <h2 className="sec-title reveal">
                看清每一分<span className="gtext">算力</span>
              </h2>
            </div>
            {/* featured 套餐列与方案卡的推荐档同语言：hl 列 + 推荐徽章 */}
            <div className="cmp-card reveal">
              <div className="cmp-scroll">
                <table className="cmp" id="cmp">
                  <thead>
                    <tr>
                      <th>能力</th>
                      {plans.map((p) => (
                        <th key={p.id} className={p.featured ? "hl" : ""}>
                          {p.name}
                          {p.featured && <span className="cmp-badge">推荐</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cmpRows.map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        {plans.map((p) => {
                          const c = r.values?.[p.id] || "—";
                          return (
                            <td
                              key={p.id}
                              className={`${c === "—" ? "no" : ""}${p.featured ? " hl" : ""}`}
                            >
                              {c === "✓" ? <span className="cmp-ck">✓</span> : c}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ── FAQ accordion ──────────────────────────────────────────── */}
        {faqs.length > 0 && (
        <section className="block">
          <div
            className="sec-head"
            style={{
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <span className="eyebrow reveal">
              <span className="d" />
              常见问题 · FAQ
            </span>
            <h2 className="sec-title reveal" style={{ maxWidth: "none" }}>
              关于<span className="gtext">付费</span>，你可能想问
            </h2>
          </div>
          <div className="faq price-faq" id="faq">
            {faqs.map((f, i) => {
              const open = openFaq === i;
              return (
                <div
                  key={f.q}
                  className={`faq-item reveal${open ? " open" : ""}`}
                  style={{ "--rd": `${(i % 4) * 0.04}s` } as React.CSSProperties}
                >
                  <button
                    className="faq-q"
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : i)}
                  >
                    <i className="n">{String(i + 1).padStart(2, "0")}</i>
                    <span className="qt">{f.q}</span>
                    <span className="faq-ic">+</span>
                  </button>
                  {/* 展开动画由 CSS grid-rows 承担（.faq-item.open） */}
                  <div className="faq-a">
                    <div className="faq-a-in">{f.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* CTA 收尾块已按用户要求移除（2026-07-08）：定价页以 FAQ 结束。 */}
      </div>

      {payIntent && (
        <PayModal intent={payIntent} onClose={() => setPayIntent(null)} />
      )}
    </div>
  );
}
