"use client";

/* ============================================================================
   3D 模型工作台 · ThreeDStudio — /three-d 页面的客户端组合根。

   3D 生成从创作台独立成页（2026-08 用户决策）：创作台的信息流只能给 3D 结果
   一张封面图，核心体验（转模型、看线框、查面数）全被砍掉。本页左栏沿用创作台
   的参数面板件（ModelPicker / UploadSlots / PromptSection / ThreeDOptions），
   右侧换成交互式 three.js viewport（./three-d-studio/viewport）+ 历史条带。

   生成引擎整套复用 create-studio/use-generation（建任务/轮询/刷新续跑/幂等
   恢复），本页以 curType 恒为 "3d" 的姿态喂参；音频/图片专属参数以惰性默认值
   传入，不触发对应分支。历史用 mediaType=3d 服务端过滤，只拉本页的产物。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiApi } from "@/lib/api";
import { pointsApi } from "@/lib/points-api";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { markRequiredField } from "@/lib/require-field";
import {
  buildMentionRefs,
  extractMentionTokens,
  type MentionEditorHandle,
  type MentionKind,
} from "@/components/studio/mention-prompt-editor";
import styles from "@/app/(studio)/three-d/three-d.module.css";
import { MODES_BY_TYPE, TOOLS, UPLOADS } from "./create-studio/constants";
import { SLOT_ICON } from "./create-studio/icons";
import type { ArtworkType, HistItem, ToolKey, SlotData } from "./create-studio/types";
import { histItemsFromTasks, slotTypeOf } from "./create-studio/utils";
import { useStudioModels } from "./create-studio/use-studio-models";
import { useHistory } from "./create-studio/use-history";
import { useUploadSlots } from "./create-studio/use-upload-slots";
import { useGeneration } from "./create-studio/use-generation";
import { ModelPicker } from "./create-studio/model-picker";
import { UploadSlots } from "./create-studio/upload-slots";
import { PromptSection } from "./create-studio/prompt-section";
import { ThreeDOptions } from "./create-studio/three-d-options";
import { PreviewModal } from "./create-studio/preview-modal";
import { SrcMenu } from "./create-studio/src-menu";
import { AssetPickerModal } from "./create-studio/asset-picker-modal";
import { ThreeDViewport, type MeshStats } from "./three-d-studio/viewport";

const CUR_TYPE: ArtworkType = "3d";
const HIST_PAGE_SIZE = 30;
/** useHistory 的原曲候选参数（音频专属）：稳定空引用，避免每渲染新数组触发重算。 */
const NO_CLIPS: never[] = [];

/** 可进 viewport 的 GLB 地址（其余格式仅下载）。 */
function glbUrlOf(h: HistItem | null): string | null {
  if (!h) return null;
  const asset = h.assets?.find((a) => a.type === "glb")?.url;
  if (asset) return asset;
  return h.url && /\.glb([?#]|$)/i.test(h.url) ? h.url : null;
}

export default function ThreeDStudio() {
  /* ── panel state ───────────────────────────────────────────────────────── */
  const [tool, setTool] = useState<ToolKey>("t2_3d");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enablePbr, setEnablePbr] = useState(false);
  const [faceCount, setFaceCount] = useState(500_000);
  const [generateType, setGenerateType] = useState<"Normal" | "Geometry">("Normal");
  const [resultFormat, setResultFormat] = useState<"" | "STL" | "USDZ" | "FBX">("");
  const [slotData, setSlotData] = useState<SlotData>({});
  const [preview, setPreview] = useState<{ k: string; i: number } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optCost, setOptCost] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);
  const promptRef = useRef<MentionEditorHandle>(null);
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const slots = UPLOADS[tool] ?? null;

  /* ── hooks（创作台同款，curType 恒 3d）──────────────────────────────────── */
  const { studioList, deepModelRef } = useStudioModels({ curType: CUR_TYPE, setModel });
  const currentStudioList = useMemo(
    () => studioList.filter((m) => m.type === CUR_TYPE),
    [studioList],
  );
  const selModel = useMemo(
    () => currentStudioList.find((m) => m.name === model) ?? null,
    [currentStudioList, model],
  );
  const mCfg = selModel?.config ?? null;
  const modelNames = useMemo(() => currentStudioList.map((m) => m.name), [currentStudioList]);

  const { hist, setHist, pushHistory } = useHistory(NO_CLIPS);

  const {
    srcMenu,
    setSrcMenu,
    srcMenuPos,
    assetPick,
    setAssetPick,
    fileInputRef,
    addFile,
    pickLocal,
    onLocalFiles,
    openAssets,
    chooseAsset,
    removeFile,
    swapFlf,
  } = useUploadSlots({ slots, tool, mCfg, slotData, setSlotData, ensureSession });

  const refreshBalance = useCallback(async () => {
    try {
      const res = await pointsApi.balance();
      if (res.success && res.data) setBalance(res.data.points);
    } catch {
      /* 余额展示非关键路径 */
    }
  }, []);

  /* @ 引用候选（i2_3d 单图 / mv2_3d 多视图的素材编号） */
  const mentionRefs = useMemo(() => {
    if (!slots) return [];
    const items: { key: string; kind: MentionKind; thumb?: string }[] = [];
    for (const s of slots) {
      (slotData[s.k] ?? []).forEach((f, i) => {
        items.push({
          key: `${s.k}-${i}-${f.url ?? f.g ?? f.n}`,
          kind: s.type,
          thumb: s.type === "image" ? (f.g || f.url) : f.url,
        });
      });
    }
    return buildMentionRefs(items);
  }, [slots, slotData]);

  /* ── 生成引擎（音频/图片专属参数给惰性默认值，不触发对应分支）──────────── */
  const { inflightRuns, generate } = useGeneration({
    prompt,
    count: 1,
    tool,
    curType: CUR_TYPE,
    ratio: "",
    model,
    res: "",
    dur: "",
    imgRes: "",
    quality: "",
    musicMode: "inspire",
    sourceClipId: "",
    sourceIsUpload: false,
    continueAt: "",
    lyrics: "",
    songStyle: "",
    songTitle: "",
    instrumental: false,
    enablePbr,
    faceCount,
    generateType,
    resultFormat,
    slotData,
    studioList: currentStudioList,
    ratioOpts: [],
    resOpts: [],
    durOpts: [],
    qualOpts: [],
    skill: null,
    isAudio: false,
    is3D: true,
    isSfx: false,
    ensureSession,
    refreshBalance,
    pushHistory,
    setHist,
    promptRef,
  });

  /* ── 3D 历史（服务端 mediaType 过滤；引擎恢复的他类任务不入本页条带）────── */
  const hist3d = useMemo(() => hist.filter((h) => h.type === "3d"), [hist]);
  const inflight3d = useMemo(
    () => inflightRuns.filter((r) => r.meta.kind === "3d"),
    [inflightRuns],
  );

  const histPageRef = useRef(1);
  const histLoadingRef = useRef(false);
  const histLoadedCountRef = useRef(0);
  const [histHasMore, setHistHasMore] = useState(false);
  // 首页历史已返回（成败均置位）：深链 ?task= 的落位要等它，否则必然查不到
  const [histReady, setHistReady] = useState(false);
  const fetchHistory = useCallback(
    async (page: number, append: boolean) => {
      if (histLoadingRef.current) return;
      histLoadingRef.current = true;
      try {
        await ensureSession();
        const res = await aiApi.listTasks({
          pageNum: page,
          pageSize: HIST_PAGE_SIZE,
          noProject: true,
          mediaType: "3d",
        });
        const records = res.success && res.data ? res.data.records : [];
        const total = res.success && res.data ? res.data.total : 0;
        const items = histItemsFromTasks(records);
        histPageRef.current = page;
        histLoadedCountRef.current = append
          ? histLoadedCountRef.current + records.length
          : records.length;
        setHistHasMore(histLoadedCountRef.current < total);
        if (append) {
          setHist((prev) => {
            const seen = new Set(prev.map((h) => h.id));
            return [...prev, ...items.filter((h) => !seen.has(h.id))];
          });
        } else {
          setHist(items);
        }
      } catch {
        if (!append) setHist([]);
      } finally {
        histLoadingRef.current = false;
        if (!append) setHistReady(true);
      }
    },
    [ensureSession, setHist],
  );
  useEffect(() => {
    const t = setTimeout(() => void fetchHistory(1, false), 0);
    return () => clearTimeout(t);
  }, [fetchHistory]);

  /* 挂载拉真实余额与「AI 优化」单次扣费 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSession();
      if (cancelled) return;
      refreshBalance();
      const r = await aiApi.optimizeCost();
      if (!cancelled && r.success && r.data) setOptCost(r.data.cost);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession, refreshBalance]);

  /* 深链：/three-d?tool=i2_3d&model=<名称>&task=<任务ID>
     （创作台旧 3D 深链由 /studio 转发；task 来自资产页「在 3D 工作台查看」） */
  const pendingTaskRef = useRef<string | null>(null);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const tl = sp.get("tool");
      const m = sp.get("model");
      const tk = sp.get("task");
      if (tl && (MODES_BY_TYPE["3d"] as string[]).includes(tl)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后一次性读 URL 落位
        setTool(tl as ToolKey);
      }
      if (m) deepModelRef.current = m;
      if (tk) pendingTaskRef.current = tk;
    } catch {
      /* URL API unavailable */
    }
  }, [deepModelRef]);

  /* ── viewport 选中：null = 跟随最新；点条带 = 显式锁定 ─────────────────── */
  const [selId, setSelId] = useState<string | null>(null);
  const current = useMemo(
    () => (selId ? hist3d.find((h) => h.id === selId) ?? hist3d[0] : hist3d[0]) ?? null,
    [hist3d, selId],
  );
  /* 深链 ?task= 落位：首页历史返回后，条带里有就直接选中；不在首页（老记录）
     则单取该任务并入历史再选中。找不到/无 3D 结果时提示后保持默认展示。 */
  useEffect(() => {
    const target = pendingTaskRef.current;
    if (!histReady || !target) return;
    pendingTaskRef.current = null;
    const run = `task-${target}`;
    const found = hist3d.find((h) => h.run === run);
    if (found) {
      setSelId(found.id);
      return;
    }
    (async () => {
      try {
        const res = await aiApi.getTask(target);
        if (!res.success || !res.data) throw new Error(res.message);
        const items = histItemsFromTasks([res.data]).filter((h) => h.type === "3d");
        if (!items.length) {
          toast.info("该记录暂无可展示的 3D 结果");
          return;
        }
        // 追加到条带尾部（老记录本就该在后面），已存在同 run 时不重复
        setHist((prev) => (prev.some((h) => h.run === run) ? prev : [...prev, ...items]));
        setSelId(items[0].id);
      } catch {
        toast.error("未找到该 3D 生成记录");
      }
    })();
  }, [histReady, hist3d, setHist]);

  // 生成完成（pushHistory 以 h- 前缀 id 置顶）→ viewport 跳到最新结果；
  // 服务端重拉/翻页的 task- id 不抢用户在条带上的锁定。
  const topIdRef = useRef<string | null>(null);
  useEffect(() => {
    const top = hist3d[0]?.id ?? null;
    const prev = topIdRef.current;
    topIdRef.current = top;
    if (prev !== null && top !== null && top !== prev && top.startsWith("h-")) {
      setSelId(null);
    }
  }, [hist3d]);
  const glbUrl = glbUrlOf(current);
  const [stats, setStats] = useState<MeshStats | null>(null);

  /* ── handlers ──────────────────────────────────────────────────────────── */
  const selectModel = useCallback(
    (next: string) => {
      if (next && next !== model) setModel(next);
    },
    [model],
  );

  const selectTool = (t: ToolKey) => {
    setTool(t);
    setSlotData({});
  };

  const aiOptimize = async () => {
    const v = prompt.trim();
    if (!v) {
      toast.info("先写一句提示词再优化 ✦");
      markRequiredField(".ws-promptbox");
      promptRef.current?.focus();
      return;
    }
    if (optimizing) return;
    setOptimizing(true);
    try {
      await ensureSession();
      const res = await aiApi.optimizePrompt(v);
      if (res.success && res.data?.prompt) {
        setPrompt(res.data.prompt);
        refreshBalance();
        const before = extractMentionTokens(v);
        const after = extractMentionTokens(res.data.prompt);
        const hadMention = mentionRefs.some((r) => before.has(r.label));
        const keptMention = mentionRefs.some((r) => after.has(r.label));
        if (hadMention && !keptMention) {
          toast.info("优化后素材引用（图片N）被改写，请重新 @ 引用");
        } else {
          toast.success("✦ 已用 AI 优化提示词");
        }
      } else {
        toast.error(res.message || "AI 优化失败");
      }
    } catch {
      toast.error("AI 优化失败，请稍后重试");
    } finally {
      setOptimizing(false);
    }
  };

  const cost = mCfg?.creditCost ?? (parseFloat(selModel?.pointCost ?? "") || 0);
  const generating = inflight3d.length > 0;
  const genProgress = generating
    ? Math.round(
        inflight3d.reduce((sum, r) => sum + (r.progs[0] ?? 0), 0) / inflight3d.length,
      )
    : 0;

  /* ── render ────────────────────────────────────────────────────────────── */
  return (
    <>
      <div className={styles.cols}>
        {/* ── 左栏参数面板（创作台同款件）───────────────────────────────── */}
        <aside className="ws-panel">
          <div className="ws-panel-scroll">
            <div className="ws-phead">
              <span className="spark">✦</span> 3D 模型
            </div>

            {/* 模式页签：文生 3D / 图生 3D / 多视图 */}
            <div className="seg" id="mode-tabs">
              {MODES_BY_TYPE["3d"].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={tool === k ? "on" : undefined}
                  onClick={() => selectTool(k)}
                >
                  {TOOLS[k].label}
                </button>
              ))}
            </div>

            <ModelPicker
              model={model}
              names={modelNames}
              studioList={currentStudioList}
              onSelect={selectModel}
            />

            <UploadSlots
              tool={tool}
              slots={slots}
              ratio="1:1"
              slotData={slotData}
              mCfg={mCfg}
              onAdd={addFile}
              onRemove={removeFile}
              onSwapFlf={swapFlf}
              onPreview={setPreview}
            />

            {/* 图生 3D 模式不同时使用提示词（上游语义），整块隐藏 */}
            {tool !== "i2_3d" && (
              <PromptSection
                prompt={prompt}
                onPromptChange={setPrompt}
                promptRef={promptRef}
                mentionRefs={mentionRefs}
                placeholder={mCfg?.defaultPrompt || TOOLS[tool].ph}
                skill={null}
                onRemoveSkill={() => {}}
                optimizing={optimizing}
                optCost={optCost}
                onOptimize={aiOptimize}
                onOpenSkillPicker={() => {}}
                ideaOpts={mCfg?.ideas ?? []}
                allowSkills={false}
                label={tool === "mv2_3d" ? "提示词（可选）" : "提示词"}
              />
            )}

            <ThreeDOptions
              enablePbr={enablePbr}
              onEnablePbrChange={setEnablePbr}
              faceCount={faceCount}
              onFaceCountChange={setFaceCount}
              generateType={generateType}
              onGenerateTypeChange={setGenerateType}
              resultFormat={resultFormat}
              onResultFormatChange={setResultFormat}
            />
          </div>

          <div className="ws-panel-foot">
            {/* 与创作台同口径：不锁按钮——每次点击是独立幂等请求，并发上限由后端管 */}
            <button className="ws-gen" id="gen" type="button" onClick={() => generate()}>
              <span className="spark">✦</span> 立即生成{" "}
              <span className="ws-gen-cost">
                ·&nbsp;<b id="cost">{cost}</b>&nbsp;积分
              </span>
            </button>
            <div className="ws-balance">
              {balance !== null ? `余额 ${balance.toLocaleString()} 积分` : "余额 —"}
            </div>
          </div>
        </aside>

        {/* ── 右侧 viewport + 历史条带 ──────────────────────────────────── */}
        <main className="t3d-stage">
          {/* 左上角网格统计（viewport 实测，加载后出现） */}
          {stats && (
            <div className="t3d-stats">
              <span>拓扑</span>
              <b>三角面</b>
              <span>模型面数</span>
              <b>{stats.tris.toLocaleString()}</b>
              <span>顶点数</span>
              <b>{stats.verts.toLocaleString()}</b>
            </div>
          )}

          <ThreeDViewport glbUrl={generating ? null : glbUrl} onStats={setStats} />

          {/* 生成中：viewport 上的进度覆盖层 */}
          {generating && (
            <div className="t3d-overlay">
              <span className="t3d-spin" aria-hidden />
              <b>生成中 · {genProgress}%</b>
              <span className="t3d-overlay-sub">
                {inflight3d[0]?.meta.prompt
                  ? inflight3d[0].meta.prompt.slice(0, 40)
                  : inflight3d[0]?.meta.label}
              </span>
              <div className="t3d-progress">
                <i style={{ width: `${genProgress}%` }} />
              </div>
            </div>
          )}

          {/* 空态：无历史且不在生成 */}
          {!generating && !current && (
            <div className="t3d-overlay">
              <span className="t3d-cube" aria-hidden>
                {SLOT_ICON["3d"]}
              </span>
              <b>还没有 3D 作品</b>
              <span className="t3d-overlay-sub">
                在左侧描述你想要的 3D 资产，生成后在这里旋转查看
              </span>
            </div>
          )}

          {/* 有结果但无可预览 GLB：给下载指引 */}
          {!generating && current && !glbUrl && (
            <div className="t3d-overlay">
              <span className="t3d-cube" aria-hidden>
                {SLOT_ICON["3d"]}
              </span>
              <b>该结果没有可预览的 GLB 文件</b>
              <span className="t3d-overlay-sub">可在下方直接下载源文件</span>
            </div>
          )}

          {/* 底部：当前作品信息 + 各格式下载 */}
          {!generating && current && (
            <div className="t3d-foot">
              <div className="t3d-foot-info">
                <strong>{current.title || "3D 模型"}</strong>
                <span>{current.model}</span>
              </div>
              <div className="ws-3d-asset-links">
                {(current.assets?.length
                  ? current.assets
                  : current.url
                    ? [{ type: "model", url: current.url }]
                    : []
                ).map((a) => (
                  <a key={a.url} href={a.url} target="_blank" rel="noreferrer">
                    ↓ {a.type.toUpperCase()}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 历史条带（本页 + 历史的 3D 产物；点选切换 viewport） */}
          {(hist3d.length > 0 || histHasMore) && (
            <div className="t3d-strip" role="listbox" aria-label="生成历史">
              {hist3d.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={current?.id === h.id}
                  className={`t3d-thumb${current?.id === h.id ? " on" : ""}`}
                  title={h.title}
                  onClick={() => setSelId(h.id)}
                >
                  {h.previewImageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 外链缩略图 */
                    <img src={h.previewImageUrl} alt={h.title} loading="lazy" />
                  ) : (
                    <span aria-hidden>{SLOT_ICON["3d"]}</span>
                  )}
                </button>
              ))}
              {histHasMore && (
                <button
                  type="button"
                  className="t3d-thumb t3d-more"
                  onClick={() => void fetchHistory(histPageRef.current + 1, true)}
                >
                  更多
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      <PreviewModal
        preview={preview}
        slotData={slotData}
        slots={slots}
        onClose={() => setPreview(null)}
      />

      {/* 隐藏 input：参考图本地上传 */}
      <input ref={fileInputRef} type="file" multiple hidden onChange={onLocalFiles} />

      {/* 参考素材来源选择：本地上传 / 资产库 */}
      {srcMenu && (
        <SrcMenu
          slotKey={srcMenu}
          pos={srcMenuPos}
          kind={slotTypeOf(slots, srcMenu)}
          onClose={() => setSrcMenu(null)}
          onPickLocal={pickLocal}
          onOpenAssets={openAssets}
        />
      )}

      {assetPick && (
        <AssetPickerModal
          kind={slotTypeOf(slots, assetPick)}
          onPick={chooseAsset}
          onClose={() => setAssetPick(null)}
        />
      )}
    </>
  );
}
