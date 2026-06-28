/* ============================================================================
   SiteFooter — React port of footerHTML() from design-ref/liuguang/shell.js.
   Uses the exact liuguang class names from flux.css (footer / .wrap / .foot-grid
   / .foot-brand / .brand / .glyph / .foot-col / .foot-bottom / .mono) so the
   shared styles apply unchanged.

   Pure presentational (no hooks / browser APIs) → server component.
   Internal links resolve to real routes; coming-soon / external items render
   as inert (#) anchors for now.
   ========================================================================== */

import Link from "next/link";
import { Logo } from "@/components/flux/atoms";

export default function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <div className="brand">
              <Logo size={26} />
              FLOWING<b>LIGHT</b>
            </div>
            <p>
              智绘社区 · 超级 AI 创作智能体。一句话生成图片与视频，海量模型一键调用。
            </p>
          </div>

          <div className="foot-col">
            <h4>产品</h4>
            <Link href="/studio">图片生成</Link>
            <Link href="/studio">视频创作</Link>
            <Link href="/explore">作品广场</Link>
          </div>

          <div className="foot-col">
            <h4>社区</h4>
            <Link href="/explore">作品广场</Link>
            <Link href="/#creators">创作者</Link>
            <a href="#">玩法教程</a>
            <a href="#">灵感周报</a>
          </div>

          <div className="foot-col">
            <h4>关于</h4>
            <Link href="/pricing">价格方案</Link>
            <Link href="/pricing">企业版</Link>
            <a href="#">服务条款</a>
            <a href="#">联系我们</a>
          </div>
        </div>

        <div className="foot-bottom">
          <span>
            © 2026 FLOWINGLIGHT · 流光 · 高保真交互原型 · 占位封面为生成式渐变，可替换为真实作品
          </span>
          <span className="mono">流光 · FLUX FIELD v2</span>
        </div>
      </div>
    </footer>
  );
}
