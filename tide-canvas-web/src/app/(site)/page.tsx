"use client";

/* ============================================================================
   HOME (route "/") — React App-Router port of the liuguang home page.
   Source: design-ref/首页-流光.html (structure/copy) +
           design-ref/liuguang/home-render.js (dynamic logic) +
           design-ref/liuguang/home-data.js (now @/mock).

   The (site) layout already renders <FluxField/>, <SiteNav/>, <SiteFooter/> and
   imports flux.css + pages.css — this file renders ONLY the page content using
   the exact liuguang class names so the shared styles apply.

   Sections in order: HERO · CAPABILITIES · INFINITE CANVAS · LIVE GALLERY ·
   MODEL MARQUEE · FAQ · PRICING.

   Interactivity is split into small client components under
   src/components/site/ (hero, infinite-canvas, feed-coverflow, faq, pricing,
   marquee). `useReveal()` drives the scroll reveal-on-view for .reveal nodes.

   Link wiring: capability tiles / 全部工具 → /studio; INFINITE CANVAS 试一试 →
   /projects; 浏览全部作品 → /explore; 查看完整方案 → /pricing.
   ========================================================================== */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CAPS, coverBg } from "@/mock";
import { contentApi } from "@/lib/content-api";
import { billingApi } from "@/lib/billing-api";
import type { PostLiteVO, ModelLiteVO } from "@/types/content";
import type { PlanVO } from "@/types/billing";
import { toast } from "@/components/shared/toast";
import { useReveal } from "@/components/site/use-reveal";
import HomeHero from "@/components/site/home-hero";
import InfiniteCanvas from "@/components/site/infinite-canvas";
import FeedCoverflow from "@/components/site/feed-coverflow";
import ModelMarquee from "@/components/site/model-marquee";
import HomeFaq from "@/components/site/home-faq";
import HomePricing from "@/components/site/home-pricing";

export default function HomePage() {
  const router = useRouter();

  // Real home data. /api/home/feed + /api/billing/plans are PUBLIC reads — no
  // session needed. Hero / capabilities / faq stay static design content.
  const [works, setWorks] = useState<PostLiteVO[]>([]);
  const [models, setModels] = useState<ModelLiteVO[]>([]);
  const [plans, setPlans] = useState<PlanVO[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    contentApi
      .homeFeed()
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) {
          setWorks(res.data.works ?? []);
          setModels(res.data.models ?? []);
        }
      })
      .finally(() => alive && setFeedLoading(false));
    billingApi
      .plans()
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data) setPlans(res.data);
      })
      .finally(() => alive && setPlansLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Reveal .reveal/.reveal-scale on scroll (re-scan after mount paints).
  useReveal([works, models, plans]);

  return (
    <>
      {/* HERO */}
      <HomeHero />

      {/* CAPABILITIES */}
      <section className="block" id="caps-sec">
        <div className="wrap">
          <div className="sec-head center">
            <div>
              <span className="eyebrow reveal">
                <span className="d" />核心能力 · CAPABILITIES
              </span>
              <h2 className="sec-title reveal">
                顶级模型 × 专业工具，<span className="gtext">一处搞定</span>
              </h2>
              <p className="sec-sub reveal">从生成到精修，整条创作链路都在流光之内。</p>
            </div>
            <Link className="see-all reveal" href="/studio">
              全部工具 →
            </Link>
          </div>

          <div className="cap-grid" id="caps">
            {CAPS.map((c, i) => (
              <article
                key={c.t}
                className={`cap reveal-scale ${c.size}`}
                style={{ ["--rd" as string]: `${(i % 4) * 0.05}s` }}
                onClick={() => {
                  toast.info(`${c.t} · 前往创作台`);
                  router.push("/studio");
                }}
              >
                <div className="cap-cover" style={{ background: coverBg(c.cover) }} />
                <div className="cap-scrim" />
                <span className="cap-ico">{c.ico}</span>
                <span className="cap-kick">{i < 2 ? "CORE" : "TOOL"}</span>
                <div className="cap-body">
                  <h3>{c.t}</h3>
                  <p>{c.d}</p>
                  <span className="cap-go">试一下 →</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* INFINITE CANVAS */}
      <section className="block" id="studio-sec">
        <div className="wrap">
          <div className="sec-head center">
            <div>
              <span className="eyebrow reveal">
                <span className="d" />无限画布 · INFINITE CANVAS
              </span>
              <h2 className="sec-title reveal">
                在无限画布上，<span className="gtext">自由创作</span>
              </h2>
              <p className="sec-sub reveal">
                拖拽、组合、迭代——让每个想法都在同一个共享空间里自然流动。
              </p>
            </div>
            <Link className="see-all reveal" href="/projects">
              试一试 →
            </Link>
          </div>
          <InfiniteCanvas />
        </div>
      </section>

      {/* FEED — LIVE GALLERY */}
      <section className="block" id="feed-sec">
        <div className="wrap">
          <div className="sec-head center">
            <div>
              <span className="eyebrow reveal">
                <span className="d" />作品广场 · LIVE GALLERY
              </span>
              <h2 className="sec-title reveal">
                此刻，社区正在生成的<span className="gtext">流光之作</span>
              </h2>
              <p className="sec-sub reveal">悬停任意作品即可一键生成同款。</p>
            </div>
            <Link className="see-all reveal" href="/explore">
              浏览全部作品 →
            </Link>
          </div>
          <FeedCoverflow works={works} loading={feedLoading} />
        </div>
      </section>

      {/* MODEL MARQUEE */}
      <ModelMarquee models={models} />

      {/* FAQ */}
      <section className="block" id="faq-sec">
        <div className="wrap">
          <div
            className="sec-head"
            style={{
              justifyContent: "center",
              textAlign: "center",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span className="eyebrow reveal">
              <span className="d" />常见问题 · FAQ
            </span>
            <h2 className="sec-title reveal" style={{ maxWidth: "none" }}>
              还有<span className="gtext">疑问</span>？
            </h2>
          </div>
          <HomeFaq />
        </div>
      </section>

      {/* PRICING */}
      <section className="block" id="cta-sec">
        <div className="wrap">
          <div className="sec-head center">
            <div>
              <span className="eyebrow reveal">
                <span className="d" />价格方案 · PRICING
              </span>
              <h2 className="sec-title reveal">
                选一个节奏，<span className="gtext">开始创作</span>
              </h2>
              <p className="sec-sub reveal">
                免费开始，无需信用卡。随时升级或取消——你只为真正用到的算力付费。
              </p>
            </div>
          </div>
          <HomePricing plans={plans} loading={plansLoading} />
          <div style={{ textAlign: "center", marginTop: 30 }}>
            <Link className="see-all reveal" href="/pricing">
              查看完整方案与对比 →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
