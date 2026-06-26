// 纯常量/类型，无任何 server-only 依赖，可同时被 client 与 server 引用
export const locales = ["zh", "en"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "zh";

export function isAppLocale(value: string | undefined): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value);
}
