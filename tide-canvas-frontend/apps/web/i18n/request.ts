import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, isAppLocale, type AppLocale } from "./config";

/**
 * next-intl「无路由前缀」模式：locale 存于 cookie(NEXT_LOCALE)，运行时切换。
 * 不改动 app 路由结构，契合本项目重度 use client + 客户端鉴权的现状。
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale: AppLocale = isAppLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
