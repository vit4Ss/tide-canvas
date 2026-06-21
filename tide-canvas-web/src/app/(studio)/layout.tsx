/* ============================================================================
   (studio) route-group layout — Tripo-style full-screen workstation shell.

   Renders the far-left ws-rail (StudioRail) plus the page content region.
   Mirrors design-ref/创作台.html's <div class="ws"> shell, but as a flexible
   rail + content layout so each studio page can define its own inner columns:
     - 创作台 (/studio)  → panel + stage (3-col, page-owned)
     - 灵感 (/inspire)   → .ws--insp (104px 1fr, page-owned)
     - 资产 (/assets)    → .ws--assets (104px 1fr, page-owned)
   The per-stage FluxField backdrop (<canvas id="flux"> / .ws-stage-fx) belongs
   to the create page's stage, not this shell — so it is NOT rendered here.

   liuguang styles applied via class names; the dark flux background comes from
   --bg on .studio-shell. Order: flux (tokens) → pages → studio (overrides).
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "@/styles/liuguang/pages.css";
import "@/styles/liuguang/studio.css";
import StudioRail from "@/components/studio/studio-rail";
import styles from "./studio-shell.module.css";

export default function StudioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.shell}>
      <StudioRail />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
