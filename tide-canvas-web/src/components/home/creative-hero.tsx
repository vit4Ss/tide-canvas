"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Layers,
  ChevronDown,
  Check,
  Zap,
  Loader2,
  Download,
  FolderPlus,
  LayoutGrid,
  RefreshCw,
  ArrowUp,
  Crop,
  Image as ImageIcon,
  Video,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { aiApi, fileApi } from "@/lib/api";
import { AiTaskStatus, AiModelType, type AiModelVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";

const POLL_INTERVAL = 2000;
const MAX_POLL_IMAGE = 5 * 60 * 1000;
const MAX_POLL_VIDEO = 30 * 60 * 1000;
const MODEL_STORAGE_KEY = "tc:home:modelId";
const RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

type Tab = "image" | "video";
type GenStatus = "generating" | "done" | "error";
interface GenParams {
  prompt: string;
  kind: Tab;
  modelId: string;
  modelName: string;
  ratio: string;
}
interface GenResult extends GenParams {
  id: string;
  status: GenStatus;
  url?: string;
  error?: string;
  saved?: boolean;
}

/**
 * 主页中央创作入口（仿 LiblibAI 生成工作台）：
 * tabs 切换图片/视频生成；工具栏选模型 + 比例 + 看积分；提交走 aiApi 异步任务 + 轮询；
 * 结果块带模型/比例标签与操作（再次生成 / 下载 / 存到画布 / 加入素材库）。
 */
export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { isLoggedIn, user } = useAuth();
  const name = user?.nickname || user?.username || t("guestName");
  const examples = (t.raw("examples") as string[]) ?? [];
  const [tab, setTab] = useState<Tab>("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [results, setResults] = useState<GenResult[]>([]);
  const seqRef = useRef(0);

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
        const img = usable.find((m) => m.type === AiModelType.IMAGE);
        const restored = saved && usable.find((m) => m.modelId === saved);
        setSelectedModelId((restored ? saved : img?.modelId) ?? usable[0]?.modelId ?? "");
      })
      .catch(() => {});
  }, []);

  const tabModels = models.filter((m) =>
    tab === "video" ? m.type === AiModelType.VIDEO : m.type === AiModelType.IMAGE,
  );
  const selectedModel = tabModels.find((m) => m.modelId === selectedModelId) ?? tabModels[0];

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const list = models.filter((m) =>
      next === "video" ? m.type === AiModelType.VIDEO : m.type === AiModelType.IMAGE,
    );
    if (list[0]) setSelectedModelId(list[0].modelId);
  };

  const selectModel = (id: string) => {
    setSelectedModelId(id);
    setModelOpen(false);
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  };

  const patch = (id: string, data: Partial<GenResult>) =>
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const poll = (taskId: number, id: string, maxPoll: number) => {
    let deadline = 0;
    const tick = async () => {
      if (deadline === 0) deadline = Date.now() + maxPoll;
      if (Date.now() > deadline) {
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

  const doGenerate = async (p: GenParams) => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const text = p.prompt.trim();
    if (!text) return;
    seqRef.current += 1;
    const id = `g${seqRef.current}`;
    setResults((rs) => [{ ...p, prompt: text, id, status: "generating" }, ...rs]);
    try {
      const res = await aiApi.generate({
        handler: p.kind === "video" ? "text_to_video" : "text_to_image",
        modelId: p.modelId || "default",
        input: { prompt: text, aspectRatio: p.ratio },
      });
      if (!res.success) {
        patch(id, { status: "error", error: res.message || t("genFailed") });
        return;
      }
      poll(res.data.id, id, p.kind === "video" ? MAX_POLL_VIDEO : MAX_POLL_IMAGE);
    } catch {
      patch(id, { status: "error", error: t("genFailed") });
    }
  };

  const submit = () => {
    doGenerate({ prompt, kind: tab, modelId: selectedModel?.modelId ?? "", modelName: selectedModel?.name ?? "", ratio });
    setPrompt("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

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
      const res = await fileApi.saveFromUrl({ url: r.url, fileType: r.kind, originalName: r.prompt.slice(0, 40) });
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

  return (
    <section className="relative px-4 pt-16 pb-10 sm:px-6 sm:pt-24 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-gradient-to-b from-violet-100/70 via-violet-50/30 to-transparent dark:from-violet-950/30 dark:via-violet-950/10" />
      <div className="mx-auto max-w-3xl">
        {/* 个性化问候 */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 dark:bg-white">
            <Layers className="h-5 w-5 text-white dark:text-neutral-900" />
          </div>
          <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">{t("greeting", { name })}</h1>
        </div>

        {/* 创作输入卡片 */}
        <div className="mt-8 rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          {/* tabs */}
          <div className="flex items-center gap-1 px-2 pt-2">
            {(["image", "video"] as const).map((tn) => (
              <button
                key={tn}
                type="button"
                onClick={() => switchTab(tn)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === tn
                    ? "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                    : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {tn === "video" ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                {t(tn === "video" ? "tabVideo" : "tabImage")}
              </button>
            ))}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            rows={2}
            style={{ outline: "none", boxShadow: "none", border: "none" }}
            className="block w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none focus:outline-none focus:ring-0 dark:text-neutral-100"
          />

          {/* 工具栏 */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              {/* 模型下拉 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setModelOpen((o) => !o); setRatioOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {tab === "video" ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  <span className="max-w-[120px] truncate">{selectedModel?.name || t("model")}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {modelOpen && tabModels.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                    <div className="absolute top-full left-0 z-20 mt-2 max-h-72 w-64 overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      {tabModels.map((m) => (
                        <button
                          key={m.modelId}
                          type="button"
                          onClick={() => selectModel(m.modelId)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          <span className="flex-1 truncate text-left">{m.name}</span>
                          <span className="flex items-center gap-0.5 text-xs text-neutral-400">
                            <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {m.pointCost}
                          </span>
                          {m.modelId === selectedModelId && <Check className="h-4 w-4 shrink-0 text-violet-600" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* 比例下拉 */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Crop className="h-3.5 w-3.5" />
                  {ratio}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {ratioOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setRatioOpen(false)} />
                    <div className="absolute top-full left-0 z-20 mt-2 w-28 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                      {RATIOS.map((rt) => (
                        <button
                          key={rt}
                          type="button"
                          onClick={() => { setRatio(rt); setRatioOpen(false); }}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {rt}
                          {rt === ratio && <Check className="h-4 w-4 text-violet-600" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedModel && (
                <span className="flex items-center gap-0.5 text-xs font-medium text-neutral-400">
                  <Zap className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {selectedModel.pointCost}
                </span>
              )}
              <button
                type="button"
                onClick={submit}
                aria-label={t("send")}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white transition-colors hover:bg-violet-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* 示例提示词 */}
        {examples.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-neutral-200 bg-white/70 px-3.5 py-1.5 text-sm text-neutral-600 transition-colors hover:border-violet-300 hover:text-violet-700 dark:border-neutral-700 dark:bg-neutral-900/70 dark:text-neutral-300 dark:hover:text-violet-300"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* 生成结果流 */}
        {results.length > 0 && (
          <div className="mt-8 space-y-6">
            {results.map((r) => (
              <div key={r.id}>
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{r.prompt}</p>
                {/* 元信息标签 */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
                    {r.kind === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                    {r.modelName || t("model")}
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
                    <Crop className="h-3 w-3" />
                    {r.ratio}
                  </span>
                </div>

                <div className="mt-3">
                  {r.status === "generating" && (
                    <div className="flex h-40 w-full max-w-sm items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 text-sm text-neutral-400 dark:border-neutral-700">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("generating")}
                    </div>
                  )}
                  {r.status === "done" && r.url && (
                    r.kind === "video" ? (
                      <video src={r.url} controls className="max-h-96 w-auto rounded-xl border border-neutral-200 dark:border-neutral-800" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.url} alt={r.prompt} className="max-h-96 w-auto rounded-xl border border-neutral-200 dark:border-neutral-800" />
                    )
                  )}
                  {r.status === "error" && (
                    <p className="text-sm text-red-500">{r.error || t("genFailed")}</p>
                  )}
                </div>

                {r.status === "done" && r.url && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionBtn onClick={() => doGenerate(r)} icon={<RefreshCw className="h-3.5 w-3.5" />} label={t("regenerate")} />
                    <ActionBtn onClick={() => download(r)} icon={<Download className="h-3.5 w-3.5" />} label={t("download")} />
                    <ActionBtn onClick={() => saveToLibrary(r, true)} icon={<LayoutGrid className="h-3.5 w-3.5" />} label={t("saveToCanvas")} />
                    <ActionBtn
                      onClick={() => saveToLibrary(r)}
                      disabled={r.saved}
                      icon={r.saved ? <Check className="h-3.5 w-3.5 text-violet-600" /> : <FolderPlus className="h-3.5 w-3.5" />}
                      label={r.saved ? t("added") : t("addToLibrary")}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionBtn({ onClick, icon, label, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {icon}
      {label}
    </button>
  );
}
