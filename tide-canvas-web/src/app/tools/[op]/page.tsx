"use client";

/* ============================================================================
   /tools/[op] — 独立 AI 工具页（高清放大 / 一键抠图 / 智能扩图 / 局部重绘）。

   与创作台的区别：这里是「封装好的完整功能」——提示词由服务端 handler 预置
   （upscale / remove_bg / outpaint，与创作台结果卡的一键操作共用同一批后端
   处理器与模型解析策略），用户只需上传图片；局部重绘额外要一句修改描述，
   走 image_to_image。流程：上传 → 自动处理 → 原图/结果对照 → 下载。

   任务同样落在 /api/ai/tasks（创作台的生成历史里也能看到）。
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { aiApi, fileApi } from "@/lib/api";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { AiTaskStatus } from "@/types/ai";
import { coverBg } from "@/mock";

interface ToolDef {
  title: string;
  desc: string;
  /** backend generation handler (internal/handler/ai handlerRegistry) */
  handler: string;
  /** prefer a 4K-capable model + pass the 4k resolution hint (高清放大) */
  hd?: boolean;
  /** requires a user prompt describing the change (局部重绘) */
  needPrompt?: boolean;
  /** mesh-gradient cover hues — 与首页核心能力卡同源（mock/home.ts CAPS） */
  cover: [number, number, number];
  placeholder?: string;
}

const OPS: Record<string, ToolDef> = {
  upscale: {
    title: "高清放大",
    desc: "无损放大图片尺寸，智能重塑高清画质。",
    handler: "upscale",
    hd: true,
    cover: [255, 230, 290],
  },
  rmbg: {
    title: "一键抠图",
    desc: "智能移除背景与对象，输出干净主体。",
    handler: "remove_bg",
    cover: [95, 140, 70],
  },
  expand: {
    title: "智能扩图",
    desc: "Outpainting 无缝向外补全画面。",
    handler: "outpaint",
    cover: [28, 48, 8],
  },
  inpaint: {
    title: "局部重绘",
    desc: "上传图片并描述想修改的部分，AI 精准重绘。",
    handler: "image_to_image",
    needPrompt: true,
    cover: [330, 286, 12],
    placeholder: "描述要修改的部分…\n例：把天空换成日落晚霞，保持其余不变",
  },
};

type Phase = "idle" | "uploading" | "prompt" | "running" | "done" | "failed";

/** 图像编辑模型解析 —— 与创作台一键操作同策略：优先 edits/i2i 能力，
    高清放大偏好 4K 模型，再退到 nano-banana-2 / gpt-image-2 / 首个。 */
async function pickModel(def: ToolDef): Promise<StudioModelVO | null> {
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
  const def = OPS[params.op];

  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // 轮询取消：卸载 / 重开时置 true，滞后的响应直接丢弃
  const pollGen = useRef(0);

  useEffect(() => () => void pollGen.current++, []);

  const fail = useCallback((msg: string) => {
    setError(msg);
    setPhase("failed");
  }, []);

  const poll = useCallback(
    (taskId: string) => {
      const gen = ++pollGen.current;
      const tick = async (n: number) => {
        if (gen !== pollGen.current) return;
        const r = await aiApi.getTask(taskId);
        if (gen !== pollGen.current) return;
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
            return;
          }
          if (t.status === AiTaskStatus.FAILED || t.status === AiTaskStatus.CANCELLED) {
            fail(t.errorMsg || "处理失败，请重试");
            return;
          }
          setProgress(t.progress || 0);
        }
        if (n > 150) {
          // ~5 分钟兜底：任务还在跑，结果会留在生成历史里
          fail("处理时间较长，请稍后在创作台的生成历史中查看结果");
          return;
        }
        setTimeout(() => void tick(n + 1), 2000);
      };
      void tick(0);
    },
    [fail],
  );

  const run = useCallback(
    async (imgUrl: string, promptText: string) => {
      setPhase("running");
      setProgress(0);
      setError("");
      try {
        const pick = await pickModel(def);
        if (!pick) {
          fail("没有可用的图像编辑模型");
          return;
        }
        const input: Record<string, unknown> = {
          imageList: [imgUrl],
          sourceImage: imgUrl,
          prompt: promptText,
          ...(def.hd ? { resolution: "4k", clarity: "4k", quality: "high" } : {}),
        };
        const res = await aiApi.generate({
          handler: def.handler,
          modelId: pick.modelKey || pick.id,
          input,
        });
        if (!res.success || !res.data) {
          fail(res.message || "任务创建失败，请重试");
          return;
        }
        poll(res.data.id);
      } catch {
        fail("网络错误，请重试");
      }
    },
    [def, fail, poll],
  );

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        toast.error("请选择图片文件");
        return;
      }
      const ok = await ensureSession(); // 未登录会跳 /login
      if (!ok) return;
      setPhase("uploading");
      const res = await fileApi.upload(f);
      if (!res.success || !res.data?.fileUrl) {
        setPhase("idle");
        toast.error(res.message || "上传失败，请重试");
        return;
      }
      setSource(res.data.fileUrl);
      // 一键工具直接开跑；局部重绘先收一句修改描述
      if (def.needPrompt) setPhase("prompt");
      else void run(res.data.fileUrl, def.title);
    },
    [def, ensureSession, run],
  );

  const reset = useCallback(() => {
    pollGen.current++;
    setPhase("idle");
    setSource("");
    setResult("");
    setPrompt("");
    setError("");
  }, []);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  if (!def) {
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

  return (
    <div className="tool-page">
      <button type="button" className="tp-close" aria-label="关闭" onClick={close}>
        <X className="h-5 w-5" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
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
                <Plus className="h-4 w-4" /> 上传图片
              </>
            )}
          </button>
        </div>
      )}

      {/* ── 局部重绘：修改描述 ── */}
      {phase === "prompt" && (
        <div className="tp-card">
          <div className="tp-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source} alt="待处理图片" />
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

      {/* ── 处理中 ── */}
      {phase === "running" && (
        <div className="tp-card">
          <div className="tp-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source} alt="处理中" />
            <div className="tp-busy">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span>
                {def.title}处理中{progress > 0 ? ` · ${progress}%` : "…"}
              </span>
            </div>
          </div>
          <p className="tp-meta">处理由 AI 模型完成，通常需要几十秒。</p>
        </div>
      )}

      {/* ── 结果对照 ── */}
      {phase === "done" && (
        <div className="tp-card wide">
          <div className="tp-pair">
            <figure>
              <div className="tp-stage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={source} alt="原图" />
              </div>
              <figcaption>原图</figcaption>
            </figure>
            <figure>
              <div className="tp-stage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result} alt={def.title + "结果"} />
              </div>
              <figcaption>{def.title}结果</figcaption>
            </figure>
          </div>
          <div className="tp-actions">
            <button type="button" className="tp-btn ghost" onClick={reset}>
              再来一张
            </button>
            <a className="tp-btn" href={result} target="_blank" rel="noreferrer">
              查看原图 / 下载
            </a>
          </div>
          <p className="tp-meta">
            结果已存入你的生成历史，可到{" "}
            <Link href="/studio?type=image" style={{ color: "var(--text-dim)", textDecoration: "underline" }}>
              创作台
            </Link>{" "}
            继续精修。
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
                onClick={() => void run(source, def.needPrompt ? prompt.trim() || def.title : def.title)}
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
