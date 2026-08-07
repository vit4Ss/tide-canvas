"use client";

/* ============================================================================
   SiteFooter — React port of footerHTML() from design-ref/liuguang/shell.js.
   Uses the exact liuguang class names from flux.css (footer / .wrap / .foot-grid
   / .foot-brand / .brand / .glyph / .foot-col / .foot-bottom / .mono) so the
   shared styles apply unchanged.

   链接列由后台「配置管理」的 site.footerLinks 驱动（GET /api/site/footer，
   服务端带出厂默认兜底）。首屏先渲染内置默认（与服务端出厂默认一致，避免
   闪动），接口返回后替换为管理员配置。站内路径走 <Link>，外链走 <a>。
   ========================================================================== */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/flux/atoms";
import { contentApi } from "@/lib/content-api";
import { isHiddenPricingRoute } from "@/lib/public-routes";
import type { FooterColVO } from "@/types/content";

/** 内置默认列 — 与服务端 model.DefaultFooterLinksJSON 保持一致。 */
const DEFAULT_COLS: FooterColVO[] = [
  {
    title: "产品",
    links: [
      { label: "图片生成", href: "/studio?type=image" },
      { label: "视频创作", href: "/studio?type=video" },
      { label: "作品广场", href: "/explore" },
    ],
  },
  {
    title: "社区",
    links: [
      { label: "作品广场", href: "/explore" },
      { label: "创作者", href: "/#creators" },
      { label: "玩法教程", href: "/inspire" },
      { label: "灵感周报", href: "/inspire" },
    ],
  },
  {
    title: "关于",
    links: [
      { label: "服务条款", href: "/terms" },
      { label: "隐私政策", href: "/privacy" },
    ],
  },
];

/** 站内相对路径用 <Link>（客户端导航），http(s) 外链用 <a> 新窗口打开。 */
function FootLink({ label, href }: { label: string; href: string }) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }
  return <Link href={href}>{label}</Link>;
}

export default function SiteFooter() {
  const [cols, setCols] = useState<FooterColVO[]>(DEFAULT_COLS);

  useEffect(() => {
    let alive = true;
    contentApi.footer().then((res) => {
      if (alive && res.success && res.data?.length) setCols(res.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const visibleCols = cols.map((col) => ({
    ...col,
    // 后台可能仍保存旧的定价页链接，公开端统一过滤，避免配置回流后重新出现。
    links: col.links.filter((link) => !isHiddenPricingRoute(link.href)),
  }));

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

          {visibleCols.map((col) => (
            <div className="foot-col" key={col.title}>
              <h4>{col.title}</h4>
              {col.links.map((l) => (
                <FootLink key={`${l.label}-${l.href}`} label={l.label} href={l.href} />
              ))}
            </div>
          ))}
        </div>

        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} 流光 FlowingLight · 保留所有权利</span>
          <span className="foot-legal">
            <Link href="/terms">服务条款</Link>
            <Link href="/privacy">隐私政策</Link>
            <a href="mailto:ad@tcmzhan.com">联系我们</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
