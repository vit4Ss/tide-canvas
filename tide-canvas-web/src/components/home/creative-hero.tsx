"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import {
  Layers,
  Plus,
  BookOpen,
  Lightbulb,
  Box,
  ArrowUp,
  Image as ImageIcon,
  Video,
  Palette,
  Megaphone,
  Smile,
  ShoppingBag,
} from "lucide-react";

// 快捷创作类别（仿 Lovart 输入框下方的 chips）
const CHIPS = [
  { key: "image", Icon: ImageIcon },
  { key: "video", Icon: Video },
  { key: "design", Icon: Palette },
  { key: "poster", Icon: Megaphone },
  { key: "character", Icon: Smile },
  { key: "ecommerce", Icon: ShoppingBag },
] as const;

/**
 * 主页中央创作入口（仿 Lovart）。
 * 发送/选类别 → 跳转新建画布；prompt 以 query 透传，画布端接入为后续独立功能。
 */
export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const [prompt, setPrompt] = useState("");

  const start = (preset?: string) => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const text = [preset, prompt.trim()].filter(Boolean).join(" ").trim();
    const q = text ? `?prompt=${encodeURIComponent(text)}` : "";
    router.push(`/canvas/new${q}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      start();
    }
  };

  return (
    <section className="px-4 pt-16 pb-10 sm:px-6 sm:pt-24 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* 标题 */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 dark:bg-white">
            <Layers className="h-5 w-5 text-white dark:text-neutral-900" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        </div>
        <p className="mt-3 text-center text-base text-neutral-400">{t("subtitle")}</p>

        {/* 创作输入框 */}
        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white shadow-sm transition-colors focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-100 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:ring-violet-500/10">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            rows={2}
            className="block w-full resize-none bg-transparent px-4 pt-4 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1 text-neutral-400">
              <button type="button" aria-label="attachment" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" aria-label="template" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <BookOpen className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-1 text-neutral-400">
              <button type="button" aria-label="inspiration" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <Lightbulb className="h-4 w-4" />
              </button>
              <button type="button" aria-label="model" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <Box className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => start()}
                aria-label={t("send")}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-700"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 快捷类别 chips */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {CHIPS.map(({ key, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => start(t(`chips.${key}`))}
              className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-sm text-neutral-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
            >
              <Icon className="h-4 w-4" />
              {t(`chips.${key}`)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
