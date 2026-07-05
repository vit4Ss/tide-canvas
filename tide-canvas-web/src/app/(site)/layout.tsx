/* ============================================================================
   (site) route-group layout — the marketing/site shell.

   Nested under the app's root layout (which already provides <html>/<body> and
   the global fonts), so this layout renders ONLY the chrome, not document tags.

   - Imports the liuguang flux + pages stylesheets (their :root brings the light
     design tokens).
   - <SiteNav/> (fixed) + page <main> + <SiteFooter/>.
   - The wrapper div carries the light background + base text color.
   ========================================================================== */

import "@/styles/liuguang/flux.css";
import "@/styles/liuguang/pages.css";
import "@/styles/liuguang/imini-theme.css"; // 正式主题（body.imini 由根布局直出）

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
      <SiteNav />

      <main>{children}</main>

      <SiteFooter />
    </div>
  );
}
