import { create } from "zustand";

/* ============================================================================
   流光背景切换器 store — ports PRESETS / PRESET_ORDER / PRESET_KEY and the
   curPreset persistence from design-ref/liuguang/home-render.js (buildBgSwitcher).

   The design only built the orb switcher on the home page; here the preset is
   global state so the orb (in SiteNav) and the WebGL field (SiteFluxField, in
   the (site) layout) — which are siblings — stay in sync, and the choice
   persists to the same localStorage key the prototype used (`flux_bg_preset`).
   ========================================================================== */

export type FluxPresetKey =
  | "aurora"
  | "nebula"
  | "ocean"
  | "ember"
  | "verdant"
  | "ink";

export interface FluxPreset {
  /** menu title (流光背景 option) */
  label: string;
  /** menu subtitle */
  sub: string;
  /** base hue rotation (radians) at top of page */
  base: number;
  /** hue spread down the page (kept for parity; unused without scroll-mood) */
  spread: number;
  speed: number;
  scale: number;
  intensity: number;
  /** swatch gradient shown on the orb + option chip */
  sw: string;
}

/* verbatim from home-render.js PRESETS */
export const FLUX_PRESETS: Record<FluxPresetKey, FluxPreset> = {
  aurora: { label: "极光", sub: "蓝 · 紫 · 品红", base: 6.15, spread: 1.95, speed: 1.0, scale: 1.05, intensity: 1.0, sw: "linear-gradient(120deg,#3b53d6,#9b3ad0,#d8367f)" },
  nebula: { label: "星云", sub: "深紫 · 洋红", base: 0.55, spread: 1.15, speed: 0.7, scale: 1.38, intensity: 1.05, sw: "linear-gradient(120deg,#7a2bd0,#b51e9c,#e0357a)" },
  ocean: { label: "深海", sub: "青 · 蓝绿", base: 4.85, spread: 1.25, speed: 0.9, scale: 1.12, intensity: 0.98, sw: "linear-gradient(120deg,#1c8f9c,#1aa6c0,#2f7fd0)" },
  ember: { label: "熔岩", sub: "玫红 · 琥珀", base: 1.75, spread: 1.1, speed: 1.1, scale: 1.0, intensity: 1.05, sw: "linear-gradient(120deg,#d8367f,#d66a3c,#d59a1f)" },
  verdant: { label: "苔原", sub: "黄绿 · 翠", base: 3.25, spread: 1.25, speed: 0.8, scale: 1.18, intensity: 1.0, sw: "linear-gradient(120deg,#8fa11a,#5aa83c,#1f9c7a)" },
  ink: { label: "水墨", sub: "极简 · 幽蓝", base: 6.05, spread: 0.45, speed: 0.42, scale: 0.92, intensity: 0.62, sw: "linear-gradient(120deg,#3a4170,#5a4a86,#6d6f9c)" },
};

export const FLUX_PRESET_ORDER: FluxPresetKey[] = [
  "aurora",
  "nebula",
  "ocean",
  "ember",
  "verdant",
  "ink",
];

const PRESET_KEY = "flux_bg_preset";
const DEFAULT_PRESET: FluxPresetKey = "aurora";

/** The mood the WebGL field eases to for a preset (mirrors home-render moodAt(0)). */
export function presetMood(key: FluxPresetKey) {
  const p = FLUX_PRESETS[key] ?? FLUX_PRESETS[DEFAULT_PRESET];
  return {
    hue: p.base,
    speed: p.speed,
    scale: p.scale,
    // home-render renders the field at 0.78× the preset intensity
    intensity: p.intensity * 0.78,
    // SECTIONS[0] (.hero) flow
    flow: [0.03, 0.02] as [number, number],
  };
}

interface FluxBgState {
  preset: FluxPresetKey;
  /** select + persist a preset (mirrors applyPreset) */
  setPreset: (key: FluxPresetKey) => void;
  /** pull the persisted preset from localStorage (client-only; call in effect) */
  hydrate: () => void;
}

/* Default stays DEFAULT_PRESET so SSR and the first client render agree; the
   persisted value is applied in an effect via hydrate() after mount. */
export const useFluxBgStore = create<FluxBgState>((set) => ({
  preset: DEFAULT_PRESET,
  setPreset: (key) => {
    if (!FLUX_PRESETS[key]) return;
    try {
      localStorage.setItem(PRESET_KEY, key);
    } catch {
      /* storage unavailable — keep in-memory only */
    }
    set({ preset: key });
  },
  hydrate: () => {
    try {
      const k = localStorage.getItem(PRESET_KEY);
      if (k && k in FLUX_PRESETS) set({ preset: k as FluxPresetKey });
    } catch {
      /* ignore */
    }
  },
}));
