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
import { HERO_PROMPTS } from "@/mock";
import { toast } from "@/components/shared/toast";

const QUICK = [
  { ico: "✨", label: "文生图", toast: "文生图 · 前往创作台" },
  { ico: "🎬", label: "文生视频", toast: "文生视频 · 前往创作台" },
  { ico: "🖼", label: "图生图", toast: "图生图 · 前往创作台" },
  { ico: "↻", label: "生成同款", toast: "一键生成同款" },
];

export default function HomeHero() {
  const router = useRouter();
  const innerRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [liveNum, setLiveNum] = useState("1,240");

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

  // animated live counter (ported from FX.liveCounter)
  useEffect(() => {
    const base = 1240;
    let v = base;
    const id = setInterval(() => {
      v += Math.round((Math.random() - 0.42) * 14);
      v = Math.max(base - 60, Math.min(base + 220, v));
      setLiveNum(v.toLocaleString("en-US"));
    }, 2000);
    return () => clearInterval(id);
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

  return (
    <header className="hero">
      <div className="hero-scrim" />
      <div className="hero-noise" />

      <div className="hero-inner" id="heroInner" ref={innerRef}>
        <div className="live-chip reveal" style={{ ["--rd" as string]: ".45s" }}>
          <span className="live-dot" />实时 · <b id="liveNum">{liveNum}</b> 人正在生成
        </div>
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
          图片与视频，30+ 顶级模型一键直达。无需任何专业知识，让灵感即刻成真——在流光之中，人人都是 AI 艺术家。
        </p>

        <div
          className="console reveal"
          style={{ ["--rd" as string]: ".7s" }}
          onClick={goStudio}
        >
          <span className="spark">✦</span>
          <div className="field">
            <span id="typed">{typed}</span>
            <span className="caret" />
          </div>
          <button
            type="button"
            className="console-go"
            onClick={(e) => {
              e.stopPropagation();
              goStudio();
            }}
          >
            生成 →
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
              {q.ico} {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hero-stats reveal" style={{ ["--rd" as string]: ".95s" }}>
        <div className="hero-stats-in">
          <div>
            <div className="stat-n gtext">
              3,800<span style={{ fontSize: ".6em" }}>万+</span>
            </div>
            <div className="stat-l">累计生成作品</div>
          </div>
          <div>
            <div className="stat-n">30+</div>
            <div className="stat-l">顶级模型与工作流</div>
          </div>
          <div>
            <div className="stat-n">
              12<span style={{ fontSize: ".6em" }}>s</span>
            </div>
            <div className="stat-l">平均出图时间</div>
          </div>
          <div>
            <div className="stat-n">
              96<span style={{ fontSize: ".6em" }}>万</span>
            </div>
            <div className="stat-l">活跃创作者</div>
          </div>
        </div>
      </div>

      <div className="scroll-cue">
        <span>SCROLL</span>
        <span className="bar" />
      </div>
    </header>
  );
}
