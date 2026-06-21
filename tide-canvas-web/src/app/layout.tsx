import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastContainer } from "@/components/shared/toast";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TideCanvas - 无限画布 AI 创作平台",
  description: "基于无限画布的多模态 AI 创作工作流编排平台，在无限画布中生成、连接和重组图片、文字与图形。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* 流光设计字体：Sora / Space Grotesk / JetBrains Mono / Noto Sans SC（site/studio/admin 的 liuguang 样式按名引用） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
