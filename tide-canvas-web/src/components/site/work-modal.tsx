"use client";

/* ============================================================================
   WorkModal — React port of openWork() / closeWork() from
   design-ref/liuguang/shell.js. Reusable artwork-detail dialog.

   Renders the canonical liuguang modal markup (.mask / .modal / .modal-media /
   .cov / .modal-side / .modal-author / .pblock / .pgrid / .pcell /
   .modal-actions) so the shared styles in pages.css apply unchanged.

   - Controlled: parent passes `work` (open when non-null) + `onClose`.
   - Covers are MeshHues triplets → rendered via coverBg(work.cover).
   - Generation params fall back to the design's defaults when missing.
   - Actions: 关注 / 复制提示词 / 收藏 / 下载 surface a toast; 生成同款 → /studio
     (carries the prompt via sessionStorage, mirroring shell.js).
   - Backdrop click + Escape close; body scroll lock while open.
   ========================================================================== */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Artwork } from "@/mock";
import { coverBg, fmt } from "@/mock";
import { Avatar } from "@/components/flux/atoms";
import { toast } from "@/components/shared/toast";

export interface WorkModalProps {
  /** The artwork to show; modal is open while this is non-null. */
  work: Artwork | null;
  onClose: () => void;
}

export default function WorkModal({ work, onClose }: WorkModalProps) {
  const router = useRouter();
  const open = !!work;
  // full-image zoom (click the media to enlarge a real image result). The zoom
  // overlay covers the modal's close controls, so the modal can only be dismissed
  // once the zoom is closed — i.e. zoom is always false by the time work changes,
  // which is why no cross-work reset is needed.
  const [zoom, setZoom] = useState(false);

  // Escape + body scroll lock (mirrors shell.js ensureModal/openWork). While the
  // zoom overlay is open, Escape closes the zoom first, then the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoom) setZoom(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("scroll-lock");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("scroll-lock");
    };
  }, [open, onClose, zoom]);

  if (!work) return null;

  const a = work;
  const isVid = a.type === "video";
  // only a real image (not a mesh-placeholder cover, not a video) can be zoomed.
  const canZoom = !!a.src && !isVid;

  // Defaults match shell.js openWork() when params are missing.
  const neg = a.negPrompt || "低质量, 模糊, 多余肢体, 水印, 畸变, 文字";
  const steps = a.steps ?? 30;
  const sampler = a.sampler || "DPM++ 2M Karras";
  const cfg = a.cfgScale ?? 7.5;
  const size = a.size || "1024×1536";
  const seed = "2837461920";
  const prompt =
    a.prompt ||
    `${a.title}，${a.model} 生成，高清细节，电影级布光，超写实质感`;

  const goCreate = () => {
    try {
      sessionStorage.setItem("flux_prompt", a.prompt || a.title);
    } catch {
      /* sessionStorage may be unavailable */
    }
    toast.info("已带入参数 · 前往创作台");
    router.push("/studio");
  };

  const copyPrompt = () => {
    try {
      navigator.clipboard?.writeText(prompt);
    } catch {
      /* clipboard may be unavailable */
    }
    toast.success("提示词已复制");
  };

  return (
    <div
      className="mask show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-media">
          <div
            className="cov"
            style={{
              background: a.src
                ? `center / cover no-repeat url("${a.src}")`
                : coverBg(a.cover),
              ...(canZoom ? { cursor: "zoom-in" } : {}),
            }}
            onClick={canZoom ? () => setZoom(true) : undefined}
            role={canZoom ? "button" : undefined}
            aria-label={canZoom ? "放大查看" : undefined}
          />
          {isVid && <span className="play-orb">▶</span>}
          <button type="button" className="modal-x" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-side">
          <h3 className="mt">{a.title}</h3>

          <div className="modal-author">
            <Avatar name={a.author} size={42} className="av" />
            <div>
              <div className="an">{a.author}</div>
              <div className="as">
                {fmt(a.likes)} 喜欢 · {a.cat}
              </div>
            </div>
            <button
              type="button"
              className="foll"
              onClick={() => toast.success(`已关注 ${a.author}`)}
            >
              + 关注
            </button>
          </div>

          <div className="pblock">
            <div className="pl">
              提示词{" "}
              <button type="button" onClick={copyPrompt}>
                复制
              </button>
            </div>
            <div className="pv">{prompt}</div>
          </div>

          <div className="pblock">
            <div className="pl">反向提示词</div>
            <div className="pv">{neg}</div>
          </div>

          <div className="pgrid">
            <div className="pcell">
              <div className="k">模型</div>
              <div className="v">{a.model.split(" ")[0]}</div>
            </div>
            <div className="pcell">
              <div className="k">采样器</div>
              <div className="v">{sampler.split(" ")[0]}</div>
            </div>
            <div className="pcell">
              <div className="k">步数</div>
              <div className="v">{steps}</div>
            </div>
            <div className="pcell">
              <div className="k">CFG</div>
              <div className="v">{cfg}</div>
            </div>
            <div className="pcell">
              <div className="k">尺寸</div>
              <div className="v">{size}</div>
            </div>
            <div className="pcell">
              <div className="k">种子</div>
              <div className="v">{String(seed).slice(0, 7)}</div>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="pri" onClick={goCreate}>
              ✦ 生成同款
            </button>
            <button
              type="button"
              className="sec"
              aria-label="收藏"
              onClick={() => toast.success("已加入收藏")}
            >
              ♥
            </button>
            <button
              type="button"
              className="sec"
              aria-label="下载"
              onClick={() => toast.success("已下载到本地")}
            >
              ⤓
            </button>
          </div>
        </div>
      </div>

      {/* full-image zoom — click the media to enlarge; backdrop / ✕ / Esc closes */}
      {zoom && a.src && (
        <div className="modal-zoom" onClick={() => setZoom(false)}>
          <button
            type="button"
            className="modal-zoom-x"
            aria-label="关闭"
            onClick={() => setZoom(false)}
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.src} alt={a.title} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
