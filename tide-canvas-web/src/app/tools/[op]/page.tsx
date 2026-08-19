"use client";

/* ============================================================================
   /tools/[op] — 单个智能工具的全屏处理页（工具中心 /tools 的卡片指向这里）。

   与创作台的区别：这里是「封装好的完整功能」——提示词由服务端 handler 预置
   （upscale / remove_bg / outpaint / remove_object / relight，与创作台结果卡的
   一键操作共用同一批后端处理器与模型解析策略），用户只需上传素材。
   流程：上传 → 确认模型与积分 → 处理 → 原件/结果对照 → 下载；其中：
     - 局部重绘（image_to_image）：一句修改描述；
     - 视频超分（video_upscale）：目标分辨率档位。

   按工具的 type 分流素材形态：image 收图片，video 收视频（模型取「超分」类目、
   入参只发 videoUrl + targetResolution，该接口不接收 prompt）。

   工具定义（标题/文案/处理器/类型/封面等）来自后台「工具管理」
   （GET /api/ai/tools，公开接口）；接口未应答或失败时用 FALLBACK_OPS 出厂兜底，
   页面永不空白。

   任务同样落在 /api/ai/tasks，但只在工具中心的「工具作品」与资产中展示，
   不混入创作台生成历史。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Images, Loader2, Plus, X } from "lucide-react";
import { AssetPickerModal } from "@/components/studio/create-studio/asset-picker-modal";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { loadToolCoverPool } from "@/lib/tool-cover-pool";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { AiTaskStatus, type AiToolVO } from "@/types/ai";
import { coverBg } from "@/lib/mesh";
import {
  resolveImageToolPointCost,
  resolveUpscalePointCost,
  resolveUpscalePointRate,
} from "@/lib/price-matrix";
import { notifyAssetLibraryChanged } from "@/lib/asset-library-events";
import {
  FALLBACK_TOOLS,
  resolveToolCoverUrl,
  UPSCALE_RESOLUTIONS,
  type ToolType,
} from "@/lib/ai-tools-catalog";
import {
  commitAcceptedAiGeneration,
  isAmbiguousAiCreateCode,
  recoverableAiGenerations,
  type PendingAiGeneration,
} from "@/lib/ai-generation-idempotency";

interface ToolDef {
  /** stable ai_tools key; persisted on generated tasks for source attribution */
  key: string;
  title: string;
  desc: string;
  /** backend generation handler (internal/handler/ai handlerRegistry) */
  handler: string;
  /** 处理的素材形态：image 收图片，video 收视频（视频超分） */
  type: ToolType;
  /** prefer a 4K-capable model + pass the 4k resolution hint (高清放大) */
  hd?: boolean;
  /** requires a user prompt describing the change (局部重绘) */
  needPrompt?: boolean;
  /** mesh-gradient cover hues — 与首页核心能力卡同源（@/content/home CAPS） */
  cover: [number, number, number];
  /** 后台固定封面；空值按工具 key 复用公开作品图。 */
  coverUrl?: string;
  placeholder?: string;
  /** 额外生成参数——随请求原样下发（计费按这些原始入参解析，须由客户端发送） */
  extra?: Record<string, unknown>;
}

/** 出厂兜底：/api/ai/tools 未应答或失败时按此渲染，页面永不空白。
    数据源自 lib/ai-tools-catalog(与工具中心页共用,只维护一份)。 */
const FALLBACK_OPS: Record<string, ToolDef> = Object.fromEntries(
  FALLBACK_TOOLS.map((t) => [t.key, t]),
);

/** 图片工具统一先确认模型价格；prompt 额外收局部重绘描述，options 收超分档位。 */
type Phase = "idle" | "uploading" | "confirm" | "prompt" | "options" | "running" | "done" | "failed";
type VideoMetadataState = "idle" | "loading" | "ready" | "error";

/** 素材预览：视频工具用 video 元素（带控件，可直接播放确认），图片用 img。 */
function ToolMedia({
  src,
  alt,
  video,
  onDuration,
  onMetadataError,
}: {
  src: string;
  alt: string;
  video: boolean;
  onDuration?: (seconds: number) => void;
  onMetadataError?: () => void;
}) {
  if (video) {
    return (
      <CapturableVideo
        src={src}
        controls
        playsInline
        preload="metadata"
        aria-label={alt}
        onLoadedMetadata={(event) => onDuration?.(event.currentTarget.duration)}
        onError={() => onMetadataError?.()}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} />;
}

function recoveryRecord(entry: PendingAiGeneration): Record<string, unknown> {
  return entry.recovery && typeof entry.recovery === "object"
    ? entry.recovery as Record<string, unknown>
    : {};
}

function sourceFromJournal(entry: PendingAiGeneration): string {
  const recovery = recoveryRecord(entry);
  if (typeof recovery.source === "string") return recovery.source;
  const input = entry.payload?.input;
  if (input && typeof input.videoUrl === "string") return input.videoUrl;
  if (input && typeof input.sourceImage === "string") return input.sourceImage;
  return input && Array.isArray(input.imageList) && typeof input.imageList[0] === "string"
    ? input.imageList[0]
    : "";
}

/** 模型列表读取失败与“确实没有已上架模型”必须区分，确认页才能给出正确恢复动作。 */
async function listVideoModels(): Promise<StudioModelVO[]> {
  const r = await marketApi.studioModels("upscale");
  if (!r.success || !Array.isArray(r.data)) throw new Error(r.message || "模型读取失败");
  return r.data;
}

async function listImageModels(): Promise<StudioModelVO[]> {
  const r = await marketApi.studioModels("image");
  if (!r.success || !Array.isArray(r.data)) throw new Error(r.message || "模型读取失败");
  return r.data;
}

/** 后台可能没有配置档位，也可能残留超分接口不支持的值；只展示可提交档位。 */
function upscaleResolutionsFor(model: StudioModelVO | null): string[] {
  const allowed = UPSCALE_RESOLUTIONS as readonly string[];
  const configured = (model?.config?.resolutions ?? [])
    .map((resolution) => (typeof resolution === "string" ? resolution.toLowerCase() : ""))
    .filter((resolution) => allowed.includes(resolution));
  return configured.length ? Array.from(new Set(configured)) : [...UPSCALE_RESOLUTIONS];
}

function normalizeVideoDuration(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  // 统一到毫秒，且不向下截断计费时长，避免恰好跨过积分取整边界时少计。
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed * 1_000) / 1_000 : 0;
}

function compactNumber(value: number): string {
  return String(value);
}

function videoDurationLabel(seconds: number): string {
  return `${compactNumber(seconds)} 秒`;
}

function pointRateLabel(rate: number): string {
  return `${compactNumber(rate)} 积分/秒`;
}

/** 与服务端 resolveCost 同口径：新每秒价优先，旧模型才回退到矩阵与固定价。 */
function upscalePointCost(model: StudioModelVO | null, durationSeconds: number, resolution: string): number {
  if (!model || !resolution) return 0;
  return resolveUpscalePointCost(model.config, durationSeconds, resolution, model.pointCost);
}

function pointCostLabel(cost: number): string {
  return cost > 0 ? `${cost} 积分` : "免费";
}

/** 图片工具与创作台一键操作同策略，但选择发生在确认页渲染前；执行时复用同一模型。 */
function chooseImageModel(def: ToolDef | undefined, models: StudioModelVO[]): StudioModelVO | null {
  if (!def || def.type !== "image") return null;
  const editable = models.filter(
    (m) =>
      (m.config?.operations?.includes("edits") ?? false) ||
      (m.config?.modes?.includes("i2i") ?? false),
  );
  const pool = editable.length ? editable : models;
  if (!pool.length) return null;
  const is4k = (m: StudioModelVO) =>
    /4k/i.test(m.modelKey || "") || /4k|4K/.test(m.name);
  if (def.hd) return pool.find(is4k) ?? pool[0];
  return (
    pool.find((m) => /nano-banana-2$/.test(m.modelKey || "")) ??
    pool.find((m) => /gpt-image-2/.test(m.modelKey || "")) ??
    pool[0]
  );
}

function imageToolPointCost(model: StudioModelVO | null, def: ToolDef | undefined): number {
  if (!model || !def) return 0;
  return resolveImageToolPointCost(model.config, def.extra ?? {}, model.pointCost);
}

interface ModelDisclosureProps {
  model: StudioModelVO | null;
  pointCost: number;
  priceLabel?: string;
  loading: boolean;
  error: string;
  emptyLabel?: string;
  onRetry: () => void;
}

function ModelDisclosure({
  model,
  pointCost,
  priceLabel,
  loading,
  error,
  emptyLabel = "暂无可用的图像编辑模型",
  onRetry,
}: ModelDisclosureProps) {
  if (loading) {
    return (
      <div className="tp-model-disclosure muted" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>正在读取模型与价格…</span>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="tp-model-disclosure muted" role={error ? "alert" : "status"}>
        <span>{error || emptyLabel}</span>
        <button type="button" className="tp-inline-retry" onClick={onRetry}>
          重新加载
        </button>
      </div>
    );
  }
  return (
    <div className="tp-model-disclosure">
      <span className="tp-model-copy">
        <strong>{model.name}</strong>
        <small>本工具将调用此模型处理</small>
      </span>
      <strong className="tp-disclosure-price">{priceLabel ?? pointCostLabel(pointCost)}</strong>
    </div>
  );
}

export default function ToolPage() {
  const router = useRouter();
  const params = useParams<{ op: string }>();

  // loading 与 fallback 分开：接口未返回时不能先摆出可能已下线的兜底工具。
  const [tools, setTools] = useState<AiToolVO[]>([]);
  const [toolCatalogState, setToolCatalogState] = useState<"loading" | "ready" | "fallback">("loading");
  const [coverPool, setCoverPool] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    aiApi.tools()
      .then((res) => {
        if (!alive) return;
        if (res.success && Array.isArray(res.data)) {
          setTools(res.data);
          setToolCatalogState("ready");
        } else {
          setToolCatalogState("fallback");
        }
      })
      .catch(() => {
        if (alive) setToolCatalogState("fallback");
      });
    loadToolCoverPool().then((covers) => {
      if (alive) setCoverPool(covers);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 工具定义解析：接口已返回 → 按 key 匹配（匹配不到 = 已下线/不存在）；
      未返回 → 出厂兜底（封面缺失时借用兜底色相，再退中性三元组）。 */
  const def = useMemo<ToolDef | undefined>(() => {
    if (toolCatalogState === "loading") return undefined;
    if (toolCatalogState === "ready") {
      const vo = tools.find((t) => t.key === params.op);
      if (!vo) return undefined;
      const fb: ToolDef | undefined = FALLBACK_OPS[params.op];
      return {
        key: vo.key,
        title: vo.title,
        desc: vo.desc,
        handler: vo.handler,
        // 旧后端不下发 type 时按图片工具处理(既有工具全是图片形态)
        type: vo.type === "video" ? "video" : "image",
        hd: vo.hd,
        needPrompt: vo.needPrompt,
        cover:
          Array.isArray(vo.cover) && vo.cover.length === 3
            ? vo.cover
            : (fb?.cover ?? [220, 200, 260]),
        coverUrl: vo.coverUrl || undefined,
        placeholder: vo.placeholder || undefined,
        extra: vo.extraParams ?? undefined,
      };
    }
    return FALLBACK_OPS[params.op];
  }, [tools, toolCatalogState, params.op]);

  const resolvedCoverUrl = useMemo(
    () => def ? resolveToolCoverUrl(def.key, def.coverUrl, coverPool) : "",
    [def, coverPool],
  );

  const ensureSession = useAuthStore((s) => s.ensureSession);
  const authenticatedUserId = useAuthStore((s) => s.user?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState(0);
  // 任务创建后由服务端回填的实际积分；提交前展示的是同口径预估。
  const [submittedPointCost, setSubmittedPointCost] = useState(0);
  const [background, setBackground] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  // 视频超分的目标分辨率；默认取工具配置的 extra.targetResolution，否则 1080p
  const [resolution, setResolution] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMetadataState, setVideoMetadataState] = useState<VideoMetadataState>("idle");
  const [serverQuote, setServerQuote] = useState<{
    durationSeconds: number;
    ratePerSecond: number;
    pointCost: number;
    resolution: string;
    modelId: string;
    videoUrl: string;
  } | null>(null);
  const [serverQuoteState, setServerQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [serverQuoteError, setServerQuoteError] = useState("");
  const [serverQuoteRevision, setServerQuoteRevision] = useState(0);
  // 「从资产库选取」弹窗
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 轮询取消：卸载 / 重开时置 true，滞后的响应直接丢弃
  const pollGen = useRef(0);

  const fail = useCallback((msg: string) => {
    setError(msg);
    setPhase("failed");
  }, []);

  const journalScope = `tool:${params.op}`;

  useEffect(() => () => void pollGen.current++, [authenticatedUserId, journalScope]);

  const poll = useCallback(
    (taskId: string, ownerUserId: string, startedAt = Date.now()) => {
      const gen = ++pollGen.current;
      const tick = async () => {
        if (gen !== pollGen.current) return;
        if ((useAuthStore.getState().user?.id ?? "") !== ownerUserId) return;
        const r = await aiApi.getTask(taskId);
        if (gen !== pollGen.current) return;
        if ((useAuthStore.getState().user?.id ?? "") !== ownerUserId) return;
        if (r.success && r.data) {
          const t = r.data;
          if (typeof t.pointCost === "number") setSubmittedPointCost(t.pointCost);
          if (t.status === AiTaskStatus.SUCCESS) {
            // 单图任务结果在 resultUrl；批量任务在 resultMeta.urls[0] 兜底
            let url = t.resultUrl;
            if (!url && t.resultMeta) {
              try {
                const meta =
                  typeof t.resultMeta === "string"
                    ? JSON.parse(t.resultMeta)
                    : t.resultMeta;
                if (Array.isArray(meta?.urls) && meta.urls[0]) url = meta.urls[0];
              } catch {
                /* meta 非 JSON — 忽略 */
              }
            }
            if (url) {
              setResult(url);
              setPhase("done");
              // 工具结果只留在工具页展示，但它仍是资产。通知已缓存的资产页
              // 重新取数，避免服务端已有记录而界面仍停留在旧列表。
              notifyAssetLibraryChanged({
                collection: "hist",
                mediaKind: t.handler === "video_upscale" ? "video" : "image",
                origin: "tool",
              });
            } else {
              fail("处理完成但未返回结果，请稍后到工具中心的工具作品中查看");
            }
            void commitAcceptedAiGeneration(journalScope, taskId, ownerUserId);
            return;
          }
          if (t.status === AiTaskStatus.FAILED || t.status === AiTaskStatus.CANCELLED) {
            fail(t.errorMsg || "处理失败，请重试");
            void commitAcceptedAiGeneration(journalScope, taskId, ownerUserId);
            return;
          }
          setProgress(t.progress || 0);
        } else if (r.code === 400 || r.code === 404) {
          // The task was explicitly removed/invalidated. It cannot later charge
          // or complete, so the accepted pointer may be retired.
          void commitAcceptedAiGeneration(journalScope, taskId, ownerUserId);
          fail(r.message || "任务已不存在，请重新处理");
          return;
        } else if (r.code === 403) {
          // Keep the journal partition intact for the owning account, but do
          // not spin forever or display a retry as if this task had failed.
          fail("当前账号无权访问这个处理中任务");
          return;
        }
        // A foreground timeout is not a terminal backend status. Keep the UI
        // non-retryable and reconcile slowly after the normal image budget so
        // a still-running paid task cannot be duplicated.
        const beyondForegroundBudget = Date.now() - startedAt > 7 * 60 * 1000;
        if (beyondForegroundBudget) setBackground(true);
        const delay = beyondForegroundBudget ? 10_000 : 2_000;
        setTimeout(() => void tick(), delay);
      };
      void tick();
    },
    [fail, journalScope],
  );

  // 视频工具的模型要在「选档位」之前就拿到：可选档位取自各模型后台配置，
  // 每秒积分也属于模型本身。整份列表交给用户选择，显示价与实际提交保持一致。
  const [videoModels, setVideoModels] = useState<StudioModelVO[]>([]);
  const [videoModelsLoading, setVideoModelsLoading] = useState(true);
  const [videoModelsError, setVideoModelsError] = useState("");
  const [videoModelsRevision, setVideoModelsRevision] = useState(0);
  const [modelId, setModelId] = useState("");
  const isVideoDef = def?.type === "video";
  useEffect(() => {
    if (!isVideoDef) return;
    let alive = true;
    void listVideoModels()
      .then((list) => {
        if (alive) {
          setVideoModels(list);
          setVideoModelsError("");
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setVideoModels([]);
          setVideoModelsError(cause instanceof Error ? cause.message : "模型读取失败");
        }
      })
      .finally(() => {
        if (alive) setVideoModelsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isVideoDef, videoModelsRevision]);

  const retryVideoModels = useCallback(() => {
    setVideoModelsLoading(true);
    setVideoModelsError("");
    setVideoModelsRevision((value) => value + 1);
  }, []);

  // 图片工具同样在执行前解析模型和价格。失败时停留在确认页，绝不以未知价格开跑。
  const [imageModels, setImageModels] = useState<StudioModelVO[]>([]);
  const [imageModelsLoading, setImageModelsLoading] = useState(true);
  const [imageModelsError, setImageModelsError] = useState("");
  const [imageModelsRevision, setImageModelsRevision] = useState(0);
  const isImageDef = def?.type === "image";
  useEffect(() => {
    if (!isImageDef) return;
    let alive = true;
    void listImageModels()
      .then((list) => {
        if (alive) {
          setImageModels(list);
          setImageModelsError("");
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setImageModels([]);
          setImageModelsError(cause instanceof Error ? cause.message : "模型读取失败");
        }
      })
      .finally(() => {
        if (alive) setImageModelsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isImageDef, imageModelsRevision]);

  const retryImageModels = useCallback(() => {
    setImageModelsLoading(true);
    setImageModelsError("");
    setImageModelsRevision((value) => value + 1);
  }, []);

  /** 当前选中的超分模型;未选(或选中的已下架)时用列表首个。 */
  const videoModel = useMemo(
    () => videoModels.find((m) => m.id === modelId) ?? videoModels[0] ?? null,
    [videoModels, modelId],
  );
  const imageModel = useMemo(() => chooseImageModel(def, imageModels), [def, imageModels]);
  const imagePointCost = useMemo(
    () => imageToolPointCost(imageModel, def),
    [imageModel, def],
  );

  /** 该模型后台配置的目标分辨率；未配置时退回超分接口的全部档位。
      还要与超分接口认的档位取交集:模型可能是从别的类型改过来的，配置里残留着
      480p 这类档位，摆出来只会让用户选到一个上游必拒的值。 */
  const resolutionOptions = useMemo(() => {
    return upscaleResolutionsFor(videoModel);
  }, [videoModel]);

  /** 默认目标分辨率:工具配置的值在可选档位内才用，否则退到第一个可选档。 */
  const defaultResolution = useMemo(() => {
    const raw = def?.extra?.targetResolution;
    const preferred = typeof raw === "string" && raw.trim()
      ? raw.trim().toLowerCase()
      : "1080p";
    return resolutionOptions.includes(preferred) ? preferred : resolutionOptions[0];
  }, [def, resolutionOptions]);

  // 选中的档位可能不在可选范围里:模型是异步加载的，若它在用户上传之后才返回，
  // 早先按全量档位定下的 resolution 可能是这个模型不支持的档。以可选范围为准，
  // 避免高亮消失、又把不支持的档提交上去。
  const activeResolution = resolutionOptions.includes(resolution) ? resolution : defaultResolution;
  const activePointRate = useMemo(
    () => resolveUpscalePointRate(videoModel?.config, activeResolution),
    [videoModel, activeResolution],
  );
  const activePointCost = useMemo(
    () => upscalePointCost(videoModel, videoDuration, activeResolution),
    [videoModel, videoDuration, activeResolution],
  );
  const activeResolutionPriced = activePointRate > 0;
  const videoDurationReady = videoMetadataState === "ready" && videoDuration > 0;
  const activeVideoModelId = videoModel?.modelKey || videoModel?.id || "";
  const serverQuoteReady =
    serverQuoteState === "ready" &&
    serverQuote?.resolution.toLowerCase() === activeResolution.toLowerCase() &&
    serverQuote?.modelId === activeVideoModelId &&
    serverQuote?.videoUrl === source;

  // 浏览器时长只用于即时预估；确认页随后向服务端申请权威报价。生成提交时
  // 服务端还会再次探测，报价不能被当作绕过最终计费检查的凭证。
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- quote inputs form an external request key; changing it must invalidate any accepted quote before another submission can use it. */
    if (!isVideoDef || !source || !videoModel || !activeResolutionPriced) {
      setServerQuote(null);
      setServerQuoteState("idle");
      setServerQuoteError("");
      return;
    }
    // Keep the accepted quote visible through running/failed states. reset()
    // retires it when the user picks another source; generate() still reprobes.
    if (phase !== "options" && phase !== "failed") return;
    let alive = true;
    setServerQuote(null);
    setServerQuoteState("loading");
    setServerQuoteError("");
    void aiApi.upscaleQuote({
      modelId: activeVideoModelId,
      videoUrl: source,
      targetResolution: activeResolution,
    }).then((response) => {
      if (!alive) return;
      if (
        response.success &&
        response.data &&
        response.data.durationSeconds > 0 &&
        response.data.ratePerSecond > 0
      ) {
        setServerQuote({ ...response.data, modelId: activeVideoModelId, videoUrl: source });
        setServerQuoteState("ready");
        return;
      }
      setServerQuoteState("error");
      setServerQuoteError(response.message || "服务端暂时无法核验视频时长");
    }).catch(() => {
      if (!alive) return;
      setServerQuoteState("error");
      setServerQuoteError("服务端暂时无法核验视频时长");
    });
    return () => {
      alive = false;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [activeResolution, activeResolutionPriced, activeVideoModelId, isVideoDef, phase, serverQuoteRevision, source, videoModel]);

  const run = useCallback(
    async (srcUrl: string, promptText: string, targetResolution?: string) => {
      if (!def) return;
      const submitResolution = targetResolution || defaultResolution;
      if (def.type === "video" && resolveUpscalePointRate(videoModel?.config, submitResolution) <= 0) {
        toast.error("所选分辨率尚未配置每秒积分，请更换模型或输出规格");
        return;
      }
      if (def.type === "video" && !serverQuoteReady) {
        toast.error("请等待服务端完成视频时长与积分核验");
        return;
      }
      setPhase("running");
      setProgress(0);
      setSubmittedPointCost(0);
      setBackground(false);
      setError("");
      try {
        if (!(await ensureSession())) {
          setPhase("idle");
          return;
        }
        const ownerUserId = useAuthStore.getState().user?.id ?? "";
        if (!ownerUserId) {
          fail("无法确认当前账号，任务尚未启动，请刷新后重试");
          return;
        }
        // 确认页显示哪个模型，执行时就复用哪个模型；不能临提交再查一次导致
        // 界面报价属于 A 模型、实际任务却调用 B 模型。
        const pick = def.type === "video" ? videoModel : imageModel;
        if (!pick) {
          fail(def.type === "video" ? "没有可用的超分模型" : "没有可用的图像编辑模型");
          return;
        }
        // 视频超分只收视频 URL 与目标分辨率——该接口不接收 prompt，图片工具
        // 的 imageList/sourceImage 也无从谈起，故两类入参完全分开构造。
        const input: Record<string, unknown> =
          def.type === "video"
            ? {
                ...(def.extra ?? {}),
                toolKey: def.key,
                toolTitle: def.title,
                videoUrl: srcUrl,
                targetResolution: targetResolution || defaultResolution,
                ...(videoDuration > 0 ? { duration: normalizeVideoDuration(videoDuration) } : {}),
              }
            : {
                imageList: [srcUrl],
                sourceImage: srcUrl,
                prompt: promptText,
                ...(def.extra ?? {}),
                toolKey: def.key,
                toolTitle: def.title,
              };
        const createGeneration = ++pollGen.current;
        let reconnectNoticeShown = false;
        for (;;) {
          if (createGeneration !== pollGen.current) return;
          const res = await aiApi.generateIdempotent({
            handler: def.handler,
            modelId: pick.modelKey || pick.id,
            input,
          }, journalScope, {
            requireDurableJournal: true,
            retainAccepted: true,
            recovery: {
              source: srcUrl,
              prompt: promptText,
              op: params.op,
              resolution: targetResolution || defaultResolution,
              duration: videoDuration > 0 ? normalizeVideoDuration(videoDuration) : undefined,
            },
            ownerUserId,
          });
          if (createGeneration !== pollGen.current) return;
          if (res.success && res.data?.id) {
            if (typeof res.data.pointCost === "number") setSubmittedPointCost(res.data.pointCost);
            poll(res.data.id, ownerUserId);
            return;
          }
          if (!isAmbiguousAiCreateCode(res.code)) {
            fail(res.message || "任务创建失败，请重试");
            return;
          }
          if (!reconnectNoticeShown) {
            reconnectNoticeShown = true;
            toast.info("任务正在确认中，请保持页面打开");
          }
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      } catch {
        fail("网络错误，请重试");
      }
    },
    [def, defaultResolution, ensureSession, fail, imageModel, journalScope, params.op, poll, serverQuoteReady, videoDuration, videoModel],
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const resume = async () => {
      if (cancelled) return;
      if (!(await ensureSession()) || cancelled) return;
      const ownerUserId = useAuthStore.getState().user?.id ?? "";
      if (!ownerUserId) return;
      const entry = recoverableAiGenerations(journalScope, ownerUserId)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      if (!entry) return;
      const sourceUrl = sourceFromJournal(entry);
      const recovery = recoveryRecord(entry);
      if (sourceUrl) setSource(sourceUrl);
      if (typeof recovery.prompt === "string") setPrompt(recovery.prompt);
      if (typeof recovery.resolution === "string") setResolution(recovery.resolution);
      const recoveredDuration = normalizeVideoDuration(
        recovery.duration ?? entry.payload?.input?.duration,
      );
      if (recoveredDuration > 0) {
        setVideoDuration(recoveredDuration);
        setVideoMetadataState("ready");
      }
      setProgress(0);
      setBackground(Date.now() - entry.updatedAt > 7 * 60 * 1000);
      setError("");
      setPhase("running");
      if (entry.taskId) {
        poll(entry.taskId, ownerUserId, entry.updatedAt);
        return;
      }
      if (!entry.payload) {
        fail("旧版任务缺少恢复信息，请到工具中心查看结果后重新处理");
        return;
      }
      const result = await aiApi.generateIdempotent(
        { ...entry.payload, clientRequestId: entry.clientRequestId },
        journalScope,
        {
          requireDurableJournal: true,
          retainAccepted: true,
          recovery: entry.recovery,
          ownerUserId,
        },
      );
      if (cancelled) return;
      if (result.success && result.data?.id) {
        if (typeof result.data.pointCost === "number") setSubmittedPointCost(result.data.pointCost);
        poll(result.data.id, ownerUserId, entry.updatedAt);
        return;
      }
      if (isAmbiguousAiCreateCode(result.code)) {
        retryTimer = setTimeout(() => void resume(), 3_000);
        return;
      }
      fail(result.message || "任务创建失败，请重试");
    };
    void resume();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [authenticatedUserId, ensureSession, fail, journalScope, poll]);

  /** 打开资产库选取。先确保会话:未登录时资产库只会是一片空白。 */
  const openPicker = useCallback(async () => {
    if (!(await ensureSession())) return; // 未登录会跳 /login
    setPicking(true);
  }, [ensureSession]);

  /** 拿到素材后的统一分流：所有工具都先确认模型积分，避免上传即扣费。 */
  const applySource = useCallback(
    (url: string) => {
      if (!def) return;
      setSource(url);
      if (def.type === "video") {
        setVideoDuration(0);
        setVideoMetadataState("loading");
        setResolution(defaultResolution);
        setPhase("options");
      } else if (def.needPrompt) {
        setPhase("prompt");
      } else {
        setPhase("confirm");
      }
    },
    [def, defaultResolution],
  );


  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!def) return;
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      const isVideoTool = def.type === "video";
      if (!f.type.startsWith(isVideoTool ? "video/" : "image/")) {
        toast.error(isVideoTool ? "请选择视频文件" : "请选择图片文件");
        return;
      }
      const ok = await ensureSession(); // 未登录会跳 /login
      if (!ok) return;
      setPhase("uploading");
      // uploadFileSmart：体积预检 + 可执行类型拦截 + 预签名直传 OSS。视频动辄
      // 上百 MB，走普通 multipart 会整个穿过我们自己的 API 服务器。
      const res = await uploadFileSmart(f);
      if (!res.success || !res.data?.fileUrl) {
        setPhase("idle");
        toast.error(res.message || "上传失败，请重试");
        return;
      }
      applySource(res.data.fileUrl);
    },
    [def, ensureSession, applySource],
  );

  const reset = useCallback(() => {
    pollGen.current++;
    setPhase("idle");
    setSource("");
    setResult("");
    setSubmittedPointCost(0);
    setPrompt("");
    setResolution("");
    setVideoDuration(0);
    setVideoMetadataState("idle");
    setServerQuote(null);
    setServerQuoteState("idle");
    setServerQuoteError("");
    setError("");
    setBackground(false);
  }, []);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  if (!def) {
    if (toolCatalogState === "loading") {
      return (
        <div className="tool-page">
          <div className="tp-loading-state" role="status" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span>正在加载工具…</span>
          </div>
        </div>
      );
    }
    return (
      <div className="tool-page">
        <div className="tp-card">
          <h1>未找到该工具</h1>
          <p className="tp-desc">链接可能已失效。</p>
          <Link className="tp-btn" href="/">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const isVideoTool = def.type === "video";
  const retryModel = isVideoTool ? videoModel : imageModel;
  const retryPointCost = isVideoTool ? activePointCost : imagePointCost;
  const retryModelsLoading = isVideoTool ? videoModelsLoading : imageModelsLoading;
  const retryModelsError = isVideoTool ? videoModelsError : imageModelsError;
  const retryModels = isVideoTool ? retryVideoModels : retryImageModels;

  return (
    <div className="tool-page">
      <button type="button" className="tp-close" aria-label="关闭" onClick={close}>
        <X className="h-5 w-5" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={isVideoTool ? "video/*" : "image/*"}
        hidden
        onChange={onFile}
      />

      {/* ── 入口：上传 ── */}
      {(phase === "idle" || phase === "uploading") && (
        <div className="tp-card">
          <div className="tp-cover" style={{ background: coverBg(def.cover) }}>
            {resolvedCoverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={resolvedCoverUrl}
                src={resolvedCoverUrl}
                alt=""
                decoding="async"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : null}
          </div>
          <h1>{def.title}</h1>
          <p className="tp-desc">{def.desc}</p>
          <div className="tp-actions">
            <button
              type="button"
              className="tp-btn ghost"
              disabled={phase === "uploading"}
              onClick={() => void openPicker()}
            >
              <Images className="h-4 w-4" /> 从资产库选取
            </button>
            <button
              type="button"
              className="tp-btn"
              disabled={phase === "uploading"}
              onClick={() => fileRef.current?.click()}
            >
              {phase === "uploading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在上传…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> {isVideoTool ? "上传视频" : "上传图片"}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 从资产库选取:按工具类型锁死可选素材——图片工具只让选图，视频工具
          只让选视频，选到不对的类型必定在上游失败。 */}
      {picking && (
        <AssetPickerModal
          kind={isVideoTool ? "video" : "image"}
          lockKind
          onClose={() => setPicking(false)}
          onPick={(a) => {
            setPicking(false);
            if (a.url) applySource(a.url);
          }}
        />
      )}

      {/* ── 图片工具：执行前确认模型、积分；局部重绘同时收修改描述 ── */}
      {(phase === "confirm" || phase === "prompt") && (
        <div className="tp-card config image-config">
          <section className="tp-preview-column" aria-label="源图片预览">
            <div className="tp-stage">
              <ToolMedia src={source} alt="待处理图片" video={false} />
            </div>
            <div className="tp-source-bar">
              <div>
                <strong>源图片</strong>
                <span>确认图片后再开始处理</span>
              </div>
              <button type="button" className="tp-source-change" onClick={reset}>
                更换图片
              </button>
            </div>
          </section>

          <section className="tp-config-panel">
            <header className="tp-config-head">
              <h1>{def.title}</h1>
              <p>{def.desc}</p>
            </header>

            {phase === "prompt" && (
              <div className="tp-prompt-field">
                <label htmlFor="tool-edit-prompt">修改描述</label>
                <textarea
                  id="tool-edit-prompt"
                  className="tp-prompt"
                  value={prompt}
                  placeholder={def.placeholder}
                  onChange={(event) => setPrompt(event.target.value)}
                  autoFocus
                />
              </div>
            )}

            <div className="tp-model-field">
              <span className="tp-field-label">处理模型</span>
              <ModelDisclosure
                model={imageModel}
                pointCost={imagePointCost}
                loading={imageModelsLoading}
                error={imageModelsError}
                onRetry={retryImageModels}
              />
            </div>

            <div className="tp-cost-summary" aria-live="polite">
              <div>
                <span>{serverQuoteReady ? "本次核定消耗" : "本次预计消耗"}</span>
                <p>工具不额外收费，积分仅由所选模型收取</p>
              </div>
              <strong>{imageModel ? pointCostLabel(imagePointCost) : "—"}</strong>
            </div>

            <button
              type="button"
              className="tp-btn tp-submit"
              disabled={
                imageModelsLoading ||
                !imageModel ||
                (phase === "prompt" && !prompt.trim())
              }
              onClick={() => void run(source, phase === "prompt" ? prompt.trim() : def.title)}
            >
              {imageModelsLoading
                ? "正在读取价格…"
                : imageModel
                  ? `${phase === "prompt" ? "开始重绘" : `开始${def.title}`} · ${pointCostLabel(imagePointCost)}`
                  : "暂无可用模型"}
            </button>
          </section>
        </div>
      )}

      {/* ── 视频超分：选目标分辨率 ── */}
      {phase === "options" && (
        <div className="tp-card config">
          <section className="tp-preview-column" aria-label="源视频预览">
            <div className="tp-stage">
              <ToolMedia
                src={source}
                alt="待处理视频"
                video={isVideoTool}
                onDuration={(seconds) => {
                  const duration = normalizeVideoDuration(seconds);
                  setVideoDuration(duration);
                  setVideoMetadataState(duration > 0 ? "ready" : "error");
                }}
                onMetadataError={() => {
                  setVideoDuration(0);
                  setVideoMetadataState("error");
                }}
              />
            </div>
            <div className="tp-source-bar">
              <div>
                <strong>源视频</strong>
                <span>
                  {videoMetadataState === "ready"
                    ? `浏览器预估 · ${videoDurationLabel(videoDuration)}`
                    : videoMetadataState === "error"
                      ? "浏览器未读到时长，等待服务端核验"
                      : "正在读取视频时长…"}
                </span>
              </div>
              <button type="button" className="tp-source-change" onClick={reset}>
                更换视频
              </button>
            </div>
          </section>

          <section className="tp-config-panel">
            <header className="tp-config-head">
              <h1>{def.title}</h1>
              <p>选择处理模型与输出规格。不同目标分辨率按各自每秒单价计费。</p>
            </header>

            <fieldset className="tp-fieldset">
              <legend>处理模型</legend>
              {videoModelsLoading ? (
                <div className="tp-option-state" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> 正在读取模型与价格…
                </div>
              ) : videoModels.length ? (
                <div className="tp-model-list" role="group" aria-label="超分模型">
                  {videoModels.map((model) => {
                    const modelResolutions = upscaleResolutionsFor(model);
                    const modelResolution = modelResolutions.includes(activeResolution)
                      ? activeResolution
                      : modelResolutions.includes(defaultResolution)
                        ? defaultResolution
                        : modelResolutions[0];
                    const modelRate = resolveUpscalePointRate(model.config, modelResolution);
                    const modelCost = upscalePointCost(model, videoDuration, modelResolution);
                    const selected = videoModel?.id === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        aria-pressed={selected}
                        className={`tp-model-option${selected ? " on" : ""}`}
                        onClick={() => {
                          setModelId(model.id);
                          setResolution(modelResolution);
                        }}
                      >
                        <span className="tp-model-copy">
                          <strong>{model.name}</strong>
                          <small>{model.desc || `支持 ${modelResolutions.length} 个输出档位`}</small>
                        </span>
                        <span className="tp-model-price">
                          <strong>{modelRate > 0 ? pointRateLabel(modelRate) : "未定价"}</strong>
                          <small>{modelRate > 0 && videoDurationReady ? `预计 ${pointCostLabel(modelCost)}` : modelResolution.toUpperCase()}</small>
                        </span>
                        <span className="tp-radio-mark" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="tp-option-state error" role="alert">
                  <span>
                    {videoModelsError || "暂无可用模型，请联系管理员检查模型上架状态。"}
                  </span>
                  <button type="button" className="tp-inline-retry" onClick={retryVideoModels}>
                    重新加载
                  </button>
                </div>
              )}
            </fieldset>

            <fieldset className="tp-fieldset">
              <legend>目标分辨率</legend>
              <div className="tp-resolution-list" role="group" aria-label="目标分辨率">
                {resolutionOptions.map((target) => {
                  const rate = resolveUpscalePointRate(videoModel?.config, target);
                  const selected = activeResolution === target;
                  return (
                    <button
                      key={target}
                      type="button"
                      aria-pressed={selected}
                      className={`tp-resolution-option${selected ? " on" : ""}`}
                      disabled={!videoModel}
                      onClick={() => setResolution(target)}
                    >
                      <strong>{target.toUpperCase()}</strong>
                      <small>{rate > 0 ? pointRateLabel(rate) : "未定价"}</small>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="tp-cost-summary" aria-live="polite">
              <div>
                <span>本次预计消耗</span>
                <p>
                  {!activeResolutionPriced
                    ? "该模型尚未配置此分辨率的每秒积分"
                    : serverQuoteReady && serverQuote
                      ? `服务端已确认 ${videoDurationLabel(serverQuote.durationSeconds)} × ${pointRateLabel(serverQuote.ratePerSecond)}；生成提交时将再次复核`
                      : serverQuoteState === "error"
                        ? serverQuoteError || "服务端暂时无法核验视频时长"
                        : "服务端正在核验视频时长与最终积分…"}
                </p>
                {serverQuoteState === "error" && activeResolutionPriced && (
                  <button
                    type="button"
                    className="tp-inline-retry"
                    onClick={() => setServerQuoteRevision((revision) => revision + 1)}
                  >
                    重新核验
                  </button>
                )}
              </div>
              <strong>
                {videoModel && serverQuoteReady && serverQuote
                  ? pointCostLabel(serverQuote.pointCost)
                  : "待核价"}
              </strong>
            </div>

            <button
              type="button"
              className="tp-btn tp-submit"
              disabled={
                !videoModel ||
                !activeResolution ||
                videoModelsLoading ||
                !activeResolutionPriced ||
                !serverQuoteReady
              }
              onClick={() => void run(source, def.title, activeResolution)}
            >
              {videoModelsLoading
                ? "正在读取价格…"
                : videoModel && activeResolutionPriced
                  ? serverQuoteReady && serverQuote
                    ? `开始超分 · ${pointCostLabel(serverQuote.pointCost)}`
                    : serverQuoteState === "error" ? "核价失败" : "服务端核价中…"
                  : "暂无可用模型"}
            </button>
          </section>
        </div>
      )}

      {/* ── 处理中 ── */}
      {phase === "running" && (
        <div className="tp-card">
          <div className="tp-stage">
            <ToolMedia src={source} alt="处理中" video={isVideoTool} />
            <div className="tp-busy" role="status" aria-live="polite" aria-atomic="true">
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
              <span>
                {def.title}处理中{progress > 0 ? ` · ${progress}%` : "…"}
              </span>
            </div>
          </div>
          <p className="tp-meta">
            {background ? "任务仍在后台处理中，本页会自动同步结果。" : "处理由 AI 模型完成，通常需要几十秒。"}
            {submittedPointCost > 0 ? ` 本次模型调用已计 ${submittedPointCost} 积分。` : ""}
          </p>
        </div>
      )}

      {/* ── 结果对照 ── */}
      {phase === "done" && (
        <div className="tp-card wide">
          <div className="tp-pair">
            <figure>
              <div className="tp-stage">
                <ToolMedia src={source} alt={isVideoTool ? "原视频" : "原图"} video={isVideoTool} />
              </div>
              <figcaption>{isVideoTool ? "原视频" : "原图"}</figcaption>
            </figure>
            <figure>
              <div className="tp-stage">
                <ToolMedia src={result} alt={def.title + "结果"} video={isVideoTool} />
              </div>
              <figcaption>{def.title}结果</figcaption>
            </figure>
          </div>
          {submittedPointCost > 0 && (
            <p className="tp-meta">本次模型调用已使用 {submittedPointCost} 积分，工具未额外收费。</p>
          )}
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              {isVideoTool ? "再来一个" : "再来一张"}
            </button>
            <a className="tp-btn" href={result} target="_blank" rel="noreferrer">
              {isVideoTool ? "查看原片 / 下载" : "查看原图 / 下载"}
            </a>
          </div>
          <p className="tp-meta">
            结果已保存在资产与{" "}
            <Link
              href="/tools"
              style={{ color: "var(--text-dim)", textDecoration: "underline" }}
            >
              工具中心
            </Link>{" "}
            的工具作品中，不会出现在创作台。
          </p>
        </div>
      )}

      {/* ── 失败 ── */}
      {phase === "failed" && (
        <div className="tp-card">
          <h1>{def.title}</h1>
          <p className="tp-err">{error}</p>
          {source && (
            <div className="tp-retry-block">
              <span className="tp-field-label">重试计费</span>
              <ModelDisclosure
                model={retryModel}
                pointCost={retryPointCost}
                priceLabel={
                  isVideoTool && activeResolutionPriced && !serverQuoteReady
                    ? "服务端核价"
                    : undefined
                }
                loading={retryModelsLoading}
                error={retryModelsError}
                emptyLabel={isVideoTool ? "暂无可用的超分模型" : undefined}
                onRetry={retryModels}
              />
              <p>
                {submittedPointCost > 0
                  ? `上次失败任务的 ${submittedPointCost} 积分会自动退回；`
                  : "失败任务如已扣费会自动退回；"}
                重试会按当前模型重新计费。
              </p>
            </div>
          )}
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              重新上传
            </button>
            {source && (
              <button
                type="button"
                className="tp-btn"
                disabled={
                  retryModelsLoading ||
                  !retryModel ||
                  (isVideoTool && (!activeResolutionPriced || !serverQuoteReady))
                }
                onClick={() =>
                  void run(
                    source,
                    def.needPrompt ? prompt.trim() || def.title : def.title,
                    activeResolution,
                  )
                }
              >
                {retryModelsLoading
                  ? "正在读取价格…"
                  : retryModel && (!isVideoTool || activeResolutionPriced)
                    ? isVideoTool && serverQuote
                      ? `重试 · ${pointCostLabel(serverQuote.pointCost)}`
                      : `重试 · ${pointCostLabel(retryPointCost)}`
                    : "暂无可用模型"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
