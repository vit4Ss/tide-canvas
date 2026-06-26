"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  Clock3,
  Crop,
  Download,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  Video,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { AiModelType, AiTaskStatus, type AiModelVO } from "@/types/ai";
import type { FileVO } from "@/types/file";
import { toast } from "@/components/shared/toast";

const POLL_INTERVAL = 2000;
const MAX_POLL_IMAGE = 5 * 60 * 1000;
const MAX_POLL_VIDEO = 30 * 60 * 1000;
const MODEL_STORAGE_KEY = "tc:home:modelId";
const IMAGE_RATIO_OPTIONS = ["auto", "1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"];
const VIDEO_RATIO_OPTIONS = ["auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const IMAGE_QUALITY_OPTIONS = [
  { value: "low", label: "低画质" },
  { value: "standard", label: "标准画质" },
  { value: "high", label: "高画质" },
] as const;
const IMAGE_RESOLUTION_OPTIONS = ["1K", "2K", "4K"];
const VIDEO_RESOLUTION_OPTIONS = ["480P", "720P", "1080P"];
const CREATION_TYPE_OPTIONS = [
  { id: "image", label: "图片生成", icon: ImageIcon },
  { id: "video", label: "视频生成", icon: Video },
] as const;
const VIDEO_REFERENCE_MODE_OPTIONS = [
  { id: "omni", label: "全能参考", icon: Wand2 },
  { id: "firstLast", label: "首尾帧", icon: LayoutGrid },
  { id: "multiFrame", label: "智能多帧", icon: Video },
] as const;

type Tab = "image" | "video";
type GenStatus = "generating" | "done" | "error";
type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number]["value"];
type VideoReferenceMode = (typeof VIDEO_REFERENCE_MODE_OPTIONS)[number]["id"];

interface GenParams {
  prompt: string;
  kind: Tab;
  modelId: string;
  modelName: string;
  ratio: string;
  imageQuality?: ImageQuality;
  imageResolution?: string;
  videoResolution?: string;
  videoDuration?: number;
  videoAudio?: boolean;
  videoReferenceMode?: VideoReferenceMode;
  references?: FileVO[];
}
interface GenResult extends GenParams {
  id: string;
  status: GenStatus;
  url?: string;
  error?: string;
  saved?: boolean;
}

export function CreativeHero() {
  const t = useTranslations("home");
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const [tab, setTab] = useState<Tab>("image");
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("standard");
  const [imageResolution, setImageResolution] = useState("2K");
  const [videoResolution, setVideoResolution] = useState("720P");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAudio, setVideoAudio] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [referenceModeOpen, setReferenceModeOpen] = useState(false);
  const [referenceDragActive, setReferenceDragActive] = useState(false);
  const [videoReferenceMode, setVideoReferenceMode] = useState<VideoReferenceMode>("omni");
  const [references, setReferences] = useState<FileVO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [results, setResults] = useState<GenResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
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
  const ratioOptions = tab === "video" ? VIDEO_RATIO_OPTIONS : IMAGE_RATIO_OPTIONS;
  const defaultRatio = tab === "video" ? "16:9" : "1:1";
  const effectiveRatio = ratioOptions.includes(ratio) ? ratio : defaultRatio;
  const ratioForRequest = effectiveRatio === "auto" ? "" : effectiveRatio;
  const referenceLimit = tab === "video" ? 12 : 1;
  const canUploadReferences = !uploading && references.length < referenceLimit;
  const titleModeLabel = tab === "video" ? "视频生成" : "图片生成";
  const composerPlaceholder = tab === "video"
    ? "上传最多12个参考素材，输入文字或 @ 参考内容，自由组合图、文、音、视频多元素，定义精彩互动。例如：@图片1 模仿 @视频1 的动作，音色参考 @音频1。"
    : "上传参考图、输入文字或 @ 主体，描述你想生成的图片。";
  const uploadLabel = tab === "video" ? "参考内容" : "参考图";
  const referenceMode = VIDEO_REFERENCE_MODE_OPTIONS.find((item) => item.id === videoReferenceMode) ?? VIDEO_REFERENCE_MODE_OPTIONS[0];
  const referenceModeLabel = references.length ? referenceMode.label + " " + references.length : referenceMode.label;
  const modelLabel = selectedModel?.name ?? (tab === "video" ? "即梦 Seedance 2.0 mini" : "图片 4.7");
  const activeCreation = CREATION_TYPE_OPTIONS.find((item) => item.id === tab) ?? CREATION_TYPE_OPTIONS[1];
  const ActiveCreationIcon = activeCreation.icon;
  const ReferenceModeIcon = referenceMode.icon;
  const busy = results.some((r) => r.status === "generating");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [results.length]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setRatio(next === "video" ? "16:9" : "1:1");
    setTypeOpen(false);
    setRatioOpen(false);
    setReferenceModeOpen(false);
    if (next === "image") {
      setReferences((current) => current.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).slice(0, 1));
    }
    const list = models.filter((m) =>
      next === "video" ? m.type === AiModelType.VIDEO : m.type === AiModelType.IMAGE,
    );
    if (list[0]) setSelectedModelId(list[0].modelId);
  };

  const selectCreationType = (id: (typeof CREATION_TYPE_OPTIONS)[number]["id"]) => {
    if (id === "image" || id === "video") {
      switchTab(id);
      setTypeOpen(false);
      return;
    }
    setTypeOpen(false);
    toast.info("该创作类型暂未开放");
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
    const id = "g" + seqRef.current;
    const refs = p.references ?? [];
    const imageUrls = refs.filter((file) => file.fileType === "image" || file.mimeType?.startsWith("image/")).map((file) => file.fileUrl).filter(Boolean);
    const videoUrls = refs.filter((file) => file.fileType === "video" || file.mimeType?.startsWith("video/")).map((file) => file.fileUrl).filter(Boolean);
    setResults((rs) => [...rs, { ...p, prompt: text, id, status: "generating" }]);
    const mediaParams = p.kind === "video"
      ? {
          ...(p.videoResolution ? { resolution: p.videoResolution.toLowerCase() } : {}),
          ...(p.videoDuration ? { duration: p.videoDuration } : {}),
          generateAudio: Boolean(p.videoAudio),
        }
      : {
          ...(p.imageQuality ? { quality: p.imageQuality } : {}),
          ...(p.imageResolution ? { resolution: p.imageResolution.toLowerCase() } : {}),
        };
    let handler = imageUrls.length ? "image_to_image" : "text_to_image";
    let referenceInput: Record<string, unknown> = imageUrls.length
      ? { imageList: imageUrls, sourceImage: imageUrls[0], references: imageUrls.slice(1) }
      : {};
    if (p.kind === "video") {
      handler = imageUrls.length || videoUrls.length ? "reference_to_video" : "text_to_video";
      referenceInput = {
        ...(imageUrls.length ? { references: imageUrls } : {}),
        ...(videoUrls.length ? { videoReferences: videoUrls } : {}),
      };
      if (imageUrls.length && p.videoReferenceMode === "firstLast") {
        handler = "start_end_to_video";
        referenceInput = { firstFrame: imageUrls[0], lastFrame: imageUrls[1] ?? imageUrls[0] };
      } else if (imageUrls.length && p.videoReferenceMode === "multiFrame") {
        handler = "reference_to_video";
        referenceInput = { references: imageUrls };
      }
    }
    try {
      const res = await aiApi.generate({
        handler,
        modelId: p.modelId || "default",
        input: {
          prompt: text,
          ...(p.ratio ? { aspectRatio: p.ratio, aspect_ratio: p.ratio, ratio: p.ratio } : {}),
          ...mediaParams,
          ...referenceInput,
        },
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
    doGenerate({
      prompt,
      kind: tab,
      modelId: selectedModel?.modelId ?? "",
      modelName: selectedModel?.name ?? "",
      ratio: ratioForRequest,
      imageQuality,
      imageResolution,
      videoResolution,
      videoDuration,
      videoAudio,
      videoReferenceMode,
      references,
    });
    setPrompt("");
  };

  const uploadReferenceFiles = async (picked: File[]) => {
    if (!picked.length) return;
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    const accepted = picked.filter((file) => {
      if (tab === "image") return file.type.startsWith("image/");
      return file.type.startsWith("image/") || file.type.startsWith("video/");
    });
    if (!accepted.length) {
      toast.error(tab === "image" ? "请拖入图片文件" : "请拖入图片或视频文件");
      return;
    }
    if (accepted.length < picked.length) {
      toast.info(tab === "image" ? "已忽略非图片文件" : "已忽略不支持的文件类型");
    }
    const maxReferences = tab === "video" ? 12 : 1;
    const available = Math.max(0, maxReferences - references.length);
    const files = accepted.slice(0, available);
    if (!files.length) {
      toast.error(tab === "video" ? "最多上传 12 个参考素材" : "图片生成最多上传 1 张参考图");
      return;
    }
    if (accepted.length > available) toast.info(tab === "video" ? "最多保留 12 个参考素材，已选择前 " + available + " 个" : "图片生成最多保留 1 张参考图");
    setUploading(true);
    setUploadProgress(0);
    const uploaded: FileVO[] = [];
    for (const file of files) {
      try {
        const result = await uploadFileSmart(file, (progress) => setUploadProgress(progress));
        if (result.success && result.data?.fileUrl) {
          uploaded.push(result.data);
        } else {
          toast.error(result.message || "上传失败：" + file.name);
        }
      } catch (error) {
        toast.error("上传失败：" + ((error as Error)?.message || file.name));
      }
    }
    if (uploaded.length) {
      setReferences((current) => [...current, ...uploaded].slice(0, maxReferences));
      toast.success(uploaded.length > 1 ? "已上传 " + uploaded.length + " 个参考素材" : "参考素材已上传");
    }
    setUploading(false);
    setUploadProgress(0);
  };

  const handleReferenceChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadReferenceFiles(picked);
  };

  const handleReferenceDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (canUploadReferences) setReferenceDragActive(true);
  };

  const handleReferenceDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (canUploadReferences) {
      event.dataTransfer.dropEffect = "copy";
      setReferenceDragActive(true);
    } else {
      event.dataTransfer.dropEffect = "none";
    }
  };

  const handleReferenceDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setReferenceDragActive(false);
    }
  };

  const handleReferenceDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setReferenceDragActive(false);
    if (!canUploadReferences) return;
    await uploadReferenceFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const removeReference = (fileUrl: string) => {
    setReferences((current) => current.filter((file) => file.fileUrl !== fileUrl));
  };

  const insertReferenceMention = () => {
    const token = references.length ? "@参考" + references.length : "@";
    setPrompt((current) => (current.endsWith(" ") || current.length === 0 ? current : current + " ") + token);
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
      a.download = "tidecanvas-" + r.id + "." + ext;
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
        if (thenOpenCanvas) window.open("/canvas/new", "_blank", "noopener");
      } else {
        toast.error(res.message || t("saveFailed"));
      }
    } catch {
      toast.error(t("saveFailed"));
    }
  };

  return (
    <section className="relative z-30 flex min-h-screen flex-col overflow-hidden bg-[#f7f8fa] px-4 pt-16 text-neutral-950 sm:px-6 lg:px-8 dark:bg-[#101114] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[340px] bg-[linear-gradient(to_bottom,#f3f5f8,rgba(247,248,250,0.86)_68%,#f7f8fa)] dark:bg-[linear-gradient(to_bottom,#17181d,rgba(16,17,20,0.9)_68%,#101114)]" />

      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1280px] flex-col">
        <div className={(results.length === 0 ? "px-1 pt-8 sm:pt-12" : "min-h-0 flex-1 px-1 pt-8 sm:pt-12")}>
          {results.length === 0 ? (
            <div className="flex flex-col items-center pb-8 pt-12 text-center sm:pt-16">
              <h1 className="text-[24px] font-semibold leading-tight tracking-normal text-neutral-950 sm:text-[28px] dark:text-white">
                开启你的
                <button
                  type="button"
                  onClick={() => switchTab(tab === "video" ? "image" : "video")}
                  className="mx-2 inline-flex items-center gap-0.5 align-baseline text-[#00a7d7] transition-colors hover:text-[#008fbd]"
                >
                  {titleModeLabel}
                  <ChevronDown className={(typeOpen ? "rotate-180" : "rotate-0") + " h-4 w-4 transition-transform"} />
                </button>
                即刻造梦！
              </h1>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[900px] space-y-5 pb-8 pt-4 text-left">
              {results.map((r) => (
                <div key={r.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[78%] rounded-3xl rounded-br-lg bg-neutral-950 px-4 py-3 text-sm leading-6 text-white shadow-[0_10px_28px_rgba(15,23,42,0.14)] dark:bg-white dark:text-neutral-950">
                      {r.prompt}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[86%] rounded-3xl rounded-bl-lg bg-white/88 p-3 shadow-[0_16px_45px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/8 dark:ring-white/10">
                      <div className="flex flex-wrap items-center gap-2 px-1 pb-3 text-xs text-neutral-500 dark:text-neutral-400">
                        <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 dark:bg-white/8">
                          {r.kind === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          {r.modelName || t("model")}
                        </span>
                        {r.ratio && (
                          <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 dark:bg-white/8">
                            <Crop className="h-3 w-3" />
                            {r.ratio}
                          </span>
                        )}
                      </div>

                      {r.status === "generating" && (
                        <div className="flex h-44 w-[360px] max-w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/70 text-sm text-neutral-400 dark:border-white/10 dark:bg-white/5">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("generating")}
                        </div>
                      )}
                      {r.status === "done" && r.url && (
                        r.kind === "video" ? (
                          <video src={r.url} controls className="max-h-96 w-auto max-w-full rounded-2xl border border-neutral-200 dark:border-white/10" />
                        ) : (
                          <img src={r.url} alt={r.prompt} className="max-h-96 w-auto max-w-full rounded-2xl border border-neutral-200 dark:border-white/10" />
                        )
                      )}
                      {r.status === "error" && <p className="px-1 py-3 text-sm text-red-500">{r.error || t("genFailed")}</p>}

                      {r.status === "done" && r.url && (
                        <div className="mt-3 flex flex-wrap gap-2 px-1">
                          <ActionBtn onClick={() => doGenerate(r)} icon={<RefreshCw className="h-3.5 w-3.5" />} label={t("regenerate")} />
                          <ActionBtn onClick={() => download(r)} icon={<Download className="h-3.5 w-3.5" />} label={t("download")} />
                          <ActionBtn onClick={() => saveToLibrary(r, true)} icon={<LayoutGrid className="h-3.5 w-3.5" />} label={t("saveToCanvas")} />
                          <ActionBtn
                            onClick={() => saveToLibrary(r)}
                            disabled={r.saved}
                            icon={r.saved ? <Check className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
                            label={r.saved ? t("added") : t("addToLibrary")}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className={(results.length === 0
          ? "relative z-40 -mx-4 px-4 pb-0 pt-0 sm:-mx-6 sm:px-6"
          : "sticky bottom-4 z-40 -mx-4 bg-[linear-gradient(to_top,#f7f8fa_74%,rgba(247,248,250,0))] px-4 pb-0 pt-3 sm:-mx-6 sm:px-6 dark:bg-[linear-gradient(to_top,#101114_74%,rgba(16,17,20,0))]")}>
          <div className="mx-auto w-full max-w-[1200px]">
            <div className="relative z-30 rounded-[24px] bg-white p-4 text-left shadow-[0_18px_55px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.06] backdrop-blur-2xl dark:bg-[#1d1e23] dark:ring-white/10">
              <div className="flex gap-4 sm:gap-5">
                <input ref={fileInputRef} type="file" multiple={tab === "video"} accept={tab === "video" ? "image/*,video/*" : "image/*"} className="hidden" onChange={handleReferenceChange} />
                <div
                  className="flex w-[68px] shrink-0 flex-col items-center gap-2 pt-1"
                  onDragEnter={handleReferenceDragEnter}
                  onDragOver={handleReferenceDragOver}
                  onDragLeave={handleReferenceDragLeave}
                  onDrop={handleReferenceDrop}
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canUploadReferences}
                    className={(referenceDragActive
                      ? "-translate-y-0.5 bg-sky-50 text-[#00a7d7] ring-2 ring-[#00a7d7]/55 dark:bg-sky-400/10 dark:text-[#43c9ef] dark:ring-[#43c9ef]/60"
                      : "bg-neutral-100 text-neutral-500 ring-1 ring-black/[0.04] hover:-translate-y-0.5 hover:bg-neutral-50 dark:bg-white/10 dark:text-neutral-300 dark:ring-white/10 dark:hover:bg-white/14") +
                      " group relative flex h-[68px] w-[50px] rotate-[-7deg] flex-col items-center justify-center gap-1 rounded-[4px] shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"}
                    title={tab === "video" ? "点击或拖拽上传参考素材" : "点击或拖拽上传参考图"}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span className="text-[10px] font-medium leading-tight">{uploadLabel}</span>
                  </button>
                  {uploading && <span className="text-[10px] text-neutral-400">{uploadProgress || 0}%</span>}
                </div>

                <div className="min-w-0 flex-1">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={composerPlaceholder}
                    rows={3}
                    style={{ outline: "none", boxShadow: "none", border: "none" }}
                    className="block min-h-[86px] w-full resize-none border-0 bg-transparent px-0 pt-1 text-[14px] leading-6 text-neutral-800 placeholder:text-neutral-400 outline-none focus:outline-none focus:ring-0 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  />

                  {references.length > 0 && (
                    <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {references.map((file, index) => {
                        const isImage = file.fileType === "image" || file.mimeType?.startsWith("image/");
                        return (
                          <div key={file.fileUrl} className="group/ref relative flex h-12 min-w-[138px] items-center gap-2 rounded-xl bg-neutral-50 px-2 ring-1 ring-black/[0.05] dark:bg-white/8 dark:ring-white/10">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white dark:bg-white/10">
                              {isImage ? (
                                <img src={file.fileUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <Video className="h-4 w-4 text-neutral-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-neutral-700 dark:text-neutral-200">@参考{index + 1}</div>
                              <div className="truncate text-[10px] text-neutral-400">{file.originalName}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeReference(file.fileUrl)}
                              className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm group-hover/ref:flex dark:bg-white dark:text-neutral-950"
                              title="移除参考"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => { setTypeOpen((open) => !open); setModelOpen(false); setRatioOpen(false); setReferenceModeOpen(false); }}
                      className="flex h-9 items-center gap-1.5 rounded-2xl bg-white px-3 text-sm font-semibold text-[#00a7d7] ring-1 ring-black/[0.06] transition-colors hover:bg-neutral-50 dark:bg-white/8 dark:text-[#43c9ef] dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <ActiveCreationIcon className="h-4 w-4" />
                      {activeCreation.label}
                      <ChevronDown className={(typeOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                    </button>
                    {typeOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setTypeOpen(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-3 w-[196px] rounded-2xl bg-white p-1.5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.08] dark:bg-[#25262b] dark:ring-white/10">
                          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-neutral-400">创作类型</div>
                          {CREATION_TYPE_OPTIONS.map((item) => {
                            const Icon = item.icon;
                            const active = item.id === tab;
                            const supported = item.id === "image" || item.id === "video";
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => selectCreationType(item.id)}
                                className={(active
                                  ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white"
                                  : supported
                                    ? "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/8"
                                    : "text-neutral-500 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-white/5") +
                                  " flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-sm transition-colors"}
                              >
                                <Icon className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                                {active && <Check className="h-4 w-4 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => { setModelOpen((o) => !o); setTypeOpen(false); setRatioOpen(false); setReferenceModeOpen(false); }}
                      className="flex h-9 max-w-[220px] items-center gap-1.5 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-100 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="truncate">{modelLabel}</span>
                      <ChevronDown className={(modelOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                    </button>
                    {modelOpen && tabModels.length > 0 && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-3 max-h-72 w-64 overflow-auto rounded-2xl bg-white p-1 shadow-xl ring-1 ring-black/10 dark:bg-[#25262b] dark:ring-white/10">
                          {tabModels.map((m) => (
                            <button
                              key={m.modelId}
                              type="button"
                              onClick={() => selectModel(m.modelId)}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/8"
                            >
                              <span className="flex-1 truncate text-left">{m.name}</span>
                              {m.modelId === selectedModelId && <Check className="h-4 w-4 shrink-0 text-neutral-900 dark:text-white" />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {tab === "video" && (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => { setReferenceModeOpen((open) => !open); setTypeOpen(false); setModelOpen(false); setRatioOpen(false); }}
                        className="flex h-9 items-center gap-1.5 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-100 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                      >
                        <ReferenceModeIcon className="h-3.5 w-3.5" />
                        {referenceModeLabel}
                        <ChevronDown className={(referenceModeOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                      </button>
                      {referenceModeOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setReferenceModeOpen(false)} />
                          <div className="absolute bottom-full left-0 z-50 mb-3 w-[184px] rounded-2xl bg-white p-1.5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.08] dark:bg-[#25262b] dark:ring-white/10">
                            {VIDEO_REFERENCE_MODE_OPTIONS.map((item) => {
                              const Icon = item.icon;
                              const active = item.id === videoReferenceMode;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => { setVideoReferenceMode(item.id); setReferenceModeOpen(false); }}
                                  className={(active
                                    ? "bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white"
                                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/8") +
                                    " flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-sm transition-colors"}
                                >
                                  <Icon className="h-4 w-4 shrink-0" />
                                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                                  {active && <Check className="h-4 w-4 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => { setRatioOpen((o) => !o); setTypeOpen(false); setModelOpen(false); setReferenceModeOpen(false); }}
                      className="flex h-9 max-w-[280px] items-center gap-2 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-100 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <Crop className="h-3.5 w-3.5" />
                      <span className="truncate">{effectiveRatio === "auto" ? "自适应" : effectiveRatio}</span>
                      <span className="h-4 w-px bg-neutral-200 dark:bg-white/10" />
                      <span>{tab === "video" ? videoResolution : imageResolution}</span>
                      <ChevronDown className={(ratioOpen ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
                    </button>
                    {ratioOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setRatioOpen(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-3 w-[338px] max-w-[calc(100vw-32px)] rounded-3xl bg-white p-3 text-left shadow-[0_18px_60px_rgba(15,23,42,0.18)] ring-1 ring-black/10 dark:bg-[#25262b] dark:ring-white/10">
                          {tab === "video" ? (
                            <VideoParamPanel
                              ratio={effectiveRatio}
                              onRatioChange={setRatio}
                              resolution={videoResolution}
                              onResolutionChange={setVideoResolution}
                              duration={videoDuration}
                              onDurationChange={setVideoDuration}
                              audio={videoAudio}
                              onAudioChange={setVideoAudio}
                            />
                          ) : (
                            <ImageParamPanel
                              ratio={effectiveRatio}
                              onRatioChange={setRatio}
                              quality={imageQuality}
                              onQualityChange={setImageQuality}
                              resolution={imageResolution}
                              onResolutionChange={setImageResolution}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {tab === "video" && (
                    <button
                      type="button"
                      onClick={() => setVideoDuration((value) => (value === 5 ? 10 : 5))}
                      className="flex h-9 items-center gap-1.5 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-100 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    >
                      <Clock3 className="h-3.5 w-3.5" />
                      {videoDuration}s
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={insertReferenceMention}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-50 text-neutral-700 ring-1 ring-black/[0.04] transition-colors hover:bg-neutral-100 dark:bg-white/8 dark:text-neutral-200 dark:ring-white/10 dark:hover:bg-white/12"
                    title="插入引用"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden items-center gap-1 text-xs font-semibold text-neutral-950 sm:flex dark:text-white" title="本次生成消耗积分">
                    <Zap className="h-3.5 w-3.5 fill-neutral-950 text-neutral-950 dark:fill-white dark:text-white" />
                    {selectedModel?.pointCost ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!prompt.trim() || busy || uploading}
                    aria-label={t("send")}
                    className={(prompt.trim() && !busy && !uploading
                      ? "bg-neutral-200 text-neutral-500 hover:bg-neutral-300 hover:text-neutral-700 dark:bg-white/18 dark:text-white dark:hover:bg-white/25"
                      : "cursor-not-allowed bg-neutral-100 text-neutral-300 dark:bg-white/10 dark:text-neutral-600") +
                      " flex h-10 w-10 items-center justify-center rounded-full transition-colors"}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImageParamPanel({
  ratio,
  onRatioChange,
  quality,
  onQualityChange,
  resolution,
  onResolutionChange,
}: {
  ratio: string;
  onRatioChange: (value: string) => void;
  quality: ImageQuality;
  onQualityChange: (value: ImageQuality) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <ParamSection title="画质">
        <SegmentedRow>
          {IMAGE_QUALITY_OPTIONS.map((item) => (
            <SegmentButton key={item.value} active={quality === item.value} onClick={() => onQualityChange(item.value)}>
              {item.label}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="清晰度">
        <SegmentedRow>
          {IMAGE_RESOLUTION_OPTIONS.map((item) => (
            <SegmentButton key={item} active={resolution === item} onClick={() => onResolutionChange(item)}>
              {item}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <ParamSection title="比例">
        <div className="grid grid-cols-5 gap-2">
          {IMAGE_RATIO_OPTIONS.map((item) => (
            <RatioTile key={item} value={item} active={ratio === item} onClick={() => onRatioChange(item)} />
          ))}
        </div>
      </ParamSection>
    </div>
  );
}

function VideoParamPanel({
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  duration,
  onDurationChange,
  audio,
  onAudioChange,
}: {
  ratio: string;
  onRatioChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  audio: boolean;
  onAudioChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <ParamSection title="比例">
        <div className="grid grid-cols-5 gap-2">
          {VIDEO_RATIO_OPTIONS.map((item) => (
            <RatioTile key={item} value={item} active={ratio === item} onClick={() => onRatioChange(item)} />
          ))}
        </div>
      </ParamSection>
      <ParamSection title="清晰度">
        <SegmentedRow>
          {VIDEO_RESOLUTION_OPTIONS.map((item) => (
            <SegmentButton key={item} active={resolution === item} onClick={() => onResolutionChange(item)}>
              {item}
            </SegmentButton>
          ))}
        </SegmentedRow>
      </ParamSection>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[13px] text-neutral-500 dark:text-neutral-400">
          <span>视频时长</span>
          <span>{duration}s</span>
        </div>
        <input
          type="range"
          min={5}
          max={10}
          step={1}
          value={duration}
          onChange={(event) => onDurationChange(Number(event.target.value))}
          className="slider-thin"
          style={{ "--pct": ((duration - 5) / 5) * 100 + "%" } as React.CSSProperties}
        />
        <div className="mt-0.5 flex justify-between text-xs text-neutral-400">
          <span>5s</span>
          <span>10s</span>
        </div>
      </div>
      <ParamSection title="生成音频">
        <SegmentedRow>
          <SegmentButton active={audio} onClick={() => onAudioChange(true)}>开启</SegmentButton>
          <SegmentButton active={!audio} onClick={() => onAudioChange(false)}>关闭</SegmentButton>
        </SegmentedRow>
      </ParamSection>
    </div>
  );
}

function ParamSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-neutral-500 dark:text-neutral-400">{title}</div>
      {children}
    </div>
  );
}

function SegmentedRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={(active
        ? "border-neutral-950 text-neutral-950 dark:border-white dark:text-white"
        : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-950 dark:border-white/10 dark:text-neutral-300 dark:hover:border-white/25 dark:hover:text-white") +
        " h-8 rounded-xl border bg-white text-sm font-medium transition-colors dark:bg-transparent"}
    >
      {children}
    </button>
  );
}

function RatioTile({ value, active, onClick }: { value: string; active: boolean; onClick: () => void }) {
  const label = value === "auto" ? "自适应" : value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={(active
        ? "border-neutral-950 text-neutral-950 dark:border-white dark:text-white"
        : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-950 dark:border-white/10 dark:text-neutral-300 dark:hover:border-white/25 dark:hover:text-white") +
        " flex h-[46px] flex-col items-center justify-center gap-1 rounded-xl border bg-white text-xs font-medium transition-colors dark:bg-transparent"}
    >
      <RatioShape value={value} />
      <span>{label}</span>
    </button>
  );
}

function RatioShape({ value }: { value: string }) {
  if (value === "auto") {
    return <span className="h-4 w-4 rounded-[3px] border border-current opacity-55" />;
  }
  const [wRaw, hRaw] = value.split(":").map((part) => Number(part));
  const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1;
  const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 1;
  const max = 18;
  let width = max;
  let height = max;
  if (w >= h) {
    height = Math.max(6, Math.round((h / w) * max));
  } else {
    width = Math.max(6, Math.round((w / h) * max));
  }
  return <span className="rounded-[3px] border border-current opacity-55" style={{ width, height }} />;
}

function ActionBtn({ onClick, icon, label, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-white/8 dark:text-neutral-300 dark:hover:bg-white/12"
    >
      {icon}
      {label}
    </button>
  );
}
