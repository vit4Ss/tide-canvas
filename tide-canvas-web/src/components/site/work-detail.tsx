"use client";

/* ============================================================================
   WorkDetailBody — 作品详情全屏查看器（imini 式独立界面）。

   由快速查看浮层（<WorkModal/>，广场/首页点开）与可分享的独立页
   （/explore/[id]）共同复用。自包含：fixed 全屏、Esc 关闭、←/→ 翻页（有
   邻居时）、滚动锁定。

   社交向功能（点赞/收藏/浏览量/关注/评论）按产品决策不在查看器露出
   （2026-07-07 用户拍板去掉）；保留的都是创作链路：复制提示词 / 下载原图 /
   生成同款（flux_prompt + flux_model 交接）/ 作为垫图 · 生成视频
   （studio_use_asset 交接）。信息区只放系统真实字段，空值不显示。
   样式在 work-viewer.css（token 化，imini 白胶囊黑字）。
   ========================================================================== */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy, Download, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import type { PostDetailVO } from "@/types/community";
import { toast } from "@/components/shared/toast";
import { mesh } from "@/lib/mesh";
import { grayscaleSwatch } from "@/lib/swatch";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import "./work-viewer.css";

/** Deterministic mesh-hue triplet seeded from a post id (cover fallback). */
function coverFallback(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

export interface WorkDetailBodyProps {
  detail: PostDetailVO;
  /** 关闭回调（浮层 = 收起；独立页 = 返回广场）。 */
  onClose?: () => void;
  /** 上一件 / 下一件（提供时显示翻页箭头并启用 ←/→）。 */
  onPrev?: () => void;
  onNext?: () => void;
}

export default function WorkDetailBody({
  detail,
  onClose,
  onPrev,
  onNext,
}: WorkDetailBodyProps) {
  const router = useRouter();

  const isVid = detail.type === "video";
  const cover = detail.cover || detail.thumbnail || "";
  const mediaUrl = isVid ? detail.videoUrl || "" : cover;
  const prompt = detail.prompt?.trim() || "";

  /* 键盘：Esc 关闭，←/→ 翻页；滚动锁定 —— 查看器自包含，两种宿主都生效 */
  const cbRef = useRef({ onClose, onPrev, onNext });
  useEffect(() => {
    cbRef.current = { onClose, onPrev, onNext };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cbRef.current.onClose?.();
      else if (e.key === "ArrowLeft") cbRef.current.onPrev?.();
      else if (e.key === "ArrowRight") cbRef.current.onNext?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, []);

  const copyPrompt = async () => {
    if (await copyText(prompt)) toast.success("提示词已复制");
    else toast.error("复制失败");
  };

  /* 生成同款：带入提示词 + 模型（创作台 flux_* 交接约定） */
  const goCreate = () => {
    try {
      sessionStorage.setItem("flux_prompt", detail.prompt || detail.title);
      if (detail.model) sessionStorage.setItem("flux_model", detail.model);
    } catch {
      /* sessionStorage may be unavailable */
    }
    toast.info("已带入参数 · 前往创作台");
    router.push("/studio");
  };

  /* 作为垫图 / 生成视频：与资产库同一 studio_use_asset 交接 */
  const sendToStudio = (op: "pad" | "video") => {
    if (!cover) return;
    try {
      sessionStorage.setItem("studio_use_asset", JSON.stringify({ url: cover, op }));
    } catch {
      /* ignore */
    }
    router.push("/studio");
  };

  const authorName = detail.author?.name || "创作者";
  const publishDay = (detail.createTime || "").slice(0, 10);

  return (
    <div className="wv" role="dialog" aria-modal="true" aria-label={detail.title}>
      {/* ── 舞台 ── */}
      <div className="wv-stage">
        {isVid && detail.videoUrl ? (
          <CapturableVideo src={detail.videoUrl} poster={cover || undefined} controls playsInline preload="metadata" />
        ) : cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={detail.title} />
        ) : (
          <div className="wv-mesh" style={{ background: coverFallback(detail.id) }} />
        )}

        {onPrev && (
          <button type="button" className="wv-arrow prev" aria-label="上一件" onClick={onPrev}>
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {onNext && (
          <button type="button" className="wv-arrow next" aria-label="下一件" onClick={onNext}>
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* ── 信息栏 ── */}
      <aside className="wv-side">
        <div className="wv-scroll">
          <div className="wv-top">
            {onClose && (
              <button type="button" className="wv-x" aria-label="关闭" onClick={onClose}>
                <X className="h-4 w-4" />
              </button>
            )}
            <Link
              className="wv-author"
              href={detail.author?.id ? `/user/${detail.author.id}` : "/explore"}
            >
              <span
                className="av"
                style={
                  detail.author?.avatar
                    ? { backgroundImage: `url("${detail.author.avatar}")` }
                    : { background: grayscaleSwatch(authorName) }
                }
              >
                {detail.author?.avatar ? "" : authorName.slice(0, 1).toUpperCase()}
              </span>
              <span>{authorName}</span>
            </Link>
            {mediaUrl && (
              <a
                className="wv-dl"
                href={mediaUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="查看原图 / 下载"
              >
                <Download className="h-4 w-4" />
              </a>
            )}
          </div>

          <h1>{detail.title}</h1>

          {detail.model && <span className="wv-model-chip">✦ {detail.model}</span>}

          {prompt && (
            <div className="wv-block">
              <div className="bl">
                提示词
                <button type="button" onClick={copyPrompt}>
                  <Copy className="h-3.5 w-3.5" /> 复制
                </button>
              </div>
              <div className="wv-prompt">{prompt}</div>
            </div>
          )}

          {(detail.model || detail.size || detail.cat || publishDay) && (
            <div className="wv-block wv-info">
              <div className="bl">信息</div>
              {detail.model && (
                <div className="row">
                  <span className="k">模型</span>
                  <span className="v">{detail.model}</span>
                </div>
              )}
              {detail.size && (
                <div className="row">
                  <span className="k">尺寸</span>
                  <span className="v">{detail.size}</span>
                </div>
              )}
              {detail.cat && (
                <div className="row">
                  <span className="k">分类</span>
                  <span className="v">{detail.cat}</span>
                </div>
              )}
              {publishDay && (
                <div className="row">
                  <span className="k">发布</span>
                  <span className="v">{publishDay}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="wv-actions">
          <button type="button" className="wv-btn" onClick={goCreate}>
            ✦ 生成同款
          </button>
          {!isVid && cover && (
            <div className="wv-sub">
              <button type="button" className="wv-btn ghost" onClick={() => sendToStudio("pad")}>
                作为垫图
              </button>
              <button type="button" className="wv-btn ghost" onClick={() => sendToStudio("video")}>
                生成视频
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
