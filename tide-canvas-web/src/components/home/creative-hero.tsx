"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Layers,
  Plus,
  BookOpen,
  Lightbulb,
  Box,
  ArrowUp,
  Loader2,
  Image as ImageIcon,
  Video,
  Palette,
  Megaphone,
  Smile,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { aiApi } from "@/lib/api";
import { AiTaskStatus, AiModelType } from "@/types/ai";

// 快捷创作类别（仿 Lovart 输入框下方的 chips）
const CHIPS = [
  { key: "image", Icon: ImageIcon },
  { key: "video", Icon: Video },
  { key: "design", Icon: Palette },
  { key: "poster", Icon: Megaphone },
  { key: "character", Icon: Smile },
  { key: "ecommerce", Icon: ShoppingBag },
] as const;

const POLL_INTERVAL = 2000;
const MAX_POLL = 5 * 60 * 1000;

type GenStatus = "generating" | "done" | "error";
interface GenResult {
  id: string;
  prompt: string;
  status: GenStatus;
  imageUrl?: string;
  error?: string;
}

/**
 * 主页中央创作入口（仿 Lovart）：对话框式生成工具。
 * 输入提示词 → 复用 aiApi 文生图（异步任务 + 轮询）→ 在下方对话流展示结果，不跳转新建画布。
 */
export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("default");
  const [results, setResults] = useState<GenResult[]>([]);
  const seqRef = useRef(0);

  // 取一个图片模型作为默认（拿不到则用后端兜底 "default"）
  useEffect(() => {
    aiApi
      .listModels()
      .then((res) => {
        if (!res.success) return;
        const img = res.data.find((m) => m.type === AiModelType.IMAGE);
        if (img?.modelId) setModelId(img.modelId);
      })
      .catch(() => {});
  }, []);

  const patch = (id: string, data: Partial<GenResult>) =>
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const poll = (taskId: number, id: string, start: number) => {
    const tick = async () => {
      if (Date.now() - start > MAX_POLL) {
        patch(id, { status: "error", error: t("genTimeout") });
        return;
      }
      try {
        const res = await aiApi.getTask(taskId);
        if (!res.success) {
          patch(id, { status: "error", error: res.message || t("genFailed") });
          return;
        }
        const task = res.data;
        if (task.status === AiTaskStatus.SUCCESS) {
          patch(id, { status: "done", imageUrl: task.resultUrl });
        } else if (task.status === AiTaskStatus.FAILED || task.status === AiTaskStatus.CANCELLED) {
          patch(id, { status: "error", error: task.errorMsg || t("genFailed") });
        } else {
          setTimeout(tick, POLL_INTERVAL);
        }
      } catch {
        patch(id, { status: "error", error: t("genFailed") });
      }
    };
    tick();
  };

  const submit = async (preset?: string) => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const text = [preset, prompt.trim()].filter(Boolean).join(" ").trim();
    if (!text) return;
    setPrompt("");
    seqRef.current += 1;
    const id = `g${seqRef.current}`;
    setResults((rs) => [{ id, prompt: text, status: "generating" }, ...rs]);
    try {
      const res = await aiApi.generate({ handler: "text_to_image", modelId, input: { prompt: text } });
      if (!res.success) {
        patch(id, { status: "error", error: res.message || t("genFailed") });
        return;
      }
      poll(res.data.id, id, Date.now());
    } catch {
      patch(id, { status: "error", error: t("genFailed") });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const busy = results.some((r) => r.status === "generating");

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
        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white shadow-sm transition-colors focus-within:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900">
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
                onClick={() => submit()}
                aria-label={t("send")}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
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
              onClick={() => submit(t(`chips.${key}`))}
              className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-sm text-neutral-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
            >
              <Icon className="h-4 w-4" />
              {t(`chips.${key}`)}
            </button>
          ))}
        </div>

        {/* 生成结果对话流 */}
        {results.length > 0 && (
          <div className="mt-8 space-y-4">
            {results.map((r) => (
              <div key={r.id} className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{r.prompt}</p>
                <div className="mt-3">
                  {r.status === "generating" && (
                    <div className="flex items-center gap-2 text-sm text-neutral-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("generating")}
                    </div>
                  )}
                  {r.status === "done" && r.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.imageUrl}
                      alt={r.prompt}
                      className="max-h-96 w-auto rounded-xl border border-neutral-200 dark:border-neutral-800"
                    />
                  )}
                  {r.status === "error" && (
                    <p className="text-sm text-red-500">{r.error || t("genFailed")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
