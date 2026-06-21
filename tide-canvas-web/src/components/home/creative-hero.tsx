"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Layers,
  Plus,
  BookOpen,
  Lightbulb,
  ArrowUp,
  ChevronDown,
  Check,
  Zap,
  Loader2,
  Download,
  FolderPlus,
  LayoutGrid,
  Image as ImageIcon,
  Video,
  Palette,
  Megaphone,
  Smile,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { aiApi, fileApi } from "@/lib/api";
import { AiTaskStatus, AiModelType, type AiModelVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";

// 快捷创作类别（点击填入输入框作为提示词建议）
const CHIPS = [
  { key: "image", Icon: ImageIcon },
  { key: "video", Icon: Video },
  { key: "design", Icon: Palette },
  { key: "poster", Icon: Megaphone },
  { key: "character", Icon: Smile },
  { key: "ecommerce", Icon: ShoppingBag },
] as const;

const POLL_INTERVAL = 2000;
const MAX_POLL_IMAGE = 5 * 60 * 1000;
const MAX_POLL_VIDEO = 30 * 60 * 1000; // 视频较慢，轮询上限放宽
const MODEL_STORAGE_KEY = "tc:home:modelId";

type GenKind = "image" | "video";
type GenStatus = "generating" | "done" | "error";
interface GenResult {
  id: string;
  prompt: string;
  kind: GenKind;
  status: GenStatus;
  url?: string;
  error?: string;
  saved?: boolean; // 已加入素材库
}

/**
 * 主页中央创作入口（仿 Lovart）：对话框式生成工具。
 * 模型选择（图片/视频，按类型分组、记忆上次选择）→ aiApi 异步任务 + 轮询 →
 * 下方对话流展示结果，支持下载 / 存到画布 / 加入素材库（画布素材面板可引用）。
 */
export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [results, setResults] = useState<GenResult[]>([]);
  const seqRef = useRef(0);

  // 加载可用的图片/视频模型；优先恢复上次选择(localStorage)，否则默认第一个图片模型
  useEffect(() => {
    aiApi
      .listModels()
      .then((res) => {
        if (!res.success) return;
        const usable = res.data.filter(
          (m) => m.type === AiModelType.IMAGE || m.type === AiModelType.VIDEO,
        );
        setModels(usable);
        const saved = typeof window !== "undefined" ? localStorage.getItem(MODEL_STORAGE_KEY) : null;
        const restored = saved && usable.find((m) => m.modelId === saved) ? saved : null;
        const first = usable.find((m) => m.type === AiModelType.IMAGE) ?? usable[0];
        const pick = restored ?? first?.modelId ?? "";
        if (pick) setSelectedModelId(pick);
      })
      .catch(() => {});
  }, []);

  const selectedModel = models.find((m) => m.modelId === selectedModelId);
  const imageModels = models.filter((m) => m.type === AiModelType.IMAGE);
  const videoModels = models.filter((m) => m.type === AiModelType.VIDEO);

  const selectModel = (id: string) => {
    setSelectedModelId(id);
    setModelOpen(false);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  };

  const patch = (id: string, data: Partial<GenResult>) =>
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const poll = (taskId: number, id: string, start: number, maxPoll: number) => {
    const tick = async () => {
      if (Date.now() - start > maxPoll) {
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
          patch(id, { status: "done", url: task.resultUrl });
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

  const submit = async () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    const isVideo = selectedModel?.type === AiModelType.VIDEO;
    const kind: GenKind = isVideo ? "video" : "image";
    seqRef.current += 1;
    const id = `g${seqRef.current}`;
    setResults((rs) => [{ id, prompt: text, kind, status: "generating" }, ...rs]);
    try {
      const res = await aiApi.generate({
        handler: isVideo ? "text_to_video" : "text_to_image",
        modelId: selectedModelId || "default",
        input: { prompt: text },
      });
      if (!res.success) {
        patch(id, { status: "error", error: res.message || t("genFailed") });
        return;
      }
      poll(res.data.id, id, Date.now(), isVideo ? MAX_POLL_VIDEO : MAX_POLL_IMAGE);
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

  const addChip = (label: string) => setPrompt((p) => (p ? `${p} ${label}` : label));

  // 下载：优先 fetch 成 blob 触发下载；跨域不可读时回退新标签打开
  const download = async (r: GenResult) => {
    if (!r.url) return;
    const ext = r.kind === "video" ? "mp4" : "png";
    try {
      const resp = await fetch(r.url);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `tidecanvas-${r.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(r.url, "_blank", "noopener");
    }
  };

  const saveToLibrary = async (r: GenResult, thenOpenCanvas = false) => {
    if (!r.url) return;
    try {
      const res = await fileApi.saveFromUrl({
        url: r.url,
        fileType: r.kind,
        originalName: r.prompt.slice(0, 40),
      });
      if (res.success) {
        patch(r.id, { saved: true });
        toast.success(thenOpenCanvas ? t("savedToCanvas") : t("savedToLibrary"));
        if (thenOpenCanvas) router.push("/canvas/new");
      } else {
        toast.error(res.message || t("saveFailed"));
      }
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  const busy = results.some((r) => r.status === "generating");

  const renderModelItem = (m: AiModelVO) => (
    <button
      key={m.modelId}
      type="button"
      onClick={() => selectModel(m.modelId)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      {m.type === AiModelType.VIDEO ? (
        <Video className="h-4 w-4 shrink-0 text-neutral-400" />
      ) : (
        <ImageIcon className="h-4 w-4 shrink-0 text-neutral-400" />
      )}
      <span className="flex-1 truncate text-left">{m.name}</span>
      <span className="flex items-center gap-0.5 text-xs text-neutral-400">
        <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
        {m.pointCost}
      </span>
      {m.modelId === selectedModelId && <Check className="h-4 w-4 shrink-0 text-violet-600" />}
    </button>
  );

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
            style={{ outline: "none", boxShadow: "none", border: "none" }}
            className="block w-full resize-none border-0 bg-transparent px-4 pt-4 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none focus:outline-none focus:ring-0 dark:text-neutral-100"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1 text-neutral-400">
              <button type="button" aria-label="attachment" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" aria-label="template" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <BookOpen className="h-4 w-4" />
              </button>

              {/* 模型选择下拉（按类型分组） */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {selectedModel?.type === AiModelType.VIDEO ? (
                    <Video className="h-3.5 w-3.5" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  <span className="max-w-[120px] truncate">{selectedModel?.name || t("model")}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {modelOpen && models.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-64 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      {imageModels.length > 0 && (
                        <div className="px-2 py-1 text-xs font-medium text-neutral-400">{t("groupImage")}</div>
                      )}
                      {imageModels.map(renderModelItem)}
                      {videoModels.length > 0 && (
                        <div className="mt-1 px-2 py-1 text-xs font-medium text-neutral-400">{t("groupVideo")}</div>
                      )}
                      {videoModels.map(renderModelItem)}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 text-neutral-400">
              <button type="button" aria-label="inspiration" className="rounded-lg p-1.5 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800">
                <Lightbulb className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={submit}
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
              onClick={() => addChip(t(`chips.${key}`))}
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
                  {r.status === "done" && r.url && (
                    <>
                      {r.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.url} alt={r.prompt} className="max-h-96 w-auto rounded-xl border border-neutral-200 dark:border-neutral-800" />
                      ) : (
                        <video src={r.url} controls className="max-h-96 w-auto rounded-xl border border-neutral-200 dark:border-neutral-800" />
                      )}
                      {/* 结果操作 */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => download(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t("download")}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveToLibrary(r, true)}
                          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          <LayoutGrid className="h-3.5 w-3.5" />
                          {t("saveToCanvas")}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveToLibrary(r)}
                          disabled={r.saved}
                          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          {r.saved ? <Check className="h-3.5 w-3.5 text-violet-600" /> : <FolderPlus className="h-3.5 w-3.5" />}
                          {r.saved ? t("added") : t("addToLibrary")}
                        </button>
                      </div>
                    </>
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
