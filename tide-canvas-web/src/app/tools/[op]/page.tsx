"use client";

/* ============================================================================
   /tools/[op] — 单个智能工具的全屏处理页（工具中心 /tools 的卡片指向这里）。

   与创作台的区别：这里是「封装好的完整功能」——提示词由服务端 handler 预置
   （upscale / remove_bg / outpaint / remove_object / relight，与创作台结果卡的
   一键操作共用同一批后端处理器与模型解析策略），用户只需上传素材。
   流程：上传 → 自动处理 → 原件/结果对照 → 下载；两个工具在开跑前多收一项：
     - 局部重绘（image_to_image）：一句修改描述；
     - 视频超分（video_upscale）：目标分辨率档位。

   按工具的 type 分流素材形态：image 收图片，video 收视频（模型取「超分」类目、
   入参只发 videoUrl + targetResolution，该接口不接收 prompt）。

   工具定义（标题/文案/处理器/类型/封面等）来自后台「工具管理」
   （GET /api/ai/tools，公开接口）；接口未应答或失败时用 FALLBACK_OPS 出厂兜底，
   页面永不空白。

   任务同样落在 /api/ai/tasks（工具中心的「工具作品」与生成历史里也能看到）。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { AiTaskStatus, type AiToolVO } from "@/types/ai";
import { coverBg } from "@/lib/mesh";
import { FALLBACK_TOOLS, UPSCALE_RESOLUTIONS, type ToolType } from "@/lib/ai-tools-catalog";
import {
  commitAcceptedAiGeneration,
  isAmbiguousAiCreateCode,
  recoverableAiGenerations,
  type PendingAiGeneration,
} from "@/lib/ai-generation-idempotency";

interface ToolDef {
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
  placeholder?: string;
  /** 额外生成参数——随请求原样下发（计费按这些原始入参解析，须由客户端发送） */
  extra?: Record<string, unknown>;
}

/** 出厂兜底：/api/ai/tools 未应答或失败时按此渲染，页面永不空白。
    数据源自 lib/ai-tools-catalog(与工具中心页共用,只维护一份)。 */
const FALLBACK_OPS: Record<string, ToolDef> = Object.fromEntries(
  FALLBACK_TOOLS.map((t) => [t.key, t]),
);

/** prompt = 局部重绘的修改描述；options = 视频超分的目标分辨率。两者都是
    「上传完成、开跑之前」收一项必要输入，其余工具上传即跑。 */
type Phase = "idle" | "uploading" | "prompt" | "options" | "running" | "done" | "failed";

/** 素材预览：视频工具用 video 元素（带控件，可直接播放确认），图片用 img。 */
function ToolMedia({ src, alt, video }: { src: string; alt: string; video: boolean }) {
  if (video) {
    return <video src={src} controls playsInline preload="metadata" aria-label={alt} />;
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

/** 模型解析 —— 图片工具与创作台一键操作同策略：优先 edits/i2i 能力，
    高清放大偏好 4K 模型，再退到 nano-banana-2 / gpt-image-2 / 首个。
    视频工具取「超分」类目下的首个已上架模型（该类目只服务超分能力）。 */
async function pickVideoModel(): Promise<StudioModelVO | null> {
  const r = await marketApi.studioModels("upscale");
  const models = r.success && Array.isArray(r.data) ? r.data : [];
  return models[0] ?? null;
}

async function pickModel(def: ToolDef): Promise<StudioModelVO | null> {
  if (def.type === "video") return pickVideoModel();
  const r = await marketApi.studioModels("image");
  const models = r.success && Array.isArray(r.data) ? r.data : [];
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

export default function ToolPage() {
  const router = useRouter();
  const params = useParams<{ op: string }>();

  // 后台「工具管理」配置：null = 接口未应答/失败（渲染 FALLBACK_OPS 出厂兜底）。
  const [tools, setTools] = useState<AiToolVO[] | null>(null);
  useEffect(() => {
    let alive = true;
    aiApi.tools().then((res) => {
      if (alive && res.success && Array.isArray(res.data) && res.data.length) {
        setTools(res.data);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 工具定义解析：接口已返回 → 按 key 匹配（匹配不到 = 已下线/不存在）；
      未返回 → 出厂兜底（封面缺失时借用兜底色相，再退中性三元组）。 */
  const def = useMemo<ToolDef | undefined>(() => {
    if (tools !== null) {
      const vo = tools.find((t) => t.key === params.op);
      if (!vo) return undefined;
      const fb: ToolDef | undefined = FALLBACK_OPS[params.op];
      return {
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
        placeholder: vo.placeholder || undefined,
        extra: vo.extraParams ?? undefined,
      };
    }
    return FALLBACK_OPS[params.op];
  }, [tools, params.op]);

  const ensureSession = useAuthStore((s) => s.ensureSession);
  const authenticatedUserId = useAuthStore((s) => s.user?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState(0);
  const [background, setBackground] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  // 视频超分的目标分辨率；默认取工具配置的 extra.targetResolution，否则 1080p
  const [resolution, setResolution] = useState("");
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
            } else {
              fail("处理完成但未返回图片，请稍后在创作台的生成历史中查看");
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

  // 视频工具的模型要在「选档位」之前就拿到:可选档位取自该模型后台配置的
  // 支持清晰度(ByteDance 系不支持 720p),而积分定价矩阵也是按这份清晰度配的
  // ——把四个档位写死会让用户选到上游必拒的档，或落进矩阵没有的格子而被按
  // 模型固定价扣费。
  const [videoModel, setVideoModel] = useState<StudioModelVO | null>(null);
  const isVideoDef = def?.type === "video";
  useEffect(() => {
    if (!isVideoDef) return;
    let alive = true;
    void pickVideoModel().then((m) => {
      if (alive) setVideoModel(m);
    });
    return () => {
      alive = false;
    };
  }, [isVideoDef]);

  /** 该模型后台配置的目标分辨率；未配置时退回超分接口的全部档位。
      还要与超分接口认的档位取交集:模型可能是从别的类型改过来的，配置里残留着
      480p 这类档位，摆出来只会让用户选到一个上游必拒的值。 */
  const resolutionOptions = useMemo(() => {
    const allowed = UPSCALE_RESOLUTIONS as readonly string[];
    // 统一小写:默认档位与选中态都靠字符串相等判断，配置里写成 "1080P" 会让
    // 这些比较全部落空。服务端也按小写校验，发上去的值同样规范。
    const configured = (videoModel?.config?.resolutions ?? [])
      .map((r) => (typeof r === "string" ? r.toLowerCase() : ""))
      .filter((r) => allowed.includes(r));
    return configured.length ? configured : [...UPSCALE_RESOLUTIONS];
  }, [videoModel]);

  /** 默认目标分辨率:工具配置的值在可选档位内才用，否则退到第一个可选档。 */
  const defaultResolution = useMemo(() => {
    const raw = def?.extra?.targetResolution;
    const preferred = typeof raw === "string" && raw ? raw : "1080p";
    return resolutionOptions.includes(preferred) ? preferred : resolutionOptions[0];
  }, [def, resolutionOptions]);

  // 选中的档位可能不在可选范围里:模型是异步加载的，若它在用户上传之后才返回，
  // 早先按全量档位定下的 resolution 可能是这个模型不支持的档。以可选范围为准，
  // 避免高亮消失、又把不支持的档提交上去。
  const activeResolution = resolutionOptions.includes(resolution) ? resolution : defaultResolution;

  const run = useCallback(
    async (srcUrl: string, promptText: string, targetResolution?: string) => {
      if (!def) return;
      setPhase("running");
      setProgress(0);
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
        // 视频工具在进选档步骤前就把模型取好了，直接复用，避免再查一次。
        const pick = def.type === "video" ? videoModel ?? (await pickVideoModel()) : await pickModel(def);
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
                videoUrl: srcUrl,
                targetResolution: targetResolution || defaultResolution,
              }
            : {
                imageList: [srcUrl],
                sourceImage: srcUrl,
                prompt: promptText,
                ...(def.extra ?? {}),
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
            },
            ownerUserId,
          });
          if (createGeneration !== pollGen.current) return;
          if (res.success && res.data?.id) {
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
    [def, defaultResolution, ensureSession, fail, journalScope, params.op, poll, videoModel],
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
      setProgress(0);
      setBackground(Date.now() - entry.updatedAt > 7 * 60 * 1000);
      setError("");
      setPhase("running");
      if (entry.taskId) {
        poll(entry.taskId, ownerUserId, entry.updatedAt);
        return;
      }
      if (!entry.payload) {
        fail("旧版任务缺少恢复信息，请到生成历史查看结果后重新处理");
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
      setSource(res.data.fileUrl);
      // 一键工具直接开跑；局部重绘先收一句修改描述，视频超分先选目标分辨率
      if (isVideoTool) {
        setResolution(defaultResolution);
        setPhase("options");
      } else if (def.needPrompt) {
        setPhase("prompt");
      } else {
        void run(res.data.fileUrl, def.title);
      }
    },
    [def, defaultResolution, ensureSession, run],
  );

  const reset = useCallback(() => {
    pollGen.current++;
    setPhase("idle");
    setSource("");
    setResult("");
    setPrompt("");
    setResolution("");
    setError("");
    setBackground(false);
  }, []);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  if (!def) {
    // 接口未应答且无出厂兜底：先转 loading，避免在配置返回前闪现「未找到」。
    if (tools === null) {
      return (
        <div className="tool-page">
          <Loader2
            className="h-6 w-6 animate-spin"
            style={{ color: "var(--text-faint)" }}
          />
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
          <div className="tp-cover" style={{ background: coverBg(def.cover) }} />
          <h1>{def.title}</h1>
          <p className="tp-desc">{def.desc}</p>
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
      )}

      {/* ── 局部重绘：修改描述 ── */}
      {phase === "prompt" && (
        <div className="tp-card">
          <div className="tp-stage">
            <ToolMedia src={source} alt="待处理图片" video={isVideoTool} />
          </div>
          <textarea
            className="tp-prompt"
            value={prompt}
            placeholder={def.placeholder}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
          />
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              重新选择
            </button>
            <button
              type="button"
              className="tp-btn"
              disabled={!prompt.trim()}
              onClick={() => void run(source, prompt.trim())}
            >
              开始重绘
            </button>
          </div>
        </div>
      )}

      {/* ── 视频超分：选目标分辨率 ── */}
      {phase === "options" && (
        <div className="tp-card">
          <div className="tp-stage">
            <ToolMedia src={source} alt="待处理视频" video={isVideoTool} />
          </div>
          <div className="tp-opts" role="group" aria-label="目标分辨率">
            {resolutionOptions.map((r) => (
              <button
                key={r}
                type="button"
                className={`tp-opt${activeResolution === r ? " on" : ""}`}
                onClick={() => setResolution(r)}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="tp-meta">目标分辨率越高，处理越久、消耗积分也越多。</p>
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              重新选择
            </button>
            <button
              type="button"
              className="tp-btn"
              disabled={!activeResolution}
              onClick={() => void run(source, def.title, activeResolution)}
            >
              开始超分
            </button>
          </div>
        </div>
      )}

      {/* ── 处理中 ── */}
      {phase === "running" && (
        <div className="tp-card">
          <div className="tp-stage">
            <ToolMedia src={source} alt="处理中" video={isVideoTool} />
            <div className="tp-busy">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span>
                {def.title}处理中{progress > 0 ? ` · ${progress}%` : "…"}
              </span>
            </div>
          </div>
          <p className="tp-meta">
            {background ? "任务仍在后台处理中，本页会自动同步结果。" : "处理由 AI 模型完成，通常需要几十秒。"}
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
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              {isVideoTool ? "再来一个" : "再来一张"}
            </button>
            <a className="tp-btn" href={result} target="_blank" rel="noreferrer">
              {isVideoTool ? "查看原片 / 下载" : "查看原图 / 下载"}
            </a>
          </div>
          <p className="tp-meta">
            结果已存入你的生成历史，可到{" "}
            <Link
              href={isVideoTool ? "/tools" : "/studio?type=image"}
              style={{ color: "var(--text-dim)", textDecoration: "underline" }}
            >
              {isVideoTool ? "工具中心" : "创作台"}
            </Link>{" "}
            {isVideoTool ? "查看全部工具作品。" : "继续精修。"}
          </p>
        </div>
      )}

      {/* ── 失败 ── */}
      {phase === "failed" && (
        <div className="tp-card">
          <h1>{def.title}</h1>
          <p className="tp-err">{error}</p>
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              重新上传
            </button>
            {source && (
              <button
                type="button"
                className="tp-btn"
                onClick={() =>
                  void run(
                    source,
                    def.needPrompt ? prompt.trim() || def.title : def.title,
                    activeResolution,
                  )
                }
              >
                重试
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
