"use client";

/* ============================================================================
   创作台 · CreateStudio — React port of design-ref/创作台.html
   (<aside class="ws-panel"> control panel + <main class="ws-stage"> center
   stage + 生成历史 strip) and design-ref/liuguang/create.js.

   Renders ONLY the panel + stage (the (studio) layout owns the ws-rail and
   imports flux/pages/studio.css). Exact liuguang class names are used so the
   already-imported CSS applies unchanged.

   Generation / AI 优化 are SIMULATED client-side (mock progress intervals →
   mesh-cover result cards) — the real API is a later phase. Covers are stored
   as MeshHues hue triplets so result/history cards can open the shared
   <WorkModal/> (which derives CSS via coverBg()).

   Handoff: reads sessionStorage 'flux_prompt' / 'flux_model' on mount to
   prefill the prompt / model (mirrors create.js + work-modal.tsx).
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Artwork, ArtworkType, MeshHues } from "@/mock";
import { ARTWORKS, CREATE_MODELS, coverBg, mesh } from "@/mock";
import { aiApi } from "@/lib/api";
import type { AiModelVO } from "@/types/ai";
import WorkModal from "@/components/site/work-modal";
import { toast } from "@/components/shared/toast";
import styles from "@/app/(studio)/studio/create.module.css";

/* ── constants (ported 1:1 from create.js) ───────────────────────────────── */

const RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

const IDEAS = [
  "赛博朋克城市夜景，霓虹倒影，电影感，8K",
  "青绿山水工笔，石青石绿设色，宋代院体",
  "液态金属机器人，纯白工作室布光，C4D 渲染",
  "黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒",
  "深海发光水母，慢镜头，4K 微距，蓝紫光束",
] as const;

type ToolKey = "t2i" | "i2i" | "edit" | "t2v" | "i2v" | "flf" | "ref";
type ToolMode = "t2i" | "i2i" | "t2v";

interface ToolCfg {
  mode: ToolMode;
  label: string;
  head: string;
  drop: boolean;
  ph: string;
}

const TOOLS: Record<ToolKey, ToolCfg> = {
  t2i: { mode: "t2i", label: "文生图", head: "生成图片", drop: false, ph: "描述你想要的画面，越具体越好…\n例：赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实" },
  i2i: { mode: "i2i", label: "图生图", head: "图生图", drop: true, ph: "上传参考图，再描述想要的改动…\n例：保留构图，改成赛博朋克霓虹风格" },
  edit: { mode: "i2i", label: "改图", head: "改图 · 扩图", drop: true, ph: "上传图片，描述要修改或扩展的部分…\n例：把背景扩展为开阔的雪山草原" },
  t2v: { mode: "t2v", label: "文生视频", head: "生成视频", drop: false, ph: "描述镜头与运动…\n例：金色麦田，强风掠过，慢镜头航拍，电影调色" },
  i2v: { mode: "t2v", label: "图生视频", head: "图生视频", drop: true, ph: "上传首帧图片，再描述运动…\n例：人物缓缓回头，发丝随风飘动，电影质感" },
  flf: { mode: "t2v", label: "首尾帧", head: "首尾帧生成", drop: true, ph: "上传首帧与尾帧，描述过渡…\n例：从清晨到日落的平滑时间流逝" },
  ref: { mode: "t2v", label: "全能参考", head: "全能参考", drop: true, ph: "上传参考图（人物 / 风格 / 动作），描述想要的视频…\n例：参考人物形象，生成其在雪山奔跑的镜头" },
};

const MODES_BY_TYPE: Record<ArtworkType, ToolKey[]> = {
  image: ["t2i", "i2i"],
  video: ["t2v", "i2v", "flf", "ref"],
};

interface ModelMeta {
  tag: string;
  by: string;
  desc: string;
}

const MODEL_META: Record<string, ModelMeta> = {
  "GPT Image 2": { tag: "HD", by: "OpenAI", desc: "万能画风 · 超清细节" },
  "Flux.1 Pro": { tag: "PRO", by: "Black Forest", desc: "写实质感 · 精准构图" },
  "Midjourney v6": { tag: "ART", by: "Midjourney", desc: "艺术氛围 · 电影光影" },
  "Nano Banana 2": { tag: "NEW", by: "Google", desc: "极速出图 · 风格百变" },
  "SDXL Lightning": { tag: "4×", by: "Stability", desc: "秒级生成 · 开源高效" },
  "即梦 3.0": { tag: "CN", by: "字节跳动", desc: "中文语义 · 国风擅长" },
  "Seedance 2.0": { tag: "VID", by: "字节跳动", desc: "视听双绝 · 镜头流畅" },
  "可灵 Kling 1.6": { tag: "VID", by: "快手", desc: "长镜头 · 物理真实" },
};

const DEFAULT_META: ModelMeta = { tag: "AI", by: "模型", desc: "高质量生成" };

/** map a backend AiModelVO.type to a short display tag. */
function typeTag(type: string): string {
  return type === "video"
    ? "VID"
    : type === "audio"
      ? "AUD"
      : type === "text"
        ? "TXT"
        : "IMG";
}

/** derive a ModelMeta for a real backend model (curated MODEL_META wins). */
function metaOfModel(m: AiModelVO): ModelMeta {
  return (
    MODEL_META[m.name] || {
      tag: typeTag(m.type),
      by: m.modelId || "模型",
      desc: m.pointCost > 0 ? `${m.pointCost} 积分 / 次` : "高质量生成",
    }
  );
}

/** meta lookup by display name, optionally backed by the real models map. */
function metaOf(name: string, metaMap?: Record<string, ModelMeta>): ModelMeta {
  return metaMap?.[name] || MODEL_META[name] || DEFAULT_META;
}

/** deterministic per-model swatch gradient (create.js modelSwatch). */
function modelSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 50) % 360} 80% 52%))`;
}

/** first A-Z / CJK char (create.js modelInitial). */
function modelInitial(name: string): string {
  const m = name.replace(/[^A-Za-z一-龥]/g, "");
  return m.charAt(0) || "A";
}

/** stable hue seed from a prompt (create.js generate()). */
function promptHue(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) % 360;
  return h;
}

/* ── result / history models (carry hue triplets so cards open WorkModal) ── */

interface ResultCell {
  i: number;
  /** hue triplet → coverBg() for the modal, mesh() for the card bg. */
  hues: MeshHues;
}

interface HistItem {
  id: string;
  hues: MeshHues;
  type: ArtworkType;
  title: string;
  prompt: string;
  model: string;
}

let histSeq = 0;

/* ── component ───────────────────────────────────────────────────────────── */

export default function CreateStudio() {
  /* panel state */
  const [curType, setCurType] = useState<ArtworkType>("image");
  const [tool, setTool] = useState<ToolKey>("t2i");
  const [model, setModel] = useState<string>("GPT Image 2");
  const [modelOpen, setModelOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>(RATIOS[0]);
  const [count, setCount] = useState(4);

  /* real models (public, no auth) — names drive the picker; metaMap enriches
     each row. Falls back to the CREATE_MODELS default list when the seeded DB
     has no ai_models yet (or the request fails), so the picker is never empty. */
  const [modelNames, setModelNames] = useState<string[]>(CREATE_MODELS);
  const [modelMeta, setModelMeta] = useState<Record<string, ModelMeta>>({});

  /* stage state */
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<ResultCell[]>([]);
  const [progs, setProgs] = useState<number[]>([]);
  const [doneSet, setDoneSet] = useState<Record<number, boolean>>({});
  const [runMeta, setRunMeta] = useState<{
    prompt: string;
    model: string;
    ratio: string;
    count: number;
    label: string;
    isVid: boolean;
  } | null>(null);

  /* history — seeded from ARTWORKS (first 12), newest on the left (create.js
     seedHistory). Deterministic + SSR-safe, so it lives in lazy initial state
     rather than an effect. */
  const [hist, setHist] = useState<HistItem[]>(() =>
    ARTWORKS.slice(0, 12).map((a) => ({
      id: `seed-${a.id}`,
      hues: a.cover,
      type: a.type,
      title: a.title,
      prompt: a.prompt || a.title,
      model: a.model,
    })),
  );
  const [histFilter, setHistFilter] = useState<"all" | "image" | "video">("all");

  /* shared work-detail modal */
  const [active, setActive] = useState<Artwork | null>(null);

  const ticksRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  /* ── derived ─────────────────────────────────────────────────────────── */

  const cfg = TOOLS[tool];
  const meta = metaOf(model, modelMeta);
  const hasResults = cells.length > 0;

  // cost: 30 for video models / t2v tool, else 10 — per × count (create.js).
  const per = /Seedance|Kling|Veo|视频/.test(model) || cfg.mode === "t2v" ? 30 : 10;
  const cost = per * count;

  const allDone = hasResults && Object.keys(doneSet).length >= cells.length;
  const aggProg =
    progs.length > 0 ? progs.reduce((a, b) => a + b, 0) / progs.length : 0;
  const doneCount = Object.keys(doneSet).length;

  const filteredHist = useMemo(
    () => (histFilter === "all" ? hist : hist.filter((h) => h.type === histFilter)),
    [hist, histFilter],
  );

  /* ── prompt / model handoff (mount) ──────────────────────────────────── */

  useEffect(() => {
    // accept a prompt / model handoff from "生成同款" (create.js + work-modal).
    // Reading sessionStorage is an external-system read that can only run on the
    // client post-mount (avoids a hydration mismatch from a lazy initializer),
    // so setting state here is the intended pattern despite the lint heuristic.
    try {
      const p = sessionStorage.getItem("flux_prompt");
      const m = sessionStorage.getItem("flux_model");
      if (!p && !m) return;
      if (p) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrompt(p);
        sessionStorage.removeItem("flux_prompt");
      }
      if (m) {
        setModel(m);
        sessionStorage.removeItem("flux_model");
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);

  // load real models (public endpoint, no session needed). Replaces the
  // CREATE_MODELS mock list; on empty/failure we keep the default fallback.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await aiApi.listModels();
        if (!alive) return;
        const models = res.success && Array.isArray(res.data) ? res.data : [];
        if (models.length === 0) return; // keep CREATE_MODELS fallback
        const names: string[] = [];
        const metaMap: Record<string, ModelMeta> = {};
        for (const m of models) {
          if (!m.name || names.includes(m.name)) continue;
          names.push(m.name);
          metaMap[m.name] = metaOfModel(m);
        }
        if (names.length === 0) return;
        setModelNames(names);
        setModelMeta(metaMap);
        // if the current selection isn't a real model, snap to the first one
        // (unless a handoff already picked a valid name).
        setModel((cur) => (names.includes(cur) ? cur : names[0]));
      } catch {
        /* keep CREATE_MODELS fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // close the model dropdown on outside click (create.js document click).
  useEffect(() => {
    if (!modelOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!modelWrapRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [modelOpen]);

  // clear any running intervals on unmount.
  useEffect(() => () => ticksRef.current.forEach((t) => clearInterval(t)), []);

  /* ── panel handlers ──────────────────────────────────────────────────── */

  const pickType = (t: ArtworkType) => {
    setCurType(t);
    setTool(MODES_BY_TYPE[t][0]); // renderModes() → setTool(keys[0])
  };

  const aiOptimize = () => {
    let v = prompt.trim();
    if (!v) v = "一幅富有想象力的画面";
    const boost = "，超清细节，电影级布光，景深层次，8K 高分辨率";
    if (!/超清细节/.test(v)) v += boost;
    setPrompt(v);
    toast.success("✦ 已用 AI 优化提示词");
  };

  const buildWork = (
    hues: MeshHues,
    type: ArtworkType,
    p: string,
    mdl: string,
  ): Artwork => ({
    id: `gen-${++histSeq}`,
    cover: hues,
    h: 1,
    type,
    cat: "设计",
    model: mdl,
    title: (p || "我的创作").slice(0, 14) + (p.length > 14 ? "…" : ""),
    author: "我的创作",
    likes: 0,
    prompt: p,
  });

  const pushHistory = useCallback(
    (item: Omit<HistItem, "id">) =>
      setHist((prev) => [{ id: `h-${++histSeq}`, ...item }, ...prev]),
    [],
  );

  /* ── generation (simulated, ported from create.js generate()) ────────── */

  const generate = useCallback(() => {
    if (busy) return;
    const p = prompt.trim();
    if (!p) {
      toast.info("先写一句提示词吧 ✦");
      return;
    }
    setBusy(true);

    const n = count;
    const isVid = TOOLS[tool].mode === "t2v";
    const label = TOOLS[tool].label;
    const r = ratio;
    const mdl = model;
    const hsh = promptHue(p);

    const newCells: ResultCell[] = Array.from({ length: n }, (_, i) => ({
      i,
      hues: [hsh + i * 36, hsh + i * 36 + 80, hsh + i * 36 + 200] as MeshHues,
    }));

    setRunMeta({ prompt: p, model: mdl, ratio: r, count: n, label, isVid });
    setCells(newCells);
    setProgs(new Array(n).fill(0));
    setDoneSet({});

    // clear any stragglers, then start per-cell progress intervals.
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    const local = new Array(n).fill(0);

    newCells.forEach((cell, i) => {
      const speed = 1.4 + Math.random() * 1.2;
      const tick = setInterval(() => {
        local[i] = Math.min(100, local[i] + speed + Math.random() * 3);
        setProgs([...local]);
        if (local[i] >= 100) {
          clearInterval(tick);
          setDoneSet((prev) => {
            if (prev[i]) return prev;
            // record into history as each cell completes.
            pushHistory({
              hues: cell.hues,
              type: isVid ? "video" : "image",
              title: p,
              prompt: p,
              model: mdl,
            });
            const next = { ...prev, [i]: true };
            if (Object.keys(next).length >= n) {
              setBusy(false);
              toast.success("生成完成 · 点击作品查看详情");
            }
            return next;
          });
        }
      }, 90 + i * 40);
      ticksRef.current.push(tick);
    });
  }, [busy, prompt, count, tool, ratio, model, pushHistory]);

  // tear down the current run's intervals + result state (no busy guard).
  const resetRun = useCallback(() => {
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    setCells([]);
    setProgs([]);
    setDoneSet({});
    setRunMeta(null);
  }, []);

  const cancelRun = () => {
    setBusy(false);
    resetRun();
    toast.info("已取消生成");
  };

  // header "清空" — disabled while busy, so a plain reset is safe here.
  const clearCanvas = () => {
    if (busy) return;
    resetRun();
  };

  // per-cell hover actions (create.js gen-acts).
  const cellAction = (act: string, cell: ResultCell) => {
    if (act === "del") {
      setCells((prev) => prev.filter((c) => c.i !== cell.i));
      toast.info("已删除");
    } else if (act === "regen") {
      if (runMeta) setPrompt(runMeta.prompt);
      toast.info("已带入提示词 · 可重新生成");
    } else {
      toast.info("编辑 · 高保真原型");
    }
  };

  const openCell = (cell: ResultCell) => {
    if (!doneSet[cell.i] || !runMeta) return;
    setActive(
      buildWork(
        cell.hues,
        runMeta.isVid ? "video" : "image",
        runMeta.prompt,
        runMeta.model,
      ),
    );
  };

  const openHist = (h: HistItem) =>
    setActive(buildWork(h.hues, h.type, h.prompt, h.model));

  /* ── render ──────────────────────────────────────────────────────────── */

  const modeKeys = MODES_BY_TYPE[curType];
  const swatchStyle: CSSProperties = { background: modelSwatch(model) };

  return (
    <>
      <div className={styles.cols}>
      {/* ── control panel ───────────────────────────────────────────── */}
      <aside className="ws-panel">
        <div className="ws-panel-scroll">
          {/* type tabs: 图片 / 视频 */}
          <div className="ws-typetabs" id="type-tabs">
            <button
              type="button"
              className={curType === "image" ? "on" : undefined}
              onClick={() => pickType("image")}
            >
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="8.5" cy="9.5" r="1.6" />
                <path d="M21 16l-5-5L5 20" />
              </svg>
              图片
            </button>
            <button
              type="button"
              className={curType === "video" ? "on" : undefined}
              onClick={() => pickType("video")}
            >
              <svg viewBox="0 0 24 24">
                <rect x="3" y="5" width="13" height="14" rx="2" />
                <path d="M16 10l5-3v10l-5-3z" />
              </svg>
              视频
            </button>
          </div>

          {/* mode tabs (generation tool) */}
          <div className="seg" id="mode-tabs">
            {modeKeys.map((k) => (
              <button
                key={k}
                type="button"
                className={tool === k ? "on" : undefined}
                onClick={() => setTool(k)}
              >
                {TOOLS[k].label}
              </button>
            ))}
          </div>

          {/* model picker */}
          <div
            className={`ws-model-wrap${modelOpen ? " open" : ""}`}
            ref={modelWrapRef}
          >
            <button
              className="ws-model"
              id="modelCard"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              onClick={(e) => {
                e.stopPropagation();
                setModelOpen((v) => !v);
              }}
            >
              <span className="ws-model-sw" style={swatchStyle}>
                {modelInitial(model)}
              </span>
              <span className="ws-model-info">
                <span className="ws-model-row">
                  <span className="ws-model-name">{model}</span>
                  <span className="ws-model-tag">{meta.tag}</span>
                </span>
                <span className="ws-model-desc">
                  {meta.by} · {meta.desc}
                </span>
              </span>
              <span className="ws-model-switch">
                <span className="cv">▾</span>
              </span>
            </button>

            <div className="ws-model-menu" id="modelMenu" role="listbox">
              {modelNames.map((m) => {
                const mm = metaOf(m, modelMeta);
                return (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={m === model}
                    className={`ws-mopt${m === model ? " on" : ""}`}
                    onClick={() => {
                      setModel(m);
                      setModelOpen(false);
                    }}
                  >
                    <span className="ws-mopt-sw" style={{ background: modelSwatch(m) }}>
                      {modelInitial(m)}
                    </span>
                    <span className="ws-mopt-info">
                      <span className="ws-mopt-row">
                        <span className="ws-mopt-name">{m}</span>
                        <span className="ws-model-tag">{mm.tag}</span>
                      </span>
                      <span className="ws-mopt-desc">
                        {mm.by} · {mm.desc}
                      </span>
                    </span>
                    <span className="ws-mopt-ck">✓</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* reference-image drop zone (shown for drop-capable tools) */}
          <div
            className={`ws-drop${cfg.drop ? " show" : ""}`}
            id="drop"
            onClick={() => toast.info("选择参考图 · 高保真原型")}
          >
            <div className="ws-drop-ic">⤒</div>
            <div className="ws-drop-tx">
              拖入参考图，或<b>点击上传</b>
            </div>
            <div className="ws-drop-sub">JPG / PNG / WEBP · ≤ 20MB</div>
          </div>

          {/* prompt */}
          <div className="ws-seclabel">
            提示词{" "}
            <span className="ws-pcount">
              <b id="pLen">{prompt.length}</b> 字
            </span>
          </div>
          <div className="ws-promptbox">
            <textarea
              className="ws-prompt"
              id="prompt"
              placeholder={cfg.ph}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="ws-prompt-foot">
              <button className="ws-aiopt" type="button" onClick={aiOptimize}>
                <span className="spark">✦</span> AI 优化
              </button>
              <button
                className="ws-pclear"
                type="button"
                onClick={() => setPrompt("")}
              >
                清空
              </button>
            </div>
          </div>

          {/* idea chips */}
          <div className="ws-chips-head">灵感提示词 · 点击填入</div>
          <div className="ws-chips" id="ideas">
            {IDEAS.map((t) => (
              <button key={t} type="button" onClick={() => setPrompt(t)}>
                {t.slice(0, 10)}…
              </button>
            ))}
          </div>

          {/* ratio */}
          <div className="ws-field col">
            <label>画面比例</label>
            <div className="ws-ratios" id="ratios">
              {RATIOS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`ratio${r === ratio ? " on" : ""}`}
                  onClick={() => setRatio(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* count */}
          <div className="ws-field col">
            <label>
              生成数量 · <span id="countVal">{count}</span>
            </label>
            <input
              className="slider"
              id="count"
              type="range"
              min={1}
              max={4}
              step={1}
              value={count}
              onChange={(e) => setCount(+e.target.value)}
            />
          </div>
        </div>

        {/* footer */}
        <div className="ws-panel-foot">
          <button
            className={`ws-gen${busy ? " busy" : ""}`}
            id="gen"
            type="button"
            onClick={generate}
          >
            <span className="spark">✦</span> 立即生成{" "}
            <span className="ws-gen-cost">
              ·&nbsp;<b id="cost">{cost}</b>&nbsp;积分
            </span>
          </button>
          <div className="ws-balance">
            余额 1,280 积分 · <a href="/pricing">充值</a>
          </div>
        </div>
      </aside>

      {/* ── center stage ────────────────────────────────────────────── */}
      <main className="ws-stage" id="stage">
        <div className="ws-stage-main">
          {/* stage-local ambient backdrop (design's <canvas id="flux"
              class="ws-stage-fx">). Styled by studio.css's .ws-stage-fx —
              we use the CSS gradient fallback so it stays scoped to the stage
              (FluxField's #flux-bg is a full-viewport fixed field, unsuitable
              here; the WebGL upgrade can land in a later phase). */}
          <canvas id="flux" className="ws-stage-fx flux-fallback" aria-hidden />
          <div className="ws-stage-veil" />

          <div className="ws-stage-top">
            <div className="ws-crumb">
              <span className="d" />
              创作台 · STUDIO
            </div>
            <div className="ws-stage-actions">
              <button
                className="ws-iconbtn"
                id="clearBtn"
                type="button"
                title="清空画布"
                disabled={!hasResults || busy}
                onClick={clearCanvas}
              >
                清空
              </button>
            </div>
          </div>

          {/* empty state */}
          {!hasResults && (
            <div className="ws-empty" id="empty">
              <div className="ws-empty-glyph">
                <span className="glyph" />
              </div>
              <h2>准备好开始创作了吗？</h2>
              <p>写下一句提示词，挑个模型与比例 —— 数秒之后，作品就在这里浮现。</p>
              <div className="ws-empty-tags">
                {(
                  [
                    { type: "image", tool: "t2i", label: "✦ 文生图" },
                    { type: "image", tool: "i2i", label: "↻ 图生图" },
                    { type: "video", tool: "t2v", label: "▶ 文生视频" },
                    { type: "video", tool: "i2v", label: "⤢ 图生视频" },
                  ] as { type: ArtworkType; tool: ToolKey; label: string }[]
                ).map((t) => (
                  <button
                    key={t.tool}
                    type="button"
                    onClick={() => {
                      setCurType(t.type);
                      setTool(t.tool);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* result grid */}
          {hasResults && runMeta && (
            <div className="ws-grid" id="grid" style={{ display: "grid" }}>
              <div
                className="ws-result-head"
                id="resultHead"
                data-state={allDone ? "done" : "gen"}
              >
                <div className="ws-rh-main">
                  <div className="ws-rh-title">
                    <span className="ws-rh-spin" />
                    <span id="rhStatus">
                      {allDone
                        ? runMeta.prompt.slice(0, 40) +
                          (runMeta.prompt.length > 40 ? "…" : "")
                        : doneCount > 0
                          ? `正在生成 ${doneCount}/${cells.length}…`
                          : `正在生成 ${runMeta.count} 张…`}
                    </span>
                  </div>
                  <div className="ws-rh-meta">
                    <span className="ws-rh-chip">
                      <i className="dot" />
                      {runMeta.label}
                    </span>
                    <span className="ws-rh-chip">{runMeta.model}</span>
                    <span className="ws-rh-chip">{runMeta.ratio}</span>
                    <span className="ws-rh-chip">×{runMeta.count}</span>
                  </div>
                  <div className="ws-rh-prog">
                    <i id="rhBar" style={{ width: `${aggProg}%` }} />
                  </div>
                </div>
                <div className="ws-rh-acts" id="rhActs">
                  {allDone ? (
                    <>
                      <button
                        type="button"
                        id="rhRegen"
                        onClick={() => {
                          if (!busy) generate();
                        }}
                      >
                        ↻ 重新生成
                      </button>
                      <button
                        type="button"
                        id="rhDl"
                        onClick={() => toast.success("已下载全部 · 原型")}
                      >
                        ⤓ 下载全部
                      </button>
                    </>
                  ) : (
                    <button type="button" id="rhCancel" onClick={cancelRun}>
                      ✕ 取消
                    </button>
                  )}
                </div>
              </div>

              {cells.map((cell) => {
                const [rw, rh] = runMeta.ratio.split(":").map(Number);
                const done = !!doneSet[cell.i];
                const pct = Math.round(progs[cell.i] ?? 0);
                return (
                  <div
                    key={cell.i}
                    className={`gen-cell${done ? " done" : ""}`}
                    data-i={cell.i}
                    style={{ aspectRatio: `${rw}/${rh}` }}
                    onClick={() => openCell(cell)}
                  >
                    <div
                      className="done-cov"
                      style={{ background: mesh(cell.hues[0], cell.hues[1], cell.hues[2]) }}
                    />
                    <div className="shimmer" />
                    <div className="ph">
                      生成中 · <span className="pct">{pct}%</span>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${progs[cell.i] ?? 0}%` }} />
                    </div>
                    <span className="reveal-tag">✦ 刚刚生成</span>
                    <div
                      className="gen-acts"
                      onClick={(e) => {
                        e.stopPropagation();
                        const btn = (e.target as HTMLElement).closest("button");
                        if (btn) cellAction(btn.dataset.act || "", cell);
                      }}
                    >
                      <button type="button" data-act="edit">
                        ✎ 编辑
                      </button>
                      <button type="button" data-act="regen">
                        ↻ 重新生成
                      </button>
                      <button type="button" data-act="del">
                        🗑 删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* generation-history strip */}
        <div className="ws-histbar">
          <div className="ws-histbar-head">
            <span>
              生成历史{" "}
              <span className="ws-ahead-n" id="histN">
                {hist.length}
              </span>
            </span>
            <div className="ws-histfilter" id="histFilter">
              {(
                [
                  { f: "all", label: "全部" },
                  { f: "image", label: "图片" },
                  { f: "video", label: "视频" },
                ] as { f: "all" | "image" | "video"; label: string }[]
              ).map((b) => (
                <button
                  key={b.f}
                  type="button"
                  className={histFilter === b.f ? "on" : undefined}
                  onClick={() => setHistFilter(b.f)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ws-histstrip" id="histStrip">
            {filteredHist.length === 0 ? (
              <div className="ws-hempty">还没有生成记录 · 写句提示词试试 ✦</div>
            ) : (
              filteredHist.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="ws-hcard"
                  data-htype={h.type}
                  onClick={() => openHist(h)}
                >
                  <span className="cov" style={{ background: coverBg(h.hues) }} />
                  {h.type === "video" && <span className="vbadge">▶</span>}
                </button>
              ))
            )}
          </div>
        </div>
      </main>
      </div>

      <WorkModal work={active} onClose={() => setActive(null)} />
    </>
  );
}
