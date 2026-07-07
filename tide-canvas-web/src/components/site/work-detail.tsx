"use client";

/* ============================================================================
   WorkDetailBody — the shared 作品详情 content (media column + info column),
   used by BOTH the quick-view modal (<WorkModal/>) and the standalone detail
   page (/explore/[id]). Self-contained: it owns the like / bookmark / follow /
   comment state and calls the real community API.

   Rendered inside a `.modal` container by the caller (the modal wraps it in a
   `.mask`; the page renders it in a centered page section). Uses the liuguang
   modal markup classes (.modal-media / .modal-side / .pblock / .pgrid …) plus a
   few new comment/share classes added to pages.css.
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { copyText } from "@/lib/clipboard";
import type { PostDetailVO } from "@/types/community";
import { toast } from "@/components/shared/toast";
import { mesh } from "@/lib/mesh";

/** Deterministic mesh-hue triplet seeded from a post id (cover fallback). */
function coverFallback(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

export interface WorkDetailBodyProps {
  detail: PostDetailVO;
  /** When provided, a ✕ close button is shown (modal usage). */
  onClose?: () => void;
  /** 保留签名兼容旧调用方；墙签形态已无点赞入口，不再触发。 */
  onEngagementChange?: (e: { id: string; liked: boolean; likes: number }) => void;
}

export default function WorkDetailBody({ detail, onClose }: WorkDetailBodyProps) {
  const router = useRouter();

  const isVid = detail.type === "video";
  const cover = detail.cover || detail.thumbnail || "";
  // 观展装裱：contain 保留真实构图比例，作品浮在近黑展墙上（不再 cover 裁切）
  const coverBgVal = cover ? `center / contain no-repeat url("${cover}")` : coverFallback(detail.id);
  const canZoom = !!cover && !isVid;

  const [zoom, setZoom] = useState(false);

  // re-seed when the detail changes (modal reused for a different work).
  useEffect(() => {
    setZoom(false);
  }, [detail]);

  // 墙签只放系统真实字段：空值不显示，绝不编造兜底文案/参数。
  // 规格收成一行铭文（画签的"材质 · 尺寸"行）：主题 · 模型 · 分辨率
  const prompt = detail.prompt?.trim() || "";
  const specLine = [detail.cat, detail.model, detail.size]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join("  ·  ");

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

  const copyPrompt = async () => {
    // 共享 copyText：clipboard API + execCommand 回退，失败明确提示（原实现静默吞掉）
    if (await copyText(prompt)) toast.success("提示词已复制");
    else toast.error("复制失败");
  };

  return (
    <>
      <div className="modal-media">
        {isVid && detail.videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            className="cov"
            src={detail.videoUrl}
            poster={cover || undefined}
            controls
            playsInline
            preload="metadata"
            style={{ objectFit: "contain", background: cover ? undefined : coverBgVal }}
          />
        ) : (
          <div
            className="cov"
            style={{ background: coverBgVal, ...(canZoom ? { cursor: "zoom-in" } : {}) }}
            onClick={canZoom ? () => setZoom(true) : undefined}
            role={canZoom ? "button" : undefined}
            aria-label={canZoom ? "放大查看" : undefined}
          />
        )}
        {/* play-orb only on a still poster (no inline player) */}
        {isVid && !detail.videoUrl && <span className="play-orb">▶</span>}
        {onClose && (
          <button type="button" className="modal-x" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      {/* 墙签：作品与文字同处一面展墙，文字块居于视线高度 */}
      <div className="modal-side">
        <div className="mt-eyebrow">
          <span className="d" />
          正在展出 · {detail.cat || "作品"}
        </div>
        <h3 className="mt">{detail.title}</h3>
        {specLine && <div className="mt-specs">{specLine}</div>}

        {prompt && (
          <div className="pblock">
            <div className="pl">
              提示词{" "}
              <button type="button" onClick={copyPrompt}>
                复制
              </button>
            </div>
            <div className="pv">{prompt}</div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="pri" onClick={goCreate}>
            ✦ 生成同款
          </button>
        </div>
      </div>

      {zoom && cover && (
        <div className="modal-zoom" onClick={() => setZoom(false)}>
          <button type="button" className="modal-zoom-x" aria-label="关闭" onClick={() => setZoom(false)}>
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={detail.title} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
