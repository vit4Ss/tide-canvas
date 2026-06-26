"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, Globe } from "lucide-react";
import { locales, type AppLocale } from "@/i18n/config";

// 语言名以其母语显示（惯例，不随当前界面语言翻译）
const NATIVE_LABELS: Record<AppLocale, string> = {
  zh: "简体中文",
  en: "English",
};

// 写 cookie 的副作用提到模块级，避免在组件内直接给全局赋值（react-hooks/immutability）
function persistLocale(next: AppLocale) {
  document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`;
}

/**
 * 语言切换：写入 NEXT_LOCALE cookie 并 refresh，让 server 端按新 locale 重渲染。
 * 嵌入用户下拉菜单使用；onSwitched 用于切换后关闭菜单。
 */
export function LocaleSwitcher({ onSwitched }: { onSwitched?: () => void }) {
  const t = useTranslations("userMenu");
  const active = useLocale() as AppLocale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: AppLocale) => {
    if (next !== active) {
      persistLocale(next);
      startTransition(() => router.refresh());
    }
    onSwitched?.();
  };

  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-neutral-400">
        <Globe className="h-3.5 w-3.5" />
        {t("language")}
      </div>
      {locales.map((lc) => (
        <button
          key={lc}
          onClick={() => switchTo(lc)}
          disabled={pending}
          className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {NATIVE_LABELS[lc]}
          {lc === active && <Check className="h-4 w-4 text-amber-500" />}
        </button>
      ))}
    </div>
  );
}
