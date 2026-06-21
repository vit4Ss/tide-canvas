"use client";

/* ============================================================================
   SiteFluxField — the (site) layout's WebGL backdrop, wired to the 流光背景
   switcher store. Reads the current preset and feeds its mood into <FluxField>,
   which eases the running shader toward the new colour/flow when it changes.
   Also hydrates the persisted preset from localStorage on mount.

   Mirrors home-render.js: mount the field at the preset's moodAt(0) with the
   home defaults (res 0.7, mouse on).
   ========================================================================== */

import { useEffect } from "react";
import FluxField from "./flux-field";
import {
  useFluxBgStore,
  presetMood,
} from "@/stores/use-flux-bg-store";

export default function SiteFluxField() {
  const preset = useFluxBgStore((s) => s.preset);
  const hydrate = useFluxBgStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const m = presetMood(preset);

  return (
    <FluxField
      hue={m.hue}
      speed={m.speed}
      scale={m.scale}
      intensity={m.intensity}
      flow={m.flow}
      variant={0}
      mouse
      res={0.7}
    />
  );
}
