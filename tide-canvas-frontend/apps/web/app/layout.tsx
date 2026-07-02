import type { Metadata } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "@mantine/core/styles.css";
import "./globals.css";
import { MantineAppProvider } from "@/components/shared/mantine-provider";
import { ToastContainer } from "@/components/shared/toast";

// 使用仓库内置 Inter 字体，避免 Docker 构建时联网拉取 Google Fonts。
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "TideCanvas - 无限画布 AI 创作平台",
  description: "基于无限画布的多模型 AI 创作工作流编排平台，支持生成、连接和重组图片、文字与图形。",
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
        <MantineAppProvider>
          <NextIntlClientProvider>
            {children}
            <ToastContainer />
          </NextIntlClientProvider>
        </MantineAppProvider>
      </body>
    </html>
  );
}
