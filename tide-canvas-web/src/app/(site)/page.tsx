"use client";

/* ============================================================================
   HOME (route "/") — React App-Router port of the liuguang home page.
   Source: design-ref/首页-流光.html (structure/copy) +
           design-ref/liuguang/home-render.js (dynamic logic) +
           design-ref/liuguang/home-data.js (now @/mock).

   The (site) layout already renders <SiteNav/>, <SiteFooter/> and
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
import { useEffect, useMemo, useState } from "react";
import { CAPS, coverBg } from "@/mock";
import { contentApi } from "@/lib/content-api";
import { billingApi } from "@/lib/billing-api";
import type { PostLiteVO, ModelLiteVO, HomeFloorLiteVO } from "@/types/content";
import type { PlanVO } from "@/types/billing";
import { useReveal } from "@/components/site/use-reveal";
import HomeHero from "@/components/site/home-hero";
import InfiniteCanvas from "@/components/site/infinite-canvas";
import FeedCoverflow from "@/components/site/feed-coverflow";
import ModelMarquee from "@/components/site/model-marquee";
import HomeFaq from "@/components/site/home-faq";
import HomePricing from "@/components/site/home-pricing";

/** 首页楼层的出厂顺序（type = 后台「首页楼层」的楼层类型）。楼层接口失败 /
    为空时按此渲染，首页永不空白；接口返回后以后台的启用+排序为准。 */
const DEFAULT_FLOOR_TYPES = [
  "英雄区",
  "能力展示",
  "无限画布",
  "作品流",
  "模型跑马灯",
  "FAQ",
  "价格",
] as const;

/** 能力卡分流：CORE 生成品类 → 创作台对应模式；TOOL 编辑功能 → 独立工具页
    （封装好提示词的一键处理，/tools/[op]）。 */
const CAP_LINK: Record<string, string> = {
  文生图: "/studio?type=image",
  文生视频: "/studio?type=video",
  图生图: "/studio?type=image&tool=i2i",
  智能扩图: "/tools/expand",
  局部重绘: "/tools/inpaint",
  一键抠图: "/tools/rmbg",
  高清放大: "/tools/upscale",
};

export default function HomePage() {
  const router = useRouter();

  // Real home data. /api/home/feed + /api/billing/plans are PUBLIC reads — no
  // session needed. Hero / capabilities / faq stay static design content.
  const [works, setWorks] = useState<PostLiteVO[]>([]);
  const [models, setModels] = useState<ModelLiteVO[]>([]);
  const [plans, setPlans] = useState<PlanVO[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(true);
  // 首页楼层配置（后台「首页楼层」）：null = 未返回（按出厂顺序渲染）。
  const [floors, setFloors] = useState<HomeFloorLiteVO[] | null>(null);

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
    contentApi.floors().then((res) => {
      if (alive && res.success && res.data) setFloors(res.data);
    });
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

  // 渲染用楼层列表：接口返回的已启用楼层里筛掉未知类型（创作者榜/自定义等
  // 暂无对应区块）；接口失败或没有任何可渲染楼层时回退出厂顺序，首页永不空白。
  const floorList = useMemo<HomeFloorLiteVO[]>(() => {
    const fallback = DEFAULT_FLOOR_TYPES.map((t, i) => ({
      type: t,
      name: t,
      count: 0,
      sortOrder: i,
    }));
    if (!floors) return fallback;
    const known = floors.filter((f) =>
      (DEFAULT_FLOOR_TYPES as readonly string[]).includes(f.type),
    );
    return known.length ? known : fallback;
  }, [floors]);

  // 去AI味预览已升级为 (site) 组级挂载 — 见 layout 里的 <DeaiPreview/>。

  // Reveal .reveal/.reveal-scale on scroll (re-scan after mount paints).
  useReveal([works, models, plans, floorList]);

  /* ── 楼层 → 区块渲染（后台「首页楼层」驱动显隐/顺序/数量）───────────── */
  const renderFloor = (f: HomeFloorLiteVO) => {
    switch (f.type) {
      case "英雄区":
        return <HomeHero key={f.type} />;
      case "能力展示":
        return renderCaps(f.type);
      case "无限画布":
        return renderCanvas(f.type);
      case "作品流":
        return renderGallery(f.type, f.count);
      case "模型跑马灯":
        return <ModelMarquee key={f.type} models={models} />;
      case "FAQ":
        return renderFaq(f.type);
      case "价格":
        return renderPricing(f.type);
      default:
        return null;
    }
  };

  const renderCaps = (key: string) => (
      <section className="block" id="caps-sec" key={key}>
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
            {(() => {
              // 真实作品图铺进 bento（作品即界面）；大卡片吃前 3 张做轮播，
              // 其余每卡一张，接口为空时回退 mesh 渐变。
              const covers = works.filter((w) => w.coverUrl).map((w) => w.coverUrl);
              let used = 0;
              return CAPS.map((c, i) => {
                const isBig = c.size === "big";
                const take = isBig ? Math.min(3, covers.length - used) : covers.length - used > 0 ? 1 : 0;
                const own = covers.slice(used, used + take);
                used += take;
                return (
                  <article
                    key={c.t}
                    className={`cap reveal-scale ${c.size}`}
                    style={{ ["--rd" as string]: `${(i % 4) * 0.05}s` }}
                    onClick={() => router.push(CAP_LINK[c.t] ?? "/studio")}
                  >
                    {own.length > 0 ? (
                      own.map((url, li) => (
                        <div
                          key={url}
                          className={`cap-cover${li > 0 ? " xfade" : ""}`}
                          style={{
                            backgroundImage: `url(${url})`,
                            ...(li > 0
                              ? { animationDelay: `${li * 4.5}s` }
                              : undefined),
                          }}
                        />
                      ))
                    ) : (
                      <div className="cap-cover" style={{ background: coverBg(c.cover) }} />
                    )}
                    <div className="cap-scrim" />
                    <span className="cap-ico">{c.ico}</span>
                    <span className={`cap-kick${i < 2 ? " core" : ""}`}>
                      {i < 2 ? "CORE" : "TOOL"}
                    </span>
                    <div className="cap-body">
                      <h3>{c.t}</h3>
                      <p>{c.d}</p>
                      <span className="cap-go">试一下 →</span>
                    </div>
                  </article>
                );
              });
            })()}
          </div>
        </div>
      </section>
  );

  const renderCanvas = (key: string) => (
      <section className="block" id="studio-sec" key={key}>
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
          <InfiniteCanvas
            covers={works
              .filter((w) => w.coverUrl)
              .slice(3, 9)
              .map((w) => w.coverUrl)}
          />
        </div>
      </section>
  );

  /* count > 0 时按后台配置截取作品数（0 = 全量交给组件自行裁决） */
  const renderGallery = (key: string, count: number) => (
      <section className="block" id="feed-sec" key={key}>
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
          <FeedCoverflow
            works={count > 0 ? works.slice(0, count) : works}
            loading={feedLoading}
          />
        </div>
      </section>
  );

  const renderFaq = (key: string) => (
      <section className="block" id="faq-sec" key={key}>
        <div className="wrap">
          <div className="sec-head center">
            <div>
              <span className="eyebrow reveal">
                <span className="d" />常见问题 · FAQ
              </span>
              <h2 className="sec-title reveal">
                还有<span className="gtext">疑问</span>？
              </h2>
              <p className="sec-sub reveal">
                关于模型、额度与商用授权的一切，都在这里。
              </p>
            </div>
          </div>
          <HomeFaq />
        </div>
      </section>
  );

  const renderPricing = (key: string) => (
      <section className="block" id="cta-sec" key={key}>
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
  );

  return <>{floorList.map(renderFloor)}</>;
}
