"use client";

/* ============================================================================
   useReveal — React port of FX.reveal() from design-ref/liuguang/shell.js.

   The liuguang pages animate `.reveal` / `.reveal-scale` elements in on scroll
   by toggling the `.in` class once each element enters the viewport (top below
   92% of the viewport height, bottom still visible). A 1.6s fallback forces any
   stragglers visible so nothing stays hidden.

   Usage: call `useReveal(deps)` from a "use client" page. Pass deps that change
   the DOM (e.g. a re-render that adds/removes `.reveal` nodes) so the scan
   re-runs. The hook scopes its query to `document`, matching the design.
   ========================================================================== */

import { useEffect } from "react";

export function useReveal(deps: ReadonlyArray<unknown> = []) {
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".reveal, .reveal-scale"),
    );

    const tick = () => {
      const vh = window.innerHeight;
      for (let i = els.length - 1; i >= 0; i--) {
        const r = els[i].getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) {
          els[i].classList.add("in");
          els.splice(i, 1);
        }
      }
      if (!els.length) window.removeEventListener("scroll", tick);
    };

    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick, { passive: true });
    tick();

    const fallback = window.setTimeout(() => {
      document
        .querySelectorAll<HTMLElement>(".reveal:not(.in), .reveal-scale:not(.in)")
        .forEach((el) => el.classList.add("in"));
    }, 1600);

    return () => {
      window.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
      window.clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
