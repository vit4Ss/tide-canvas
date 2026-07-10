"use client";

/* ============================================================================
   FluxBg — 首页全局连续流光背景（design-ref/liuguang/home-render.js 的
   "continuous background presets" 段移植）。

   一块 fixed 的 FluxField 着色器画布垫在整页楼层之下（flux.css 的
   `.hero, section.block …{z-index:1}` 把内容抬到其上），随滚动在各楼层间
   平滑变换色相/流向，无分段接缝；其上叠一层 #flux-bg-scrim 压光罩保证可读性。

   预设与强度由后台「首页楼层 · 楼层全局配置」下发（/api/site/home-config）：
   - preset: 默认预设（FLUX_PRESETS 六选一，未知 key 回退 aurora）
   - intensity: 全局亮度乘数 0–1.5（design-ref 硬编码 0.78，现由后台配置）
   - allowSwitch: 允许用户在导航切换器里改预设（localStorage 覆盖默认）
   切换器本体在 site-nav 里（bg-switcher），经 use-flux-bg-store 桥接。

   楼层区块由接口异步渲染且可被后台停用，update() 每次重查 DOM 而不缓存节点，
   缺失的区块自然跳过。reduced-motion / WebGL 不可用由 flux-field 内部处理
   （静帧 / CSS 渐变回退）。
   ========================================================================== */

import { useEffect, useRef } from "react";
import { mountFluxField, type FluxMood } from "@/components/site/flux-field";
import {
  FLUX_PRESETS,
  FLUX_PRESET_STORAGE_KEY,
} from "@/lib/flux-presets";
import { useFluxBgStore } from "@/stores/use-flux-bg-store";

/** 楼层锚点 → 页面进度 n(0..1) 与该段的流向（design-ref SECTIONS 原值）。 */
const SECTIONS: { sel: string; n: number; flow: [number, number] }[] = [
  { sel: ".hero", n: 0.0, flow: [0.03, 0.02] },
  { sel: "#caps-sec", n: 0.16, flow: [0.05, 0.0] },
  { sel: "#studio-sec", n: 0.34, flow: [0.04, 0.02] },
  { sel: "#feed-sec", n: 0.55, flow: [0.0, -0.04] },
  { sel: "#faq-sec", n: 0.82, flow: [0.03, 0.0] },
  { sel: "#cta-sec", n: 1.0, flow: [0.05, 0.04] },
];

/** t(0..1) 处的着色器 mood：预设定调，段间流向线性插值，强度乘全局乘数。 */
function moodAt(t: number, presetKey: string, gain: number): FluxMood {
  const p = FLUX_PRESETS[presetKey] ?? FLUX_PRESETS.aurora;
  let i = 0;
  while (i < SECTIONS.length - 1 && t > SECTIONS[i + 1].n) i++;
  const a = SECTIONS[i];
  const b = SECTIONS[Math.min(i + 1, SECTIONS.length - 1)];
  const span = Math.max(0.0001, b.n - a.n);
  const k = Math.max(0, Math.min(1, (t - a.n) / span));
  return {
    hue: p.base + t * p.spread,
    speed: p.speed,
    scale: p.scale,
    intensity: p.intensity * gain,
    flow: [
      a.flow[0] + (b.flow[0] - a.flow[0]) * k,
      a.flow[1] + (b.flow[1] - a.flow[1]) * k,
    ],
  };
}

/** 用户覆盖优先（仅当后台允许切换且本地值合法），否则用后台默认预设。 */
function initialPreset(adminPreset: string, allowSwitch: boolean): string {
  const fallback = FLUX_PRESETS[adminPreset] ? adminPreset : "aurora";
  if (!allowSwitch) return fallback;
  try {
    const saved = localStorage.getItem(FLUX_PRESET_STORAGE_KEY);
    if (saved && FLUX_PRESETS[saved]) return saved;
  } catch {
    /* storage 不可用（隐私模式等）→ 用后台默认 */
  }
  return fallback;
}

export default function FluxBg({
  preset,
  intensity,
  allowSwitch,
}: {
  preset: string;
  intensity: number;
  allowSwitch: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const store = useFluxBgStore.getState();
    let curPreset = initialPreset(preset, allowSwitch);
    store.activate(curPreset, allowSwitch);

    // imini 主题给每个楼层刷了不透明底（body.imini section.block），流光在时
    // 由 body.flux-on 让区块透明（见 imini-theme.css「表面」段），离开首页恢复。
    document.body.classList.add("flux-on");

    const init = moodAt(0, curPreset, intensity);
    const handle = mountFluxField(canvas, {
      hue: init.hue,
      speed: init.speed,
      scale: init.scale,
      intensity: init.intensity,
      flow: init.flow,
      variant: 0,
      mouse: true,
      res: 0.7,
    });

    if (!handle) {
      // WebGL 不可用：CSS 渐变兜底已由 flux-field 打上（flux-fallback），
      // 区块保持透明露出渐变；切换器保留无意义，收起。
      useFluxBgStore.getState().deactivate();
      return () => {
        document.body.classList.remove("flux-on");
      };
    }

    // 滚动 → 页面进度 → mood（design-ref bindScrollMood；节点每次重查，
    // 容忍楼层异步渲染/被停用）。
    let ticking = false;
    const update = () => {
      ticking = false;
      const nodes = SECTIONS.map((s) => ({
        s,
        el: document.querySelector(s.sel),
      })).filter((x): x is { s: (typeof SECTIONS)[number]; el: Element } =>
        Boolean(x.el),
      );
      if (!nodes.length) return;
      const mid = window.scrollY + window.innerHeight * 0.42;
      const centers = nodes.map(({ s, el }) => {
        const r = el.getBoundingClientRect();
        return { n: s.n, c: window.scrollY + r.top + r.height / 2 };
      });
      let i = 0;
      while (i < centers.length - 1 && mid > centers[i + 1].c) i++;
      const a = centers[i];
      const b = centers[Math.min(i + 1, centers.length - 1)];
      const span = Math.max(1, b.c - a.c);
      const k = Math.max(0, Math.min(1, (mid - a.c) / span));
      handle.setMood(moodAt(a.n + (b.n - a.n) * k, curPreset, intensity));
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();

    // 切换器改预设 → 持久化到 localStorage 并立即重定向 mood。
    const unsub = useFluxBgStore.subscribe((s) => {
      if (!s.active || s.preset === curPreset || !FLUX_PRESETS[s.preset]) return;
      curPreset = s.preset;
      try {
        localStorage.setItem(FLUX_PRESET_STORAGE_KEY, curPreset);
      } catch {
        /* 持久化失败不影响本次切换 */
      }
      update();
    });

    return () => {
      unsub();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      handle.destroy();
      document.body.classList.remove("flux-on");
      useFluxBgStore.getState().deactivate();
    };
  }, [preset, intensity, allowSwitch]);

  return (
    <>
      <canvas id="flux-bg" ref={canvasRef} />
      <div id="flux-bg-scrim" />
    </>
  );
}
