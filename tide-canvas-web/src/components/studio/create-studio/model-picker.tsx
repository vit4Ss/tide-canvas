/* 模型选择器（触发卡 + fixed 定位下拉）— 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   自含：开合状态、外部点击/Escape 收起、按触发卡锚定的 fixed 定位与视口收缩。 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { StudioModelVO } from "@/lib/market-api";
import { resolveModelSwatch } from "@/lib/model-brand";
import type { ModelMeta } from "./types";
import { metaOf, metaOfStudio } from "./utils";

export function ModelPicker({
  model,
  names,
  studioList,
  onSelect,
}: {
  model: string;
  names: string[];
  studioList: StudioModelVO[];
  onSelect: (name: string) => void;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  const modelMeta = useMemo(() => {
    const map: Record<string, ModelMeta> = {};
    for (const m of studioList) map[m.name] = metaOfStudio(m);
    return map;
  }, [studioList]);
  const selectedName = names.includes(model) ? model : names[0] || "暂无可用模型";
  const meta = names.length ? metaOf(selectedName, modelMeta) : { tag: "", by: "", desc: "请先在模型管理上架对应模型" };

  // swatch 样式+字形：后台配置 icon > 品牌官方 logo > 首字母渐变——与 chat 共用
  // model-brand.ts 的 resolveModelSwatch；按模型名 memo，避免每次渲染重跑正则。
  const swatchByName = useMemo(() => {
    const map: Record<string, { style: CSSProperties; content: string }> = {};
    for (const m of studioList) {
      const r = resolveModelSwatch({ name: m.name, modelKey: m.modelKey, icon: m.config?.icon });
      map[m.name] = { style: r.style, content: r.glyph };
    }
    return map;
  }, [studioList]);
  const swatchFor = (name: string): { style: CSSProperties; content: string } => {
    if (swatchByName[name]) return swatchByName[name];
    const r = resolveModelSwatch({ name });
    return { style: r.style, content: r.glyph };
  };

  // close the model dropdown on outside click (create.js document click).
  useEffect(() => {
    if (!modelOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!modelWrapRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelOpen(false);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  // 模型下拉用 fixed 定位锚到触发卡下沿：原来的 absolute 定位会被
  // .ws-panel-scroll(overflow-y:auto) 的滚动口在矮窗口下裁掉下半截；
  // fixed 悬浮于面板之上，并按视口剩余空间收缩高度（菜单内部可滚动）。
  const [modelMenuStyle, setModelMenuStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const place = () => {
      const wrap = modelWrapRef.current;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      setModelMenuStyle({
        position: "fixed",
        top: r.bottom + 8,
        left: r.left,
        right: "auto",
        width: r.width,
        maxHeight: Math.max(160, Math.min(340, window.innerHeight - r.bottom - 24)),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [modelOpen]);

  const selSwatch = swatchFor(selectedName);

  return (
    <div
      className={`ws-model-wrap${modelOpen ? " open" : ""}`}
      ref={modelWrapRef}
    >
      <button
        className="ws-model"
        id="modelCard"
        type="button"
        disabled={!names.length}
        aria-haspopup="listbox"
        aria-expanded={modelOpen}
        onClick={(e) => {
          e.stopPropagation();
          if (!names.length) return;
          setModelOpen((v) => !v);
        }}
      >
        <span className="ws-model-sw" style={selSwatch.style}>
          {selSwatch.content}
        </span>
        <span className="ws-model-info">
          <span className="ws-model-row">
            <span className="ws-model-name">{selectedName}</span>
            {meta.tag && <span className="ws-model-tag">{meta.tag}</span>}
          </span>
          <span className="ws-model-desc">
            {meta.by ? `${meta.by} · ${meta.desc}` : meta.desc}
          </span>
        </span>
        <span className="ws-model-switch">
          <span className="cv">▾</span>
        </span>
      </button>

      <div className="ws-model-menu" id="modelMenu" role="listbox" style={modelMenuStyle}>
        {names.map((m) => {
          const mm = metaOf(m, modelMeta);
          const sw = swatchFor(m);
          return (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === selectedName}
              className={`ws-mopt${m === selectedName ? " on" : ""}`}
              onClick={() => {
                onSelect(m);
                setModelOpen(false);
              }}
            >
              <span className="ws-mopt-sw" style={sw.style}>
                {sw.content}
              </span>
              <span className="ws-mopt-info">
                <span className="ws-mopt-row">
                  <span className="ws-mopt-name">{m}</span>
                  {mm.tag && <span className="ws-model-tag">{mm.tag}</span>}
                </span>
                <span className="ws-mopt-desc">
                  {mm.by ? `${mm.by} · ${mm.desc}` : mm.desc}
                </span>
              </span>
              <span className="ws-mopt-ck">✓</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
