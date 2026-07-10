"use client";

/* ============================================================================
   BgSwitcher — 导航栏里的流光背景切换器（design-ref/liuguang/home-render.js
   buildBgSwitcher 移植；样式为 flux.css 的 .bg-nav 家族）。

   仅当首页背景已挂载且后台允许用户切换（use-flux-bg-store.active &&
   allowSwitch）时由 SiteNav 渲染——其余页面/禁用时导航保持原样。选择写回
   store，flux-bg 侧负责应用 mood 并持久化到 localStorage。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { FLUX_PRESETS, FLUX_PRESET_ORDER } from "@/lib/flux-presets";
import { useFluxBgStore } from "@/stores/use-flux-bg-store";

export default function BgSwitcher() {
  const preset = useFluxBgStore((s) => s.preset);
  const setPreset = useFluxBgStore((s) => s.setPreset);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 外点/Escape 关闭（与 acct 下拉一致的交互约定）
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = FLUX_PRESETS[preset] ?? FLUX_PRESETS.aurora;

  return (
    <div className={`bg-nav${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="icbtn bg-nav-btn"
        title="背景流光"
        aria-label="切换背景"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span className="bg-orb" style={{ background: cur.sw }} />
      </button>
      <div className="bg-nav-pop">
        <div className="bg-switch-head">流光背景</div>
        <div className="bg-switch-grid">
          {FLUX_PRESET_ORDER.map((key) => {
            const p = FLUX_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                className="bg-opt"
                aria-current={key === preset}
                onClick={() => {
                  setPreset(key);
                  setOpen(false);
                }}
              >
                <span className="bg-opt-sw" style={{ background: p.sw }} />
                <span className="bg-opt-tx">
                  <b>{p.label}</b>
                  <i>{p.sub}</i>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
