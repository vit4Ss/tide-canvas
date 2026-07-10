"use client";

/* ============================================================================
   HomeHero — React client port of the liuguang home HERO.
   Source: design-ref/首页-流光.html (<header class="hero">) +
           design-ref/liuguang/home-render.js (typeLoop / liveCounter / parallax).

   Owns the hero's interactivity:
     - typewriter loop over HERO_PROMPTS (FX.typeLoop)
     - animated live counter (FX.liveCounter)
     - scroll parallax + fade on #heroInner
     - console + quick chips → /studio
   Static structure/copy mirrors the design 1:1; classes are the liuguang
   classes from pages.css so styles apply unchanged.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HERO_PROMPTS, fmt } from "@/mock";
import { ctaTargetHref } from "@/lib/flux-presets";
import { toast } from "@/components/shared/toast";
import HeroWall from "@/components/site/hero-wall";
import { communityApi } from "@/lib/community-api";
import { marketApi } from "@/lib/market-api";

const QUICK = [
  { label: "文生图", toast: "文生图 · 前往创作台" },
  { label: "文生视频", toast: "文生视频 · 前往创作台" },
  { label: "图生图", toast: "图生图 · 前往创作台" },
  { label: "图生视频", toast: "图生视频 · 前往创作台" },
];

/** 模型 type → 统计带展示名；未知类型原样展示。顺序即展示优先级。 */
const MODEL_TYPE_LABEL: [string, string][] = [
  ["image", "图片生成"],
  ["video", "视频生成"],
  ["text", "文本创作"],
  ["audio", "音频生成"],
  ["3d", "3D 生成"],
];

/** 在库模型的去重类型，按预定义优先级排序（未知类型排尾）。 */
function distinctTypes(types: string[]): string[] {
  const seen = Array.from(new Set(types.filter(Boolean)));
  const rank = new Map(MODEL_TYPE_LABEL.map(([k], i) => [k, i]));
  return seen.sort(
    (a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || a.localeCompare(b),
  );
}

function typeLabel(t: string): string {
  return MODEL_TYPE_LABEL.find(([k]) => k === t)?.[1] ?? t;
}

export default function HomeHero({
  ctaLabel = "生成",
  ctaTarget = "studio",
}: {
  /** 首屏主按钮文案（后台「首页楼层 · 楼层全局配置」home.global.ctaLabel）。 */
  ctaLabel?: string;
  /** 主按钮跳转键 studio/pricing（home.global.ctaTarget），经 ctaTargetHref 解析。 */
  ctaTarget?: string;
}) {
  const router = useRouter();
  const innerRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  // 首屏定位数据：全部来自真实接口，取不到就不显示。作品数 = 社区分页 total；
  // 模型数与创作类型 = 创作台在库模型（/api/market/studio-models）的数量与
  // 去重 type —— 同步进新模态（如音频）时「N 类」自动跟着涨。
  const [worksTotal, setWorksTotal] = useState(0);
  const [modelsTotal, setModelsTotal] = useState(0);
  const [modelTypes, setModelTypes] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [posts, models] = await Promise.all([
        communityApi.list({ pageNum: 1, pageSize: 1 }),
        marketApi.studioModels(),
      ]);
      if (!alive) return;
      if (posts.success && posts.data) setWorksTotal(posts.data.total);
      if (models.success && models.data) {
        setModelsTotal(models.data.length);
        setModelTypes(distinctTypes(models.data.map((m) => m.type)));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // typewriter loop over HERO_PROMPTS (ported from FX.typeLoop)
  useEffect(() => {
    let pi = 0;
    let ci = 0;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = HERO_PROMPTS[pi];
      ci += dir;
      setTyped(full.slice(0, ci));
      if (dir > 0 && ci >= full.length) {
        dir = -1;
        timer = setTimeout(tick, 2200);
        return;
      }
      if (dir < 0 && ci <= 0) {
        dir = 1;
        pi = (pi + 1) % HERO_PROMPTS.length;
        timer = setTimeout(tick, 320);
        return;
      }
      timer = setTimeout(tick, dir > 0 ? 46 + Math.random() * 40 : 24);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  // hero parallax + fade on scroll
  useEffect(() => {
    const hero = innerRef.current;
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onScroll = () => {
      const y = Math.min(window.scrollY, 700);
      hero.style.transform = `translateY(${y * 0.16}px)`;
      hero.style.opacity = String(Math.max(0, 1 - y / 620));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goStudio = () => router.push("/studio");
  // 主 CTA 按后台配置跳转；console 本体与快捷 chips 是提示词入口，恒去创作台。
  const goCta = () => router.push(ctaTargetHref(ctaTarget));

  return (
    <header className="hero">
      <HeroWall />
      <div className="hero-scrim" />
      <div className="hero-noise" />

      <div className="hero-inner" id="heroInner" ref={innerRef}>
        <span className="kicker reveal" style={{ ["--rd" as string]: "0s" }}>
          From ordinary to extraordinary · 从平凡到非凡
        </span>
        <h1 className="hero-h1 reveal" style={{ ["--rd" as string]: ".1s" }}>
          <span className="cn">一句话，</span>
          <span className="row2 cn">
            生成<span className="gtext">想象</span>之物。
          </span>
        </h1>
        <p className="hero-sub reveal" style={{ ["--rd" as string]: ".55s" }}>
          AI 图片与视频创作平台：一句提示词，顶级模型一键直达。无需任何专业知识，让灵感即刻成真——在流光之中，人人都是 AI 艺术家。
        </p>

        <div
          className="console reveal"
          style={{ ["--rd" as string]: ".7s" }}
          onClick={goStudio}
        >
          <div className="field">
            <span id="typed">{typed}</span>
            <span className="caret" />
          </div>
          <button
            type="button"
            className="console-go"
            onClick={(e) => {
              e.stopPropagation();
              goCta();
            }}
          >
            {ctaLabel} →
          </button>
        </div>

        <div className="hero-quick reveal" style={{ ["--rd" as string]: ".82s" }}>
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              className="qchip"
              onClick={() => {
                toast.info(q.toast);
                goStudio();
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* 定位统计带：全部为真实数据（社区 total + 在库模型数 + 模型类型去重），
          无一硬编码；接口未返回前不渲染 */}
      {worksTotal > 0 && modelsTotal > 0 && modelTypes.length > 0 && (
        <div className="hero-stats reveal" style={{ ["--rd" as string]: ".95s" }}>
          <div className="hero-stats-in">
            <div>
              <div className="stat-n gtext">{fmt(worksTotal)}</div>
              <div className="stat-l">馆藏社区作品</div>
            </div>
            <div>
              <div className="stat-n">{modelsTotal}</div>
              <div className="stat-l">在库生成模型</div>
            </div>
            <div>
              <div className="stat-n">{modelTypes.length} 类</div>
              <div className="stat-l">{modelTypes.map(typeLabel).join(" · ")}</div>
            </div>
          </div>
        </div>
      )}

      <div className="scroll-cue">
        <span>SCROLL</span>
        <span className="bar" />
      </div>
    </header>
  );
}
