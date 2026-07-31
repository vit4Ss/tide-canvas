/* 参考素材上传槽位（图片网格 / 音视频列表 / 首尾帧双框）— 从 create-studio.tsx
   的 renderSlotCard / renderFlfBox / renderUploads 抽出（纯移动，无逻辑改动）。 */

import type { CSSProperties } from "react";
import type { ModelConfig } from "@/types/admin-models";
import { SLOT_ICON } from "./icons";
import type { SlotData, SlotDef, ToolKey } from "./types";
import { slotHint, slotMax, thumbBg } from "./utils";

export function UploadSlots({
  tool,
  slots,
  ratio,
  slotData,
  mCfg,
  onAdd,
  onRemove,
  onSwapFlf,
  onPreview,
}: {
  tool: ToolKey;
  slots: SlotDef[] | null;
  ratio: string;
  slotData: SlotData;
  mCfg: ModelConfig | null;
  onAdd: (k: string, e?: React.MouseEvent) => void;
  onRemove: (k: string, i: number) => void;
  onSwapFlf: () => void;
  onPreview: (p: { k: string; i: number }) => void;
}) {
  const maxOf = (s: SlotDef) => slotMax(mCfg, tool, s);
  const hintOf = (s: SlotDef) => slotHint(mCfg, tool, s);

  const renderSlotCard = (s: SlotDef) => {
    const files = slotData[s.k] || [];
    if (files.length === 0) {
      return (
        <div className="ws-up" key={s.k}>
          <button className="ws-up-slot" type="button" onClick={(e) => onAdd(s.k, e)}>
            <span className="ws-up-slot-ic">{SLOT_ICON[s.type]}</span>
            <span className="ws-up-slot-tx">
              <span className="t">{s.label}</span>
              <span className="h">{hintOf(s)}</span>
            </span>
            <span className="ws-up-slot-go">上传 ↗</span>
          </button>
        </div>
      );
    }
    return (
      <div className="ws-up" key={s.k}>
        <div className="ws-up-head">
          <label>
            {s.label}
            <span className="ws-up-n">
              {files.length}/{maxOf(s)}
            </span>
          </label>
          <button className="ws-up-act" type="button" onClick={(e) => onAdd(s.k, e)}>
            ⤓ 上传
          </button>
        </div>
        {s.type === "image" ? (
          <div className="ws-up-grid">
            {files.map((f, i) => (
              <div
                className={`ws-ref${f.uploading ? " uploading" : ""}`}
                key={f.key ?? f.url ?? `${f.n}-${f.s ?? ""}`}
                title={f.uploading ? "上传中…" : "点击预览"}
                onClick={() => !f.uploading && onPreview({ k: s.k, i })}
              >
                <span className="ws-ref-img" style={{ background: thumbBg(f.g) }} />
                {f.uploading ? (
                  <span className="ws-ref-prog">
                    <span className="ws-ref-spin" aria-hidden />
                    <span className="ws-ref-pct">{f.progress ?? 0}%</span>
                  </span>
                ) : (
                  <span className="ws-ref-zoom">⚲</span>
                )}
                <button
                  className="ws-ref-x"
                  type="button"
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(s.k, i);
                  }}
                >
                  ✕
                </button>
                <span className="ws-ref-meta">
                  <span className="nm">{f.n}</span>
                  <span className="sz">{f.uploading ? `${f.progress ?? 0}%` : f.s}</span>
                </span>
              </div>
            ))}
            {files.length < maxOf(s) && (
              <button className="ws-ref-add" type="button" onClick={(e) => onAdd(s.k, e)}>
                <span className="p">＋</span>添加
              </button>
            )}
          </div>
        ) : (
          <div className="ws-up-list">
            {files.map((f, i) => (
              <div
                className={`ws-file${f.uploading ? " uploading" : ""}`}
                key={f.key ?? f.url ?? `${f.n}-${f.d ?? f.s ?? ""}`}
                title={f.uploading ? "上传中…" : "点击预览"}
                onClick={() => !f.uploading && onPreview({ k: s.k, i })}
              >
                <span className={`ic ${s.type}`}>
                  {f.uploading ? <span className="ws-ref-spin" aria-hidden /> : s.type === "video" ? "▶" : "♪"}
                </span>
                <span className="fn">{f.n}</span>
                <span className="fd">{f.uploading ? `上传中 ${f.progress ?? 0}%` : f.d}</span>
                <button
                  className="ws-file-x"
                  type="button"
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(s.k, i);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length < maxOf(s) && (
              <button className="ws-up-more" type="button" onClick={(e) => onAdd(s.k, e)}>
                ＋ 继续添加
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFlfBox = (s: SlotDef) => {
    const f = (slotData[s.k] || [])[0];
    if (!f) {
      return (
        <button className="ws-flf-box" type="button" onClick={(e) => onAdd(s.k, e)}>
          {/* SVG 加号：全角「＋」字形字面不居中，会与下方文字视觉错位 */}
          <span className="plus" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="lb">{s.label}</span>
        </button>
      );
    }
    return (
      <div
        className={`ws-flf-box filled${f.uploading ? " uploading" : ""}`}
        title={f.uploading ? "上传中…" : "点击预览"}
        onClick={() => !f.uploading && onPreview({ k: s.k, i: 0 })}
      >
        <span className="ws-flf-img" style={{ background: thumbBg(f.g) }} />
        {f.uploading && (
          <span className="ws-ref-prog">
            <span className="ws-ref-spin" aria-hidden />
            <span className="ws-ref-pct">{f.progress ?? 0}%</span>
          </span>
        )}
        <button
          className="ws-flf-x"
          type="button"
          title="移除"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(s.k, 0);
          }}
        >
          ✕
        </button>
        <span className="ws-flf-lb">{s.label}</span>
      </div>
    );
  };

  if (!slots) return null;
  if (tool === "flf") {
    const [rw, rh] = ratio.split(":");
    return (
      <div className="ws-reffiles" id="dropFiles" style={{ display: "block" }}>
        <div className="ws-up ws-up--flf">
          <div className="ws-up-head">
            <label>首尾帧</label>
            <span className="ws-up-tip">上传起止画面，生成平滑过渡</span>
          </div>
          <div
            className="ws-flf"
            style={{ ["--flf-ar" as string]: `${rw}/${rh}` } as CSSProperties}
          >
            {renderFlfBox(slots[0])}
            <button
              className="ws-flf-arrow"
              type="button"
              title="交换首尾帧"
              onClick={onSwapFlf}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M7 4 3 8l4 4M3 8h18M17 20l4-4-4-4M21 16H3" />
              </svg>
            </button>
            {renderFlfBox(slots[1])}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="ws-reffiles" id="dropFiles" style={{ display: "block" }}>
      {slots.map(renderSlotCard)}
    </div>
  );
}
