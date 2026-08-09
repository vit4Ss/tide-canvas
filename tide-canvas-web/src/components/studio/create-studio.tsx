"use client";

/* ============================================================================
   创作台 · CreateStudio — React port of design-ref/创作台.html
   (<aside class="ws-panel"> control panel + <main class="ws-stage"> center
   stage) and design-ref/liuguang/create.js.

   Renders ONLY the panel + stage (the (studio) layout owns the ws-rail and
   imports flux/pages/studio.css). Exact liuguang class names are used so the
   already-imported CSS applies unchanged.

   Faithful to the design: type-switched fields (图片 ↔ 视频), 分辨率/清晰度/时长
   pills, typed reference-upload slots (参考图 / 原图 / 首尾帧 / 参考视频·音频) with
   a preview modal and resolution-based cost.

   Results render as a vertical FEED of generation runs (ws-feed): newest run on
   top, each block = header (prompt + model · time + 重新生成/下载/删除) and a row of
   its images shown at their TRUE aspect ratio (no crop). The in-flight run shows
   progress placeholders, then joins the feed below — which also serves as the
   history (the old cropped grid + separate 生成历史 strip were merged into this).

   Handoff: reads sessionStorage 'flux_prompt' / 'flux_model' on mount to
   prefill the prompt / model (mirrors create.js + work-modal.tsx).

   结构（2026-07 拆分，纯结构重构、行为不变）：本文件只做组合——面板/舞台 state、
   派生选项与各区块的装配。子组件与 hook 位于 ./create-studio/：
   constants/types/utils（常量·类型·纯函数）、icons、use-ambient + ambient-frame
   （环境光泛光）、use-studio-models（模型列表）、use-history（生成历史）、
   use-source-clip（音频原曲）、use-upload-slots（参考素材槽位）、use-generation
   （生成引擎：建任务/轮询/刷新续跑/一键编辑）、model-picker / upload-slots /
   prompt-section / music-source-fields / song-fields / option-fields / type-tabs /
   stage-feed / preview-modal / lightbox / src-menu / asset-picker-modal。
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { aiApi } from "@/lib/api";
import { marketApi } from "@/lib/market-api";
import { pointsApi } from "@/lib/points-api";
import { SkillPicker } from "@/components/skill/skill-picker";
import { parseSkillParams, skillApi } from "@/lib/skill-api";
import { promptAfterSkillPick } from "@/lib/skill-prompt";
import {
  skillKindOf,
  skillSupportsEntryPoint,
  skillSupportsOutput,
  type SkillVO,
} from "@/types/skill";
import {
  buildMentionRefs,
  extractMentionTokens,
  type MentionEditorHandle,
  type MentionKind,
} from "@/components/studio/mention-prompt-editor";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { markRequiredField } from "@/lib/require-field";
import styles from "@/app/(studio)/studio/create.module.css";
import {
  activeRunStorageKey,
  CREATE_MODELS,
  DUR_SEC,
  IDEAS,
  IMG_RES,
  IMG_RES_COST,
  MODES_BY_TYPE,
  MODE_TO_TOOL,
  RATIOS,
  RES_COST,
  TOOLS,
  THREE_D_VIEW_SLOTS,
  UPLOADS,
  VIDEO_DUR,
  VIDEO_RES,
} from "./create-studio/constants";
import { CELL_TOOLS } from "./create-studio/icons";
import type {
  ArtworkType,
  HistRun,
  MusicMode,
  ResultCell,
  RunParams,
  SlotData,
  ToolKey,
  UploadFile,
} from "./create-studio/types";
import { audioToolOf, histItemsFromTasks, huesFromId, resolutionRank, slotTypeOf } from "./create-studio/utils";
import { useStudioModels } from "./create-studio/use-studio-models";
import { useSourceClip } from "./create-studio/use-source-clip";
import { useHistory } from "./create-studio/use-history";
import { useUploadSlots } from "./create-studio/use-upload-slots";
import { useGeneration } from "./create-studio/use-generation";
import { TypeTabs } from "./create-studio/type-tabs";
import { ModelPicker } from "./create-studio/model-picker";
import { UploadSlots } from "./create-studio/upload-slots";
import { MusicSourceFields } from "./create-studio/music-source-fields";
import { PromptSection } from "./create-studio/prompt-section";
import { SongFields, VocalField } from "./create-studio/song-fields";
import { OptionFields } from "./create-studio/option-fields";
import { ThreeDOptions } from "./create-studio/three-d-options";
import { StageFeed } from "./create-studio/stage-feed";
import { PreviewModal } from "./create-studio/preview-modal";
import { Lightbox } from "./create-studio/lightbox";
import { SrcMenu } from "./create-studio/src-menu";
import { AssetPickerModal } from "./create-studio/asset-picker-modal";

function withHistoryRestoreTimeout<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("history restore timeout")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function CreateStudio() {
  const router = useRouter();
  /* panel state */
  const [curType, setCurType] = useState<ArtworkType>("image");
  const [tool, setTool] = useState<ToolKey>("t2i");
  const [model, setModel] = useState<string>("GPT Image 2");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>(RATIOS[0]);
  const [count, setCount] = useState(1);
  const [imgRes, setImgRes] = useState<string>("2K");
  const [res, setRes] = useState<string>("1080p");
  const [dur, setDur] = useState<string>("5s");
  const [quality, setQuality] = useState<string>("");
  const [enablePbr, setEnablePbr] = useState(false);
  const [faceCount, setFaceCount] = useState(500_000);
  const [generateType, setGenerateType] = useState<"Normal" | "Geometry">("Normal");
  const [resultFormat, setResultFormat] = useState<"" | "STL" | "USDZ" | "FBX">("");
  /* 音频（Suno）音乐创作模式：灵感 = 只填描述，Suno 自动写词；自定义歌词 =
     歌词必填 + 风格/歌名，描述不发送；延长/翻唱 = 引用先前生成的 clip_id。
     各模式字段互斥展示（对齐上游 API 语义）。 */
  const [musicMode, setMusicMode] = useState<MusicMode>("inspire");
  /* 技能：以内联 chip 附着到提示词框；执行模板由服务端按 skillId 解析。 */
  const [skill, setSkill] = useState<SkillVO | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const skillRestoreSeqRef = useRef(0);
  const [lyrics, setLyrics] = useState("");
  const [songStyle, setSongStyle] = useState("");
  /* songStyle 底层仍是逗号串（发送/历史恢复不变），芯片按成员关系点亮/切换。 */
  const songStyleList = songStyle.split(",").map((s) => s.trim()).filter(Boolean);
  const toggleSongStyle = (v: string) =>
    setSongStyle(
      (songStyleList.includes(v)
        ? songStyleList.filter((x) => x !== v)
        : [...songStyleList, v]
      ).join(", "),
    );
  const [songTitle, setSongTitle] = useState("");
  const [instrumental, setInstrumental] = useState(false);

  /* typed reference uploads (per slot key) + preview modal target */
  const [slotData, setSlotData] = useState<SlotData>({});
  const [preview, setPreview] = useState<{ k: string; i: number } | null>(null);

  const [optimizing, setOptimizing] = useState(false);
  // 「AI 优化」单次扣费（后端实算，含团队倍率）；0 = 免费/未配置，不显示角标
  const [optCost, setOptCost] = useState(0);
  const ensureSession = useAuthStore((s) => s.ensureSession);

  // 真实积分余额（替代原硬编码假数据）。生成结算后刷新——扣减/退款在后端完成。
  const [balance, setBalance] = useState<number | null>(null);
  const refreshBalance = useCallback(async () => {
    try {
      const res = await pointsApi.balance();
      if (res.success && res.data) setBalance(res.data.points);
    } catch {
      /* 忽略：余额展示非关键路径 */
    }
  }, []);
  // full settings of the last started run (for 重新编辑 / 再次生成) + a one-shot
  // flag that fires generate() after those settings are restored to the panel.
  const [pendingGen, setPendingGen] = useState(false);
  const [restoringRun, setRestoringRun] = useState(false);
  const historyActionLockRef = useRef(false);
  const pendingGenTargetRef = useRef<{
    curType: ArtworkType;
    model: string;
    modelId: string;
    skillId?: string;
  } | null>(null);
  // ensures the stage is seeded with the last past result at most once per mount.
  const stageSeededRef = useRef(false);

  /* full-image lightbox (click a finished result to zoom) */
  const [lightbox, setLightbox] = useState<string | null>(null);
  const promptRef = useRef<MentionEditorHandle>(null);

  /* ── derived (pre-hook basics) ─────────────────────────────────────────── */

  const cfg = TOOLS[tool];
  const isVideo = curType === "video";
  const isAudio = curType === "audio";
  const is3D = curType === "3d";
  const slots = UPLOADS[tool] ?? null;

  /* ── hooks ─────────────────────────────────────────────────────────────── */

  const { studioList, loadedType, adoptModels, deepModelRef } = useStudioModels({ curType, setModel });

  const currentStudioList = useMemo(
    () => studioList.filter((candidate) => candidate.type === curType),
    [studioList, curType],
  );
  const selModel = useMemo(
    () => currentStudioList.find((m) => m.name === model) ?? null,
    [currentStudioList, model],
  );
  const mCfg = selModel?.config ?? null;
  // Suno 音效卡与音乐卡用法不同（不吃歌词/风格/歌名，只按描述出短音效）。
  // 页签拆分后以工具为准，modelKey 里的 sfx 作兜底（未配置 modes 的旧数据）。
  const isSfx = isAudio && (tool === "sfx" || /sfx/i.test(selModel?.modelKey ?? ""));

  const clip = useSourceClip({ selModel });
  // 渲染期直接读 hook 返回对象的成员会被 react-hooks/refs 按「渲染期访问 ref」
  // 误报（拆分前这些都是 useRef/useState 的局部量）；JSX 直接用到的先解构出来。
  const { clipFileRef, onClipFilePicked } = clip;
  const { hist, setHist, pushHistory, clipOptions } = useHistory(clip.extraClips);

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

  /* @ 引用候选：按提交顺序给槽位素材编号（图片N/视频N/音频N）。顺序必须与
     generate() 组装 imageList / firstFrame·lastFrame / videoReferences /
     audioReferences 的顺序一致——token 的 N 就是对齐到第 N 个素材。
     （flf 的 slots 序 = [first, last] → 图片1=首帧、图片2=尾帧。） */
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

  /* ── studio models → picker names + selected model's config ────────────── */
  const noBackend = currentStudioList.length === 0;
  const modelNames = useMemo(() => {
    if (!currentStudioList.length) return is3D ? [] : CREATE_MODELS;
    // 音频两页签各自持有模型池，下拉只显示本池；池空时回退全量（防呆）。
    const pool =
      curType === "audio"
        ? currentStudioList.filter((m) => audioToolOf(m) === (tool === "sfx" ? "sfx" : "t2a"))
        : currentStudioList;
    return (pool.length ? pool : currentStudioList).map((m) => m.name);
  }, [currentStudioList, curType, tool, is3D]);

  // dynamic option lists: a model's configured options only; when the backend
  // returned no models at all, fall back to the built-in defaults so the panel
  // is never empty. An empty configured list hides that control entirely.
  const ratioOpts = mCfg?.ratios?.length ? mCfg.ratios : noBackend ? [...RATIOS] : [];
  // 展示按数值升序（上游同步的配置顺序常是 720p/480p/1080p 这种乱序）；
  // 默认选中仍取配置首项（模型收敛 effect 读 mCfg.resolutions[0]，与时长同口径）。
  const resOpts = (mCfg?.resolutions?.length
    ? [...mCfg.resolutions]
    : noBackend
      ? isVideo
        ? [...VIDEO_RES]
        : [...IMG_RES]
      : []
  ).sort((a, b) => resolutionRank(a) - resolutionRank(b));
  const durOpts = (mCfg?.durations?.length ? [...mCfg.durations] : noBackend ? [...VIDEO_DUR] : []).sort(
    (a, b) => parseFloat(a) - parseFloat(b),
  );
  const qualOpts = mCfg?.qualities ?? [];
  const ideaOpts = mCfg?.ideas?.length ? mCfg.ideas : noBackend && !is3D ? [...IDEAS] : [];
  const batchOpts =
    mCfg?.batchOptions && mCfg.batchOptions.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMin = Math.min(...batchOpts);
  const batchMax = Math.max(...batchOpts);

  // tool/mode tabs: when the model configures modes, show only those; otherwise
  // (or no backend) show all modes for the current type.
  const configuredTools = (mCfg?.modes ?? [])
    .map((m) => MODE_TO_TOOL[m])
    .filter(Boolean) as ToolKey[];
  // 音频例外：页签按"全目录里有没有模型"决定（音乐/音效是两族模型，不是同一
  // 模型的两种模式），否则选中音乐模型时音效页签会消失、永远点不过去。
  const modeKeys = is3D
    ? MODES_BY_TYPE["3d"]
    : isAudio
    ? noBackend
      ? MODES_BY_TYPE.audio
      : MODES_BY_TYPE.audio.filter((k) => currentStudioList.some((m) => audioToolOf(m) === k))
    : configuredTools.length
      ? MODES_BY_TYPE[curType].filter((k) => configuredTools.includes(k))
      : MODES_BY_TYPE[curType];

  // cost — honor the 后台模型配置 first, then fall back to the built-in map:
  //   1) priceMatrix（后台「积分定价」）: image = 画质 × 清晰度, video = 时长 × 清晰度
  //   2) 模型级固定积分 (config.creditCost, else the model's pointCost)
  //   3) built-in fallback map (case-insensitive: 后台用 1k/2k/4k, 预览用 1K/2K/4K)
  const cost = useMemo(() => {
    // 音频按次计费（Suno 两首一次结算），无画质/清晰度矩阵与数量倍乘。
    if (isAudio || is3D) {
      return mCfg?.creditCost ?? (parseFloat(selModel?.pointCost ?? "") || 0);
    }
    const pm = mCfg?.priceMatrix;
    const row = isVideo ? dur : quality;
    const col = isVideo ? res : imgRes;
    const cell = pm?.[row]?.[col];
    const per = cell != null ? parseFloat(cell) : NaN;
    if (Number.isFinite(per)) return isVideo ? Math.round(per) : Math.round(per) * count;

    const flat = mCfg?.creditCost ?? (parseFloat(selModel?.pointCost ?? "") || 0);
    if (flat > 0) return isVideo ? flat : flat * count;

    const fb = (m: Record<string, number>, k: string, d: number) =>
      m[k] ?? m[k.toUpperCase()] ?? m[k.toLowerCase()] ?? d;
    return isVideo
      ? Math.round((fb(RES_COST, res, 50) * (DUR_SEC[dur] || 5)) / 5)
      : fb(IMG_RES_COST, imgRes, 14) * count;
  }, [mCfg, selModel, isVideo, isAudio, is3D, dur, res, imgRes, quality, count]);

  const {
    busy,
    inflightRuns,
    setCells,
    setProgs,
    setRunMeta,
    generate,
    oneClickEdit,
    lastRunRef,
  } = useGeneration({
    prompt,
    count,
    tool,
    curType,
    ratio,
    model,
    res,
    dur,
    imgRes,
    quality,
    musicMode,
    sourceClipId: clip.sourceClipId,
    sourceIsUpload: clip.sourceIsUpload,
    continueAt: clip.continueAt,
    lyrics,
    songStyle,
    songTitle,
    instrumental,
    enablePbr,
    faceCount,
    generateType,
    resultFormat,
    slotData,
    studioList: currentStudioList,
    ratioOpts,
    resOpts,
    durOpts,
    qualOpts,
    skill,
    isAudio,
    is3D,
    isSfx,
    ensureSession,
    refreshBalance,
    pushHistory,
    setHist,
    promptRef,
  });

  // group the flat history into runs (one block per generation), newest first —
  // `hist` is already newest-first, so first-seen order is preserved.
  const runs = useMemo<HistRun[]>(() => {
    const byRun = new Map<string, HistRun>();
    const order: HistRun[] = [];
    for (const h of hist) {
      // 3D 归 /three-d 展示；引擎恢复的在飞 3D 任务完成后 pushHistory 仍会入
      // hist，这里在展示层滤掉，避免信息流冒出无法交互的 3D 卡。
      if (h.type === "3d") continue;
      let g = byRun.get(h.run);
      if (!g) {
        g = {
          run: h.run,
          ts: h.ts,
          ratio: h.ratio,
          title: h.title,
          prompt: h.prompt,
          model: h.model,
          type: h.type,
          params: h.params,
          items: [],
        };
        byRun.set(h.run, g);
        order.push(g);
      }
      g.items.push(h);
    }
    return order;
  }, [hist]);

  /* ── prompt / model handoff (mount) ──────────────────────────────────── */

  useEffect(() => {
    // accept a prompt / model handoff from "生成同款" (create.js + work-modal),
    // and an asset handoff from the 资产库 preview (作为垫图 / 生成视频 / 精细编辑).
    // Reading sessionStorage is an external-system read that can only run on the
    // client post-mount (avoids a hydration mismatch from a lazy initializer),
    // so setting state here is the intended pattern despite the lint heuristic.
    try {
      // asset handoff: load a picked image into the matching tool's slot.
      const rawAsset = sessionStorage.getItem("studio_use_asset");
      if (rawAsset) {
        sessionStorage.removeItem("studio_use_asset");
        try {
          const { url, op } = JSON.parse(rawAsset) as { url?: string; op?: string };
          const route: Record<string, [ArtworkType, ToolKey, string, string]> = {
            pad: ["image", "i2i", "img", "已作为垫图载入图生图 · 描述想要的改动"],
            video: ["video", "i2v", "first", "已载入图生视频首帧 · 描述运动"],
            edit: ["image", "edit", "img", "已载入改图 · 描述要精修的部分"],
          };
          const r = route[op || "pad"] || route.pad;
          if (url) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setCurType(r[0]);
            setTool(r[1]);
            setSlotData({ [r[2]]: [{ g: url, url, n: "垫图", s: "" }] });
            toast.success(r[3]);
          }
        } catch {
          /* malformed handoff */
        }
      }

      const p = sessionStorage.getItem("flux_prompt");
      const m = sessionStorage.getItem("flux_model");
      if (!p && !m) return;
      if (p) {
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

  // 深链：/studio?type=image|video|audio|3d&tool=<工具>&model=<名称>（首页跑马灯 /
  // 能力卡直达创作台）。类型立即切换（默认选对应的文生工具，tool 参数可指定
  // 如 i2i）；模型名先存 ref，等该类型的模型列表加载完成后再落位——直接
  // setModel 会被列表加载的兜底重置覆盖。
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("type");
      const tl = sp.get("tool");
      const m = sp.get("model");
      // 3D 已独立成页：旧深链 /studio?type=3d 原参转发到 /three-d，收藏/外链不断。
      if (t === "3d") {
        const q = new URLSearchParams();
        if (tl) q.set("tool", tl);
        if (m) q.set("model", m);
        const qs = q.toString();
        router.replace(qs ? `/three-d?${qs}` : "/three-d");
        return;
      }
      if (t === "image" || t === "video" || t === "audio") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCurType(t);
        const tools = MODES_BY_TYPE[t] ?? [];
        setTool(
          tl && (tools as string[]).includes(tl)
            ? (tl as ToolKey)
            : t === "video"
              ? "t2v"
            : t === "audio"
              ? "t2a"
              : "t2i",
        );
      }
      if (m) deepModelRef.current = m;
    } catch {
      /* URL API unavailable — ignore */
    }
  }, [deepModelRef, router]);

  // 生成历史: load the user's REAL generation tasks (persisted server-side). Each
  // SUCCESS task with a result URL becomes a card; a batch task (resultMeta.urls)
  // expands into one card per image. No mock seed — survives refresh.
  // noProject 排除画布项目里的生成，创作台历史只展示创作台/对话页自己的产物；
  // 延长/翻唱的原曲候选不受影响（ClipPicker 自拉取仍是全量,画布生成的歌可选）。
  //
  // 懒加载:首屏只拉一页(HIST_PAGE_SIZE),滚到底部哨兵再续页(见 stage-feed);
  // histLoadedCountRef 记录已取的「任务条数」(批量任务会展开多卡,不能拿 hist
  // 长度当分页依据)。sentinelCooldownRef 压住连发:一次触发后 700ms 内不再
  // 响应——否则加载完成哨兵立即可见会机枪式连翻,视觉上就是抽搐。
  const HIST_PAGE_SIZE = 20;
  const histPageRef = useRef(1);
  const histLoadedCountRef = useRef(0);
  const histLoadingRef = useRef(false);
  const sentinelCooldownRef = useRef(0);
  const [histHasMore, setHistHasMore] = useState(false);
  const [histLoadingMore, setHistLoadingMore] = useState(false);
  const [histInitialLoading, setHistInitialLoading] = useState(true);
  const [histLoadError, setHistLoadError] = useState(false);
  // 「翻过页」用 state 记:JSX 的到底提示判定不能读 ref(render 期禁止)。
  const [histMultiPage, setHistMultiPage] = useState(false);

  const fetchHistory = useCallback(async (page: number, append: boolean) => {
    if (histLoadingRef.current) return;
    histLoadingRef.current = true;
    try {
      await ensureSession();
      // setState 一律放在首个 await 之后(effect 同步路径不进 setState,过 lint)
      if (append) setHistLoadingMore(true);
      const res = await aiApi.listTasks({ pageNum: page, pageSize: HIST_PAGE_SIZE, noProject: true });
      const records = res.success && res.data ? res.data.records : [];
      const total = res.success && res.data ? res.data.total : 0;
      // 3D 产物归 /three-d 页展示（listTasks 无排除型过滤，客户端滤掉；
      // 分页按 records 数记账，不受此过滤影响）。
      const items = histItemsFromTasks(records).filter((h) => h.type !== "3d");
      histPageRef.current = page;
      histLoadedCountRef.current = append ? histLoadedCountRef.current + records.length : records.length;
      setHistHasMore(histLoadedCountRef.current < total);
      setHistLoadError(false);
      if (page > 1) setHistMultiPage(true);

      if (append) {
        // 续页去重:新生成经 pushHistory 先入了列表,翻页拉到旧页时 id 不会撞,
        // 这里防的是哨兵/手动触发的重复请求。
        setHist((prev) => {
          const seen = new Set(prev.map((h) => h.id));
          return [...prev, ...items.filter((h) => !seen.has(h.id))];
        });
        return;
      }
      setHist(items);

      // First load only: if the user has past results and nothing is currently
      // generating / being resumed, show their most recent image in the stage
      // instead of the empty default state. First-time users keep the default.
      if (!stageSeededRef.current) {
        stageSeededRef.current = true; // mark attempted, so a later 清空 stays empty
        let resuming = false;
        try {
          const ownerUserId = useAuthStore.getState().user?.id ?? "";
          resuming = !!ownerUserId && !!localStorage.getItem(activeRunStorageKey(ownerUserId));
        } catch {
          /* ignore */
        }
        const h = items[0];
        if (h && h.url && !resuming) {
          setRunMeta({
            prompt: h.params?.prompt ?? "",
            model: h.model,
            ratio: h.params?.ratio ?? "1:1",
            spec: "",
            count: 1,
            label: "",
            isVid: h.type === "video",
            kind: h.type,
            refThumbs: [],
            params: h.params,
          });
          setCells([{ i: 0, hues: h.hues, url: h.url }]);
          setProgs([100]);
          if (h.params) lastRunRef.current = h.params;
        }
      }
    } catch {
      if (!append) setHist([]);
      else setHistLoadError(true); // 续页失败:哨兵显示「点击重试」而不是静默
    } finally {
      histLoadingRef.current = false;
      setHistLoadingMore(false);
      setHistInitialLoading(false);
    }
  }, [ensureSession, setHist, setRunMeta, setCells, setProgs, lastRunRef]);

  const loadMoreHistory = useCallback(async () => {
    // 触发冷却:一次点火后 700ms 内忽略后续交点,消除连发的抽搐感
    const now = Date.now();
    if (now - sentinelCooldownRef.current < 700) return;
    sentinelCooldownRef.current = now;
    setHistLoadError(false);
    await fetchHistory(histPageRef.current + 1, true);
  }, [fetchHistory]);

  useEffect(() => {
    // setTimeout 0:首屏拉取推迟到挂载后(effect 同步路径不触发 setState,过 lint)
    const t = setTimeout(() => void fetchHistory(1, false), 0);
    return () => clearTimeout(t);
  }, [fetchHistory]);

  // when the selected model (its config) changes, snap each option control to a
  // value the model actually supports (so a stale ratio/res/quality can't linger).
  useEffect(() => {
    if (!mCfg) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 模型配置(异步外部数据)变化后收敛各选项到其支持的取值，与拆分前一致
    if (mCfg.ratios?.length) setRatio((r) => (mCfg.ratios!.includes(r) ? r : mCfg.ratios![0]));
    if (mCfg.resolutions?.length) {
      if (curType === "image") {
        setImgRes((v) => (mCfg.resolutions!.includes(v) ? v : mCfg.resolutions![0]));
      } else {
        setRes((v) => (mCfg.resolutions!.includes(v) ? v : mCfg.resolutions![0]));
      }
    }
    if (mCfg.durations?.length) setDur((v) => (mCfg.durations!.includes(v) ? v : mCfg.durations![0]));
    setQuality((v) =>
      mCfg.qualities?.length ? (mCfg.qualities.includes(v) ? v : mCfg.qualities[0]) : "",
    );
    if (mCfg.batchOptions?.length) {
      const mn = Math.min(...mCfg.batchOptions);
      const mx = Math.max(...mCfg.batchOptions);
      setCount((c) => Math.min(Math.max(c, mn), mx));
    }
  }, [mCfg, curType]);

  // 入口 binding 不随 VO 暴露完整矩阵。切换具体 target 后必须重新从
  // picker 校验，不能仅凭 outputTypes 猜测新 target 也已启用。
  /* eslint-disable react-hooks/set-state-in-effect -- changing the studio output tab invalidates a mismatched skill */
  useEffect(() => {
    if (skill) {
      setSkill(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curType]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 挂载时拉一次真实余额与「AI 优化」单次扣费（需先确保会话，否则 401）。
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

  /* ── panel handlers ──────────────────────────────────────────────────── */

  // 用户主动切换模型时清除预设技能。已发布技能可能固定另一张模型卡，服务端
  // 会以技能模型为准；保留 chip 会让界面模型与实际执行/计费不一致。
  // 技能选择与历史恢复使用 setModel 直设，因此不会误清刚恢复的技能。
  const selectModel = useCallback((nextModel: string) => {
    if (!nextModel || nextModel === model) return;
    skillRestoreSeqRef.current += 1;
    setSkill(null);
    setModel(nextModel);
  }, [model]);

  // setTool clears the typed uploads (create.js setTool → slotData = {}).
  const selectTool = (t: ToolKey) => {
    setTool(t);
    setSlotData({});
    // 音频页签切换时把选中模型对齐到该页签的模型池（下拉只显示本池）。
    if ((t === "t2a" || t === "sfx") && currentStudioList.length) {
      const pool = currentStudioList.filter((m) => audioToolOf(m) === t);
      if (pool.length && !pool.some((m) => m.name === model)) selectModel(pool[0].name);
    }
  };

  // 反向对齐：历史恢复 / 深链直接设了音频模型时，页签自动跟随模型所属池
  //（点页签换模型走 selectTool，这里只处理"模型先变"的路径，等值守卫防环）。
  useEffect(() => {
    if (!isAudio || !currentStudioList.length) return;
    const m = currentStudioList.find((x) => x.name === model);
    if (!m) return;
    const t = audioToolOf(m);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTool((cur) => ((cur === "t2a" || cur === "sfx") && cur !== t ? t : cur));
  }, [model, currentStudioList, isAudio]);

  const pickType = (t: ArtworkType) => {
    skillRestoreSeqRef.current += 1;
    setSkill(null);
    setCurType(t);
    selectTool(MODES_BY_TYPE[t][0]); // renderModes() → setTool(keys[0])
  };

  // 选中技能:附着 chip;指定了模型卡则自动切换;默认参数回填画幅/清晰度/时长
  const pickSkill = useCallback(
    (s: SkillVO) => {
      skillRestoreSeqRef.current += 1;
      if (skillKindOf(s) !== "preset") {
        toast.info("智能技能请在画布中使用");
        return;
      }
      setPrompt((current) => promptAfterSkillPick(current, s, skill));
      setSkill(s);
      setSkillPickerOpen(false);
      if (s.modelId) {
        const target = currentStudioList.find((m) => m.modelKey === s.modelId);
        if (target && target.type === curType && target.name !== model) {
          setModel(target.name);
          toast.info(`已切换到技能模型「${target.name}」`);
        }
      }
      const defaults = parseSkillParams(s.defaultParams);
      if (defaults.aspectRatio) setRatio(defaults.aspectRatio);
      if (defaults.resolution) {
        if (curType === "video") setRes(defaults.resolution);
        else setImgRes(defaults.resolution);
      }
      if (defaults.duration) setDur(`${defaults.duration}s`);
      if (defaults.quality) setQuality(defaults.quality);
    },
    [curType, currentStudioList, model, skill],
  );

  const removeSkill = useCallback(() => {
    skillRestoreSeqRef.current += 1;
    setSkill(null);
  }, []);

  // AI 优化: rewrite the prompt via the backend (relay text model). Falls back to
  // a clear toast when no text model is configured / the call fails.
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
        refreshBalance(); // 优化按文本模型积分扣费，余额需同步
        // 优化模型不认识「图片N」引用 token，重写后引用大概率丢失——素材
        // 还在槽位里，提醒用户重新 @ 即可，不打断流程。用 token 解析而非
        // includes 子串比较：优化结果里的「图片1080p」含「图片1」子串但
        // 不是有效 token，includes 会误判引用仍在。
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

  // 重新编辑 / 再次生成: restore the captured run's full settings back into the
  // panel (type/mode/model/ratio/resolution/quality/count + prompt).
  const restoreParams = useCallback((lr: RunParams) => {
    // 无技能的旧轮次也必须显式清空当前 chip，不能把当前技能套进历史生成。
    setSkill(null);
    setCurType(lr.curType);
    setTool(lr.tool);
    setModel(lr.model);
    setPrompt(lr.prompt);
    setRatio(lr.ratio);
    setImgRes(lr.imgRes);
    setRes(lr.res);
    setDur(lr.dur);
    setQuality(lr.quality);
    setCount(lr.count);
    setEnablePbr(lr.enablePbr ?? false);
    setFaceCount(lr.faceCount ?? 500_000);
    setGenerateType(lr.generateType ?? "Normal");
    setResultFormat(lr.resultFormat ?? "");
    setLyrics(lr.lyrics ?? "");
    setSongStyle(lr.songStyle ?? "");
    setSongTitle(lr.songTitle ?? "");
    setInstrumental(lr.instrumental ?? false);
    // 模式优先取显式字段；老数据按"有歌词 = 自定义"推导。
    setMusicMode(lr.musicMode ?? (lr.lyrics ? "custom" : "inspire"));
    clip.setSourceClipId(lr.sourceClipId ?? "");
    clip.setSourceIsUpload(lr.sourceIsUpload ?? false);
    clip.setContinueAt(lr.continueAt ? String(lr.continueAt) : "");
    // 参考素材回填：按 generate() 写入 refInput 的映射反向恢复各上传槽位。
    // 历史动作承诺“相同参数”，所以即使旧轮次没有参考素材也必须把当前槽位
    // 清空；否则纯文历史会静默带上用户刚上传的新素材并按错误输入扣费。
    const toFiles = (urls: string[], label: string): UploadFile[] =>
      urls.map((u, i) => ({ g: u, url: u, n: urls.length > 1 ? `${label} ${i + 1}` : label, s: "" }));
    const imgs = lr.imageRefs ?? [];
    const slots: SlotData = {};
    if (imgs.length) {
      const key = lr.tool === "i2v" ? "first" : lr.tool === "i2_3d" ? "threeDImage" : "img";
      slots[key] = toFiles(imgs, "参考图");
    }
    if (lr.firstFrame) slots.first = toFiles([lr.firstFrame], "首帧");
    if (lr.lastFrame) slots.last = toFiles([lr.lastFrame], "尾帧");
    if (lr.videoRefs?.length) slots.video = toFiles(lr.videoRefs, "参考视频");
    if (lr.audioRefs?.length) slots.audio = toFiles(lr.audioRefs, "参考音频");
    for (const view of lr.multiViewImages ?? []) {
      const key = THREE_D_VIEW_SLOTS.find((item) => item.viewType === view.viewType)?.key;
      if (key) slots[key] = toFiles([view.viewImageUrl], `${view.viewType} 视图`);
    }
    setSlotData(slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreRunSkill = useCallback(async (
    lr: RunParams,
  ): Promise<{ ok: boolean; modelName?: string; modelId?: string; skillId?: string }> => {
    const seq = ++skillRestoreSeqRef.current;
    restoreParams(lr);
    const saved = lr.skill;
    // Fetch the target type explicitly. `studioList` still belongs to the
    // currently visible type until React commits setCurType and its request
    // returns; using that old closure makes image -> video history look delisted.
    const [modelsResult, skillResult] = await withHistoryRestoreTimeout(Promise.all([
      marketApi.studioModels(lr.curType),
      saved?.id ? skillApi.get(saved.id, "studio", lr.curType) : Promise.resolve(null),
    ]));
    if (seq !== skillRestoreSeqRef.current) return { ok: false };
    if (!modelsResult.success || !Array.isArray(modelsResult.data)) {
      toast.info("模型目录暂时无法加载，请稍后重试");
      return { ok: false };
    }
    const targetModels = modelsResult.data;
    adoptModels(lr.curType, targetModels);
    const historicalModel = targetModels.find((candidate) =>
      candidate.type === lr.curType
      && (lr.modelId ? candidate.id === lr.modelId : candidate.name === lr.model),
    );
    if (!saved?.id) {
      if (!historicalModel) {
        toast.info(`模型「${lr.model}」已下架，请重新选择模型后生成`);
        return { ok: false };
      }
      setModel(historicalModel.name);
      return { ok: true, modelName: historicalModel.name, modelId: historicalModel.id };
    }
    const restored = skillResult?.success ? skillResult.data : undefined;
    if (
      !restored
      || restored.status !== 1
      || skillKindOf(restored) !== "preset"
      || !skillSupportsEntryPoint(restored, "studio")
      || !skillSupportsOutput(restored, lr.curType)
    ) {
      toast.info(`技能「${saved.title || "原技能"}」当前不可用，已移除，请重新选择后生成`);
      return { ok: false };
    }
    let fixedModel: (typeof targetModels)[number] | undefined;
    if (restored.modelId) {
      fixedModel = targetModels.find((candidate) =>
        candidate.modelKey === restored.modelId && candidate.type === lr.curType,
      );
      if (!fixedModel) {
        toast.info(`技能「${restored.title || saved.title || "原技能"}」关联的模型已下架，请重新选择技能`);
        return { ok: false };
      }
      setModel(fixedModel.name);
    } else if (!historicalModel) {
      toast.info(`模型「${lr.model}」已下架，请重新选择模型后生成`);
      return { ok: false };
    } else {
      setModel(historicalModel.name);
    }
    setSkill(restored);
    return {
      ok: true,
      modelName: fixedModel?.name || historicalModel?.name || lr.model,
      modelId: fixedModel?.id || historicalModel?.id,
      skillId: restored.id,
    };
  }, [restoreParams, adoptModels]);

  // 再次生成: after restoring the run's settings to the panel (above), fire
  // generate() on the next commit so it reads the just-restored state.
  useEffect(() => {
    if (!pendingGen) return;
    const target = pendingGenTargetRef.current;
    // Wait until both the restored state and the model directory for that exact
    // media type have committed. The effect then calls the fresh `generate`
    // closure; it can no longer observe the previous type's catalog.
    if (
      target
      && (
        curType !== target.curType
        || loadedType !== target.curType
        || model !== target.model
        || (skill?.id || undefined) !== target.skillId
        || !currentStudioList.some((candidate) =>
          candidate.id === target.modelId
          && candidate.name === target.model
          && candidate.type === target.curType,
        )
      )
    ) return;
    setPendingGen(false);
    pendingGenTargetRef.current = null;
    historyActionLockRef.current = false;
    setRestoringRun(false);
    generate(target
      ? { requireBackendModel: true, expectedModelId: target.modelId }
      : undefined);
  }, [pendingGen, generate, curType, loadedType, model, skill, currentStudioList]);

  // State restoration and catalog adoption normally settle in the same commit.
  // A later focus refresh can nevertheless invalidate the target. Never leave
  // the whole workspace inert forever waiting for a model that no longer exists.
  useEffect(() => {
    if (!pendingGen || !pendingGenTargetRef.current) return;
    const timer = window.setTimeout(() => {
      if (!pendingGenTargetRef.current) return;
      setPendingGen(false);
      pendingGenTargetRef.current = null;
      historyActionLockRef.current = false;
      setRestoringRun(false);
      toast.info("模型目录已变化，已停止重新生成，请确认模型后重试");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pendingGen]);

  // load a finished result into a tool's reference slot, then switch to that tool
  // so the user can immediately describe the change. selectTool() clears slotData,
  // and our setSlotData runs in the same batch so the injected slot wins.
  const applyImageToTool = (
    cell: ResultCell,
    type: ArtworkType,
    toolKey: ToolKey,
    slotKey: string,
    doneToast: string,
  ) => {
    if (!cell.url) {
      toast.info("该结果暂无可用图片");
      return;
    }
    setCurType(type);
    selectTool(toolKey);
    setSlotData({ [slotKey]: [{ g: cell.url, url: cell.url, n: "垫图", s: "" }] });
    toast.success(doneToast);
    setTimeout(() => promptRef.current?.focus(), 0);
  };

  // per-cell hover toolbar (作为垫图 / 生成视频 / 精细编辑 / 扩图 / 高清放大 /
  // 移除背景 / 物体移除). The first three load the image into a panel tool; the rest
  // fire a one-click generation against a dedicated backend edit handler.
  const cellTool = (act: string, cell: ResultCell) => {
    switch (act) {
      case "pad":
        applyImageToTool(cell, "image", "i2i", "img", "已作为垫图载入图生图 · 描述想要的改动");
        break;
      case "video":
        applyImageToTool(cell, "video", "i2v", "first", "已载入图生视频首帧 · 描述运动");
        break;
      case "edit":
        applyImageToTool(cell, "image", "edit", "img", "已载入改图 · 描述要精修的部分");
        break;
      case "expand":
      case "hd":
      case "rmbg":
      case "rmobj": {
        if (!cell.url) {
          toast.info("该结果暂无可用图片");
          break;
        }
        const label = CELL_TOOLS.find((t) => t.act === act)?.label ?? "编辑";
        void oneClickEdit(act, cell.url, label);
        break;
      }
    }
  };

  // same toolbar from the zoom lightbox: wrap the previewed URL as a cell and
  // reuse cellTool, then close the lightbox so the panel / new run is visible.
  const lightboxTool = (act: string) => {
    if (!lightbox) return;
    const cell: ResultCell = { i: -1, hues: huesFromId(lightbox), url: lightbox };
    setLightbox(null);
    cellTool(act, cell);
  };

  // 重新生成: restore a feed run's settings to the panel and fire a fresh run.
  // 会重新扣费发起一次全新生成,先二次确认(带积分成本),避免误点白扣。
  const regenRun = async (r: HistRun) => {
    if (busy || restoringRun || historyActionLockRef.current) return;
    historyActionLockRef.current = true;
    const ok = await confirmDialog({
      title: "重新生成",
      message: "将用相同参数发起一次全新生成，并按当前模型消耗相应积分。",
      confirmText: "重新生成",
    });
    if (!ok) {
      historyActionLockRef.current = false;
      return;
    }
    setRestoringRun(true);
    try {
      if (r.params) {
        lastRunRef.current = r.params;
        const restored = await restoreRunSkill(r.params);
        if (!restored.ok) {
          historyActionLockRef.current = false;
          setRestoringRun(false);
          return;
        }
        if (!restored.modelId) {
          historyActionLockRef.current = false;
          setRestoringRun(false);
          toast.info("历史模型当前不可用，请确认模型后重试");
          return;
        }
        pendingGenTargetRef.current = {
          curType: r.params.curType,
          model: restored.modelName || r.params.model,
          modelId: restored.modelId,
          skillId: restored.skillId,
        };
      } else {
        // No captured params (legacy item): there is no truthful "same
        // parameters" request to replay. Restore only the prompt and require an
        // explicit manual generate after the user confirms the current model.
        skillRestoreSeqRef.current += 1;
        setSkill(null);
        setPrompt(r.prompt);
        pendingGenTargetRef.current = null;
        historyActionLockRef.current = false;
        setRestoringRun(false);
        toast.info("旧历史缺少完整参数，已载入提示词，请确认模型后手动生成");
        return;
      }
    } catch {
      historyActionLockRef.current = false;
      setRestoringRun(false);
      toast.info("历史参数暂时无法恢复，请稍后重试");
      return;
    }
    setPendingGen(true);
  };

  // 编辑: restore the run's settings into the panel (WITHOUT firing) and focus
  // the prompt, so the user can tweak parameters before regenerating.
  const editRun = async (r: HistRun) => {
    if (busy || restoringRun || historyActionLockRef.current) return;
    historyActionLockRef.current = true;
    setRestoringRun(true);
    let restored = true;
    try {
      if (r.params) {
        lastRunRef.current = r.params;
        restored = (await restoreRunSkill(r.params)).ok;
      } else {
        skillRestoreSeqRef.current += 1;
        setSkill(null);
        setPrompt(r.prompt);
      }
    } catch {
      restored = false;
      toast.info("历史参数暂时无法恢复，请稍后重试");
    } finally {
      historyActionLockRef.current = false;
      setRestoringRun(false);
    }
    setTimeout(() => promptRef.current?.focus(), 0);
    if (restored) toast.success("已载入该次生成的参数，可修改后重新生成");
  };

  // delete a run: drop it from the feed locally and best-effort remove it server-side.
  const deleteRun = (r: HistRun) => {
    setHist((prev) => prev.filter((h) => h.run !== r.run));
    const m = /^task-(\d+)$/.exec(r.run);
    if (m) void aiApi.cancelTask(m[1]).catch(() => {}); // 字符串透传雪花 ID,避免 Number() 丢精度
    toast.success("已删除");
  };

  // 空状态快捷入口：切到对应类型/工具并聚焦提示词；3D 已独立成页，转过去。
  const quickStart = (t: ArtworkType, tk: ToolKey) => {
    if (t === "3d") {
      router.push(`/three-d?tool=${tk}`);
      return;
    }
    setCurType(t);
    selectTool(tk);
    promptRef.current?.focus();
  };

  /* ── render ──────────────────────────────────────────────────────────── */

  return (
    <>
      <div
        className={styles.cols}
        inert={restoringRun ? true : undefined}
        aria-busy={restoringRun}
      >
        {/* ── control panel ───────────────────────────────────────────── */}
        <aside className="ws-panel">
          <div className="ws-panel-scroll">
            {/* type tabs: 图片 / 视频 / 音频（3D 独立成页 /three-d） */}
            <TypeTabs curType={curType} onPick={pickType} />

            {/* mode tabs (generation tool) */}
            <div className="seg" id="mode-tabs">
              {modeKeys.map((k) => (
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

            {/* model picker */}
            <ModelPicker model={model} names={modelNames} studioList={currentStudioList} onSelect={selectModel} />

            {/* typed reference uploads (per-tool slots; create.js renderUploads) */}
            <UploadSlots
              tool={tool}
              slots={slots}
              ratio={ratio}
              slotData={slotData}
              mCfg={mCfg}
              onAdd={addFile}
              onRemove={removeFile}
              onSwapFlf={swapFlf}
              onPreview={setPreview}
            />

            {/* 音乐创作模式 + 原曲选择 + 延长起点（仅音频·非音效卡） */}
            {isAudio && !isSfx && (
              <MusicSourceFields
                musicMode={musicMode}
                onMusicModeChange={setMusicMode}
                clip={clip}
                clipOptions={clipOptions}
                selModel={selModel}
                studioList={currentStudioList}
                model={model}
                onModelChange={selectModel}
              />
            )}

            {/* prompt（自定义歌词/延长/翻唱模式下描述不参与生成，整块隐藏避免误导） */}
            {tool !== "i2_3d" && !(isAudio && !isSfx && musicMode !== "inspire") && (
              <PromptSection
                prompt={prompt}
                onPromptChange={setPrompt}
                promptRef={promptRef}
                mentionRefs={mentionRefs}
                placeholder={mCfg?.defaultPrompt || cfg.ph}
                skill={skill}
                onRemoveSkill={removeSkill}
                optimizing={optimizing}
                optCost={optCost}
                onOptimize={aiOptimize}
                onOpenSkillPicker={() => setSkillPickerOpen(true)}
                ideaOpts={ideaOpts}
                allowSkills={!is3D}
                label={tool === "mv2_3d" ? "提示词（可选）" : "提示词"}
              />
            )}

            {/* 音频（Suno）自定义/延长/翻唱的歌词/风格/歌名 */}
            {isAudio && !isSfx && musicMode !== "inspire" && (
              <SongFields
                musicMode={musicMode}
                lyrics={lyrics}
                onLyricsChange={setLyrics}
                songStyleList={songStyleList}
                onToggleStyle={toggleSongStyle}
                songTitle={songTitle}
                onSongTitleChange={setSongTitle}
              />
            )}

            {/* 人声/纯音乐（仅音频·非音效卡） */}
            {isAudio && !isSfx && <VocalField instrumental={instrumental} onChange={setInstrumental} />}

            {is3D ? (
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
            ) : (
              /* 画面比例 / 分辨率 / 质量 / 清晰度 / 生成数量 / 时长 */
              <OptionFields
                isVideo={isVideo}
                isAudio={isAudio}
                ratioOpts={ratioOpts}
                ratio={ratio}
                onRatioChange={setRatio}
                resOpts={resOpts}
                imgRes={imgRes}
                onImgResChange={setImgRes}
                qualOpts={qualOpts}
                quality={quality}
                onQualityChange={setQuality}
                count={count}
                onCountChange={setCount}
                batchMin={batchMin}
                batchMax={batchMax}
                res={res}
                onResChange={setRes}
                durOpts={durOpts}
                dur={dur}
                onDurChange={setDur}
              />
            )}
          </div>

          {/* footer */}
          <div className="ws-panel-foot">
            <button
              className={`ws-gen${restoringRun ? " busy" : ""}`}
              id="gen"
              type="button"
              disabled={restoringRun}
              onClick={() => generate()}
            >
              <span className="spark">✦</span> {restoringRun ? "正在恢复历史参数…" : "立即生成"}{" "}
              <span className="ws-gen-cost">
                <>·&nbsp;<b id="cost">{cost}</b>&nbsp;积分</>
              </span>
            </button>
            <div className="ws-balance">
              {balance !== null ? `余额 ${balance.toLocaleString()} 积分` : "余额 —"}
            </div>
          </div>
        </aside>

        {/* ── center stage ────────────────────────────────────────────── */}
        {/* 引擎恢复的在飞 3D 任务不在创作台渲染进度卡（展示归 /three-d） */}
        <StageFeed
          busy={busy || restoringRun}
          runs={runs}
          inflightRuns={inflightRuns.filter((r) => r.meta.kind !== "3d")}
          onQuickStart={quickStart}
          onEditRun={editRun}
          onRegenRun={regenRun}
          onDeleteRun={deleteRun}
          onCellTool={cellTool}
          onZoom={setLightbox}
          hasMore={histHasMore}
          loadingMore={histLoadingMore}
          onLoadMore={loadMoreHistory}
          initialLoading={histInitialLoading}
          loadError={histLoadError}
          endReached={!histHasMore && histMultiPage}
        />
      </div>

      <PreviewModal preview={preview} slotData={slotData} slots={slots} onClose={() => setPreview(null)} />

      {/* full-image lightbox — click a finished result to zoom; backdrop / ✕ / Esc closes */}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} onTool={lightboxTool} />}

      {/* hidden input for 本地上传 */}
      <input ref={fileInputRef} type="file" multiple hidden onChange={onLocalFiles} />

      {/* hidden input for 原曲本地上传(mp3/wav → 上传+登记) */}
      <input
        ref={clipFileRef}
        type="file"
        accept=".mp3,.wav,audio/mpeg,audio/wav"
        hidden
        onChange={onClipFilePicked}
      />

      {/* 参考素材来源选择：本地上传 / 资产库（按槽类型 图片/视频/音频 适配文案） */}
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

      {/* 技能广场:按当前创作类型过滤 */}
      {!is3D && (
        <SkillPicker
          open={skillPickerOpen}
          onClose={() => setSkillPickerOpen(false)}
          onPick={pickSkill}
          outputType={curType}
          targetType={curType}
          currentId={skill?.id}
          kinds={["preset"]}
          entryPoint="studio"
        />
      )}

      {/* 资产库弹窗：复用整个资产页 UI 作为选择器，按槽类型默认到对应筛选 */}
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
