import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastContainer } from "@/components/shared/toast";
import { ConfirmHost } from "@/components/shared/confirm";
import { GenerationHistoryFab } from "@/components/shared/generation-history-fab";
import { AppAutoUpdate } from "@/components/shared/app-auto-update";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "流光 FlowingLight - 无限画布 AI 创作平台",
  description: "流光 FlowingLight：基于无限画布的多模态 AI 创作平台，一句话生成图片与视频，接入海量模型，在无限画布中生成、连接和重组图片、文字与图形。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} h-full antialiased`} data-scroll-behavior="smooth">
      <head>
        {/* CSS chunk 加载失败自愈：_next/static 资源按构建哈希命名，部署后（或网络抖动时）
            样式表可能 404/加载失败且不会自动重试——页面会带着缺失的样式一直坏到手动刷新。
            捕获同源样式表的 error 事件后整页刷新（最多 2 次，防止死循环）。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var K="css-fail-reloads";window.addEventListener("error",function(e){var t=e.target;if(!t||t.tagName!=="LINK"||t.rel!=="stylesheet")return;var h=t.href||"";if(h.indexOf("/_next/")===-1)return;try{var n=Number(sessionStorage.getItem(K)||"0");if(n>=2)return;sessionStorage.setItem(K,String(n+1));}catch(_){ }location.reload();},true);window.addEventListener("load",function(){try{sessionStorage.removeItem(K);}catch(_){ }});})();`,
          }}
        />
        {/* 流光设计字体：Sora / Space Grotesk / JetBrains Mono / Noto Sans SC（site/studio/admin 的 liuguang 样式按名引用） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this is the App Router root layout, so the stylesheet is already global across every route. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* imini：全站正式主题类（照抄 imini.ai 的深色体系，样式在 liuguang/imini-theme.css，
          由各路由组 layout 引入；未引入该文件的路由组（如画布）不受影响）。
          suppressHydrationWarning：浏览器插件（翻译类等）会在水合前往 body 注入私有属性，
          只静默本元素的属性差异，子树校验不受影响。 */}
      <body
        suppressHydrationWarning
        className="imini flex min-h-full flex-col bg-background font-sans text-foreground"
      >
        <AppAutoUpdate />
        {children}
        <GenerationHistoryFab />
        <ToastContainer />
        <ConfirmHost />
      </body>
    </html>
  );
}
