"use client";

/* ── composer chip config state machine (extracted verbatim from page.tsx) ─────
   联网 / 模式 / 模型 / 比例 / 分辨率 / 画质 / 时长 / 批量 / 技能 / 音乐四模式
   的全部状态、按模型能力的收敛 effects、参考策略推导与积分预估。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/shared/toast";
import { parseSkillInputSchema, parseSkillParams } from "@/lib/skill-api";
import { skillKindOf, type SkillVO } from "@/types/skill";
import {
  DEFAULT_MUSIC_PARAMS,
  fetchClipOptions,
  isSfxModel,
  type ClipOption,
  type MusicParams,
} from "@/lib/music-modes";
import {
  MAX_ATTACHMENTS,
  REF_POLICY,
  acceptFor,
  normalizeFormats,
  type RefPolicy,
} from "../_components/chat-utils";
import { resolutionRank } from "@/components/studio/create-studio/utils";
import { configuredMatrix, keyVariants, matrixPrice, resolveVideoPointCost } from "@/lib/price-matrix";
import { supportedOmniReferenceKinds } from "@/lib/omni-reference";
import type { GenModelsApi } from "./use-gen-models";

export function useComposerConfig(models: GenModelsApi, toolSkill: SkillVO | null = null) {
  const { genModels, model, setModel, selModel, mCfg, isVid, webSearchAvail } = models;

  // composer chips — driven by the selected model's 模型管理 config
  const [web, setWeb] = useState(false);
  const [mode, setMode] = useState("");
  const [ratio, setRatio] = useState("");
  const [res, setRes] = useState("");
  const [quality, setQuality] = useState("");
  const [dur, setDur] = useState("");
  // 技能以内联 chip 附着到输入框；执行模板由服务端按 skillId 解析并保持粘性。
  const [skill, setSkill] = useState<SkillVO | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [batch, setBatch] = useState(1);
  const [openSel, setOpenSel] = useState<string | null>(null);
  // 音乐四创作模式（Suno，仅音频音乐模型时生效）——字段与请求口径对齐创作台。
  const [music, setMusic] = useState<MusicParams>(DEFAULT_MUSIC_PARAMS);
  // 延长/翻唱的原曲候选（用户生成历史里的分轨 clip）；null = 尚未拉取。
  const [clipOpts, setClipOpts] = useState<ClipOption[] | null>(null);
  // 原曲选择弹窗(替代下拉:Suno 同批两首同名,弹窗里能试听/看第 N 首区分)
  const [clipPickOpen, setClipPickOpen] = useState(false);

  const modeVals = mCfg?.modes ?? [];
  const ratioOpts = mCfg?.ratios ?? [];
  // 展示按数值升序（上游同步的配置顺序常乱），默认选中逻辑不受影响
  const resOpts = [...(mCfg?.resolutions ?? [])].sort(
    (a, b) => resolutionRank(a) - resolutionRank(b),
  );
  // 画质档位只对图片有意义：服务端 pricing.go 的图片单价按 [quality][clarity]
  // 查表，视频走 [duration][resolution]，音频按次计费。
  const qualOpts = selModel?.type === "image" ? mCfg?.qualities ?? [] : [];
  const durOpts = isVid ? mCfg?.durations ?? [] : [];
  const countOpts = mCfg?.batchOptions?.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMax = Math.max(...countOpts);
  const toggleSel = (k: string) => setOpenSel((cur) => (cur === k ? null : k));

  // reference policy for the current model/mode. For a 文本模型 it is driven by
  // 模型管理 config (fileUpload on → 图片附件，数量 maxFileCount、单文件 maxFileSizeMB)；
  // for image/video models it is the per-mode REF_POLICY (t2i / t2v take none).
  const refPolicy = useMemo<RefPolicy | undefined>(() => {
    if (toolSkill && skillKindOf(toolSkill) === "tool") {
      const schema = parseSkillInputSchema(toolSkill.inputSchema);
      const rawKinds = schema?.["x-asset-types"];
      const kinds = Array.isArray(rawKinds)
        ? rawKinds.filter((kind): kind is RefPolicy["kinds"][number] =>
            kind === "image" || kind === "video" || kind === "audio" || kind === "file",
          )
        : [];
      if (!kinds.length) return undefined;
      const assetSpec = schema?.properties?.assets;
      const configuredMax = typeof assetSpec?.maxItems === "number" ? assetSpec.maxItems : 1;
      return {
        kinds,
        max: Math.max(1, Math.min(MAX_ATTACHMENTS, configuredMax)),
        maxSizeMB: 100,
        accept: acceptFor(kinds),
      };
    }
    if (!selModel) return undefined;
    if (selModel.type === "text") {
      if (!mCfg?.fileUpload) return undefined;
      const cfgMax = mCfg.maxFileCount && mCfg.maxFileCount > 0 ? mCfg.maxFileCount : MAX_ATTACHMENTS;
      // 格式白名单来自模型管理 config.uploadFormats：未配置 = 任意格式（含文档），
      // 配置了 = 仅允许所列扩展名。类型上放开全部 kind，由扩展名约束。
      const exts = normalizeFormats(mCfg.uploadFormats);
      return {
        kinds: ["image", "video", "audio", "file"],
        max: Math.min(cfgMax, MAX_ATTACHMENTS),
        maxSizeMB: mCfg.maxFileSizeMB ?? 0,
        exts,
        accept: exts ? exts.map((e) => `.${e}`).join(",") : undefined,
      };
    }
    const p = REF_POLICY[mode];
    if (!p) return undefined;
    const kinds = mode === "omni_ref" ? supportedOmniReferenceKinds(mCfg) : p.kinds;
    return { ...p, kinds, max: kinds.length ? p.max : 0, accept: acceptFor(kinds) };
  }, [toolSkill, selModel, mode, mCfg]);
  // text-model uploads are OPTIONAL (a chat can be plain text); generation ref
  // modes (i2i/i2v/…) REQUIRE at least one reference before sending.
  const toolRequiresAssets = useMemo(() => {
    if (!toolSkill || skillKindOf(toolSkill) !== "tool") return false;
    const required = parseSkillInputSchema(toolSkill.inputSchema)?.required;
    return Array.isArray(required) && required.includes("assets");
  }, [toolSkill]);
  const refOptional = toolSkill ? !toolRequiresAssets : selModel?.type === "text";

  // 音频模型分流：音乐（四创作模式）vs 音效（只吃描述），判定与创作台一致
  //（后台「生成方式」勾 sfx，modelKey 含 sfx 兜底）。
  const isAudioSel = selModel?.type === "audio";
  const isMusicSel = isAudioSel && !isSfxModel(selModel?.modelKey, mCfg?.modes ?? undefined);
  const musicMode = music.musicMode;
  // 非灵感模式的音乐生成不强制描述（歌词/原曲才是主输入），发送按钮据此放行。
  const musicNoDraftOk = isMusicSel && musicMode !== "inspire";

  // 每次进入延长/翻唱都重拉原曲候选（新生成的歌完成后，重新切入即可看到）；
  // 已有列表在刷新期间保留展示，仅首次为 null 时显示加载态。
  useEffect(() => {
    if (!isMusicSel || (musicMode !== "extend" && musicMode !== "cover")) return;
    let alive = true;
    fetchClipOptions().then((opts) => {
      if (alive) setClipOpts(opts);
    });
    return () => {
      alive = false;
    };
  }, [isMusicSel, musicMode]);

  // close any open composer dropdown on an outside click / Escape.
  useEffect(() => {
    if (!openSel) return;
    const onDoc = () => setOpenSel(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpenSel(null);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSel]);

  // snap chip selections to values the selected model actually supports.
  useEffect(() => {
    if (!mCfg) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换模型后把芯片选择收敛到该模型支持的取值，全部函数式更新
    setMode((m) => (modeVals.length ? (modeVals.includes(m) ? m : modeVals[0]) : ""));
    setRatio((r) => (ratioOpts.length ? (ratioOpts.includes(r) ? r : ratioOpts[0]) : ""));
    // 默认档位取配置首项（管理员排的推荐档），resOpts 只是展示排序后的副本
    setRes((r) =>
      resOpts.length ? (resOpts.includes(r) ? r : mCfg.resolutions?.[0] ?? resOpts[0]) : "",
    );
    setQuality((q) => (qualOpts.length ? (qualOpts.includes(q) ? q : qualOpts[0]) : ""));
    setDur((d) => (durOpts.length ? (durOpts.includes(d) ? d : durOpts[0]) : ""));
    setBatch((b) => Math.min(Math.max(1, b), batchMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mCfg, isVid]);

  // 模态就是 chat binding 的 target。切换 target 后重新选择，确保目录
  // 过滤和实际 create/generate 使用的是同一条绑定。
  /* eslint-disable react-hooks/set-state-in-effect -- changing model invalidates a previously selected skill */
  useEffect(() => {
    if (skill) {
      setSkill(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selModel?.type]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 选中技能:附着 chip;技能指定了模型卡则自动切换;默认参数回填画幅/清晰度/时长
  // (随后的收敛 effect 会把不在该模型档位内的值校正掉)。
  const pickSkill = useCallback(
    (s: SkillVO) => {
      if (skillKindOf(s) !== "preset") {
        toast.info("智能技能请在画布中使用");
        return;
      }
      setSkill(s);
      setSkillPickerOpen(false);
      if (skillKindOf(s) === "preset" && s.modelId) {
        const target = genModels.find((m) => m.modelKey === s.modelId);
        if (target && target.type === selModel?.type && target.name !== model) {
          setModel(target.name);
          toast.info(`已切换到技能模型「${target.name}」`);
        }
      }
      if (skillKindOf(s) === "preset") {
        const defaults = parseSkillParams(s.defaultParams);
        if (defaults.aspectRatio) setRatio(defaults.aspectRatio);
        if (defaults.resolution) setRes(defaults.resolution);
        if (defaults.quality) setQuality(defaults.quality);
        if (defaults.duration) setDur(`${defaults.duration}s`);
      }
    },
    [genModels, model, selModel?.type, setModel],
  );

  const removeSkill = useCallback(() => {
    setSkill(null);
  }, []);

  // 用户主动切换模型时，当前预设技能必须一并移除。预设的已发布版本可能
  // 固定了另一张模型卡，服务端会以技能模型为准；若只更新模型下拉，界面
  // 的模型/积分预估就会与实际执行不一致。技能自身触发的自动切模仍直接走
  // setModel，因此不会把刚选中的技能误清掉。
  const selectModel = useCallback((nextModel: string) => {
    if (!nextModel || nextModel === model) return;
    setSkill(null);
    setModel(nextModel);
  }, [model, setModel]);

  // 切到不支持联网的模型时，强制关闭联网开关。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 能力开关随模型收敛，一次性复位
    if (!webSearchAvail) setWeb(false);
  }, [webSearchAvail]);

  // approx points cost — 与服务端权威计费(pricing.go resolveCost)同序解析，
  // 分辨率/时长切换要联动:
  //   video per_request: pricePerRequestByResolution[分辨率]，不读时长
  //   video duration: priceMatrix[时长][分辨率] → priceModifiers → 固定价
  //   image: priceMatrix[画质||default][清晰度]（两个轴序都试；不配画质档位
  //          时服务端与此处同查 default 行）→ creditCost → pointCost × 批量
  //   audio: 按次计费（Suno 一次两首一并结算）
  //   text: 按条计费，不乘数量（数量选择器对文本模型隐藏）
  const points = useMemo(() => {
    const cellNum = (v: unknown) => {
      const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const flat = cellNum(mCfg?.creditCost) || parseFloat(selModel?.pointCost ?? "0") || 0;
    if (isVid) {
      return resolveVideoPointCost(mCfg, dur, res, selModel?.pointCost);
    }
    let base = 0;
    const pm = configuredMatrix(mCfg);
    if (selModel?.type === "image" && res) {
      // 图片按 [画质][清晰度] 查表，与服务端 pricing.go 同口径；两种轴序都试，
      // 后台矩阵横竖着写都能命中（漏查会静默落到模型固定价，4K 卖成 1K 的钱）。
      // 不配画质档位时（quality 为空）查 default 行——服务端同样如此。
      const q = quality || "default";
      base = matrixPrice(pm, keyVariants(q), keyVariants(res)) ?? 0;
    }
    if (!base) base = flat;
    // 服务端按向上取整结算（见 pricing.go），展示同口径；仅图片批量 ×数量
    if (selModel?.type === "image") return Math.ceil(base * Math.max(1, batch));
    return Math.ceil(base);
  }, [mCfg, selModel, isVid, dur, res, quality, batch]);

  return {
    web,
    setWeb,
    mode,
    setMode,
    ratio,
    setRatio,
    res,
    setRes,
    quality,
    setQuality,
    dur,
    setDur,
    skill,
    setSkill,
    removeSkill,
    skillPickerOpen,
    setSkillPickerOpen,
    batch,
    setBatch,
    openSel,
    setOpenSel,
    music,
    setMusic,
    clipOpts,
    setClipOpts,
    clipPickOpen,
    setClipPickOpen,
    modeVals,
    ratioOpts,
    resOpts,
    qualOpts,
    durOpts,
    countOpts,
    batchMax,
    toggleSel,
    refPolicy,
    refOptional,
    isAudioSel,
    isMusicSel,
    musicMode,
    musicNoDraftOk,
    pickSkill,
    selectModel,
    points,
  };
}

export type ComposerConfigApi = ReturnType<typeof useComposerConfig>;
