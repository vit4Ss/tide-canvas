/* ============================================================================
   (site) route-group layout — the marketing/site shell.

   Nested under the app's root layout (which already provides <html>/<body> and
   the global fonts), so this layout renders ONLY the chrome, not document tags.

   - Imports the liuguang flux + pages stylesheets (their :root brings the dark
     design tokens; flux.css positions #flux-bg / #flux-bg-scrim as fixed).
   - <FluxField/> paints the WebGL backdrop behind all content.
   - <SiteNav/> (fixed) + page <main> + <SiteFooter/>.
   - The wrapper div carries the dark flux background + base text color so this
     route group reads dark even though the root globals.css is light.
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "@/styles/liuguang/pages.css";

import SiteFluxField from "@/components/flux/site-flux-field";
import SiteNav from "@/components/site/site-nav";
import SiteFooter from "@/components/site/site-footer";

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className="site-root"
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--ui)",
      }}
    >
      {/* fixed full-viewport WebGL field + legibility scrim (behind everything),
          its mood driven by the 流光背景 switcher in the nav */}
      <SiteFluxField />

      <SiteNav />

      {/* page content sits above the fixed field (flux.css lifts these regions) */}
      <main>{children}</main>

      <SiteFooter />
    </div>
  );
}
