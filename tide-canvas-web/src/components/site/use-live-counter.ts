"use client";

/* ============================================================================
   useLiveCounter — React port of FX.liveCounter from design-ref/liuguang/shell.js.

   Drifts a counter around `base` every 2s (clamped base-60 .. base+220) and
   returns the en-US formatted string. Starts from base so SSR/first paint is
   stable; the random drift only begins after mount.
   ========================================================================== */

import { useEffect, useState } from "react";

export function useLiveCounter(base: number): string {
  const [value, setValue] = useState<number>(base);

  useEffect(() => {
    let v = base;
    const id = setInterval(() => {
      v += Math.round((Math.random() - 0.42) * 14);
      v = Math.max(base - 60, Math.min(base + 220, v));
      setValue(v);
    }, 2000);
    return () => clearInterval(id);
  }, [base]);

  return value.toLocaleString("en-US");
}
