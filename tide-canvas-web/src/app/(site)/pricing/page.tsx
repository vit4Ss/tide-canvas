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

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { billingApi } from "@/lib/billing-api";
import type { PlanVO } from "@/types/billing";
import { useReveal } from "@/components/site/use-reveal";

type Cycle = "yr" | "mo";

const CMP_HEAD = ["能力", "体验版", "创作者 Pro", "企业版"] as const;

/* Feature comparison table — STATIC design content (no billing backend
   equivalent). Each row: [capability, 体验版, 创作者 Pro, 企业版];
   "✓" = supported, "—" = not supported, otherwise a literal value. */
const CMP_ROWS: readonly (readonly string[])[] = [
  ["每月积分", "100", "3,000", "无限"],
  ["图片模型", "基础", "全部", "全部 + 私有"],
  ["视频模型", "—", "全部", "全部"],
  ["生成速度", "标准", "优先不限速", "最高优先"],
  ["最高分辨率", "512²", "4K", "4K"],
  ["商用授权", "—", "✓", "✓"],
  ["API 接入", "—", "—", "✓"],
  ["团队协作", "—", "—", "✓"],
];

/* Pricing FAQ — STATIC design content (no billing backend equivalent). */
const PRICING_FAQS: readonly { q: string; a: string }[] = [
  {
    q: "积分是怎么计算的？",
    a: "每次生成会按模型与分辨率消耗对应积分，标准图片约 1 积分/张，高清与视频按算力计费。生成前会显示预估消耗。",
  },
  {
    q: "可以随时升级或降级吗？",
    a: "可以。升级立即生效并按比例计费；降级会在当前账期结束后生效，已购积分继续有效。",
  },
  {
    q: "没用完的积分会过期吗？",
    a: "订阅赠送的月度积分按月重置，单独购买的积分包永久有效，不会过期。",
  },
  {
    q: "支持哪些支付方式？",
    a: "支持微信支付、支付宝以及主流信用卡。企业版可申请对公转账与发票。",
  },
  {
    q: "生成的作品版权归谁？",
    a: "你拥有自己生成作品的使用权。Pro 及以上方案附带商用授权，可用于商业项目。",
  },
  {
    q: "免费版有什么限制？",
    a: "免费版每月赠送 100 积分，可使用基础图片模型与标准队列，适合尝鲜与轻度创作。",
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle>("yr");
  // First FAQ open by default (matches pricing.js renderFaq()).
  const [openFaq, setOpenFaq] = useState<number>(0);

  // Real plan cards from the public billing endpoint.
  const [plans, setPlans] = useState<PlanVO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Public read — no session required.
    billingApi
      .plans()
      .then((res) => {
        if (alive && res.success && res.data) setPlans(res.data);
      })
      .finally(() => {
        if (alive) setLoading(false);
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
              maxWidth: "50ch",
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

        {/* ── Plans grid ─────────────────────────────────────────────── */}
        <div className="plans" id="plans" style={{ marginTop: 36 }}>
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
            const price = cycle === "yr" ? p.yearly : p.monthly;
            const num = free ? "¥0" : "¥" + price;
            const per = free
              ? "永久免费"
              : cycle === "yr"
                ? "/ 月（年付）"
                : "/ 月";
            return (
              <div
                key={p.id}
                className={`plan ${p.featured ? "feat" : ""} reveal`}
                style={{ "--rd": `${i * 0.06}s` } as React.CSSProperties}
              >
                {p.featured && <span className="plan-tag">最受欢迎</span>}
                <div className="plan-name">{p.name}</div>
                <div className="plan-desc">{p.desc}</div>
                <div className="plan-price">
                  <span className="num">{num}</span>
                  <span className="per">{per}</span>
                </div>
                <button
                  type="button"
                  className={`plan-cta ${p.featured ? "solid" : "ghost"}`}
                  onClick={() => router.push("/studio")}
                >
                  {p.cta}
                </button>
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
          <div style={{ overflowX: "auto" }} className="reveal">
            <table className="cmp" id="cmp">
              <thead>
                <tr>
                  {CMP_HEAD.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CMP_ROWS.map((r) => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td>
                    {r.slice(1).map((c, ci) => (
                      <td
                        key={ci}
                        className={c === "✓" ? "yes" : c === "—" ? "no" : ""}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── FAQ accordion ──────────────────────────────────────────── */}
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
            {PRICING_FAQS.map((f, i) => {
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
                    <span>{f.q}</span>
                    <span className="faq-ic">+</span>
                  </button>
                  <div
                    className="faq-a"
                    style={{ maxHeight: open ? 400 : 0 }}
                  >
                    <div className="faq-a-in">{f.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── CTA block ──────────────────────────────────────────────── */}
        <section className="block" style={{ paddingBottom: 0 }}>
          <div className="cta reveal-scale">
            <div className="cta-glow" />
            <h2>
              仍在犹豫？
              <br />
              <span className="gtext">先免费试一张</span>
            </h2>
            <p>注册即送体验积分，无需绑定信用卡。喜欢了再升级。</p>
            <div className="cta-actions">
              <Link className="cta-primary" href="/studio">
                免费开始创作 →
              </Link>
              <Link className="cta-secondary" href="/explore">
                看看大家在做什么
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
