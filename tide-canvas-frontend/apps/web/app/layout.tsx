import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { ToastContainer } from "@/components/shared/toast";

// 自托管 Inter（latin 子集，可变字重）：避免构建期联网拉取 Google Fonts。
// Docker 构建 VM 偶发无法访问 fonts.googleapis.com 会直接导致 next build 失败；
// 改为读取仓库内字体文件后构建即不再依赖网络。中文等非 latin 字符仍回退系统字体，
// 与此前 next/font/google 的 subsets:["latin"] 行为一致。
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "TideCanvas - 无限画布 AI 创作平台",
  description: "基于无限画布的多模态 AI 创作工作流编排平台，在无限画布中生成、连接和重组图片、文字与图形。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <NextIntlClientProvider>
          {children}
          <ToastContainer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
