/* 生成引擎 hook — 从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   负责：在飞任务的全部状态（busy/cells/progs/runMeta 与 tick/poll/runId 等 ref）、
   真实后端任务的创建与轮询（startGeneration → driveRun）、无后端模型时的
   设计预览模拟、结果一键编辑（oneClickEdit）、刷新续跑（localStorage 快照）、
   以及卸载/结算时的清理与余额刷新。
   面板状态经 GenerationParams 按渲染传入，useCallback 依赖数组与原文件一致，
   闭包新鲜度语义不变。 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { aiApi } from "@/lib/api";
import { skillApi } from "@/lib/skill-api";
import type { SkillVO } from "@/types/skill";
import { AiTaskStatus } from "@/types/ai";
import type { MentionEditorHandle } from "@/components/studio/mention-prompt-editor";
import { toast } from "@/components/shared/toast";
import { markRequiredField } from "@/lib/require-field";
import {
  ACTIVE_RUN_KEY,
  EDIT_OP_HANDLER,
  TOOL_TO_HANDLER,
  TOOLS,
  UPLOADS,
} from "./constants";
import type {
  ActiveRun,
  ArtworkType,
  HistItem,
  MeshHues,
  MetaTrack,
  MusicMode,
  ResultCell,
  RunMeta,
  RunParams,
  SlotData,
  ToolKey,
} from "./types";
import { nextHistId, promptHue, refThumbsForRun, tracksFromMeta } from "./utils";

export interface GenerationParams {
  /* panel state (fresh each render) */
  prompt: string;
  count: number;
  tool: ToolKey;
  curType: ArtworkType;
  ratio: string;
  model: string;
  res: string;
  dur: string;
  imgRes: string;
  quality: string;
  musicMode: MusicMode;
  sourceClipId: string;
  sourceIsUpload: boolean;
  continueAt: string;
  lyrics: string;
  songStyle: string;
  songTitle: string;
  instrumental: boolean;
  slotData: SlotData;
  studioList: StudioModelVO[];
  ratioOpts: string[];
  resOpts: string[];
  durOpts: string[];
  qualOpts: string[];
  skill: SkillVO | null;
  isAudio: boolean;
  isSfx: boolean;
  /* services */
  ensureSession: () => Promise<boolean>;
  refreshBalance: () => Promise<void>;
  pushHistory: (item: Omit<HistItem, "id">) => void;
  setHist: Dispatch<SetStateAction<HistItem[]>>;
  promptRef: RefObject<MentionEditorHandle | null>;
}

export function useGeneration(p: GenerationParams) {
  const {
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
    sourceClipId,
    sourceIsUpload,
    continueAt,
    lyrics,
    songStyle,
    songTitle,
    instrumental,
    slotData,
    studioList,
    ratioOpts,
    resOpts,
    durOpts,
    qualOpts,
    skill,
    isAudio,
    isSfx,
    ensureSession,
    refreshBalance,
    pushHistory,
    setHist,
    promptRef,
  } = p;

  /* stage state */
  const [busy, setBusy] = useState(false);
  const [cells, setCells] = useState<ResultCell[]>([]);
  const [progs, setProgs] = useState<number[]>([]);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  // full settings of the last started run (for 重新编辑 / 再次生成) + a one-shot
  // flag that fires generate() after those settings are restored to the panel.
  const lastRunRef = useRef<RunParams | null>(null);
  // synchronous in-flight latch: `busy` state is set asynchronously (and, for the
  // one-click edit ops, only after a network round-trip), so it cannot prevent a
  // rapid double-click from firing two backend tasks. This ref is flipped true
  // before any await and cleared wherever the run settles (every setBusy(false)).
  const genInFlightRef = useRef(false);

  const ticksRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // bumped on every reset/cancel so in-flight poll callbacks from a stale run bail out.
  const runIdRef = useRef(0);

  /* Drive the generating UI + poll a known backend task to completion. Shared by
     a fresh generation AND by the refresh-resume path (same task id either way),
     so an in-flight generation survives a page reload. */
  const driveRun = useCallback(
    (run: ActiveRun) => {
      const { taskId, prompt: p, model: mdl, ratio: r, spec, count: n, isVid, label, hues } = run;
      const kind: ArtworkType = run.kind ?? (isVid ? "video" : "image");
      const myRun = (runIdRef.current += 1);

      const newCells: ResultCell[] = hues.map((h, i) => ({ i, hues: h }));
      setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, kind, refThumbs: run.refThumbs });
      setCells(newCells);
      setBusy(true);

      ticksRef.current.forEach((t) => clearInterval(t));
      ticksRef.current = [];
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }

      // progress floor + gentle creep between polls (poll raises it to task.progress).
      const PROG_FLOOR = 6;
      const local = new Array(n).fill(PROG_FLOOR);
      setProgs([...local]);
      newCells.forEach((_, i) => {
        const tick = setInterval(() => {
          local[i] = Math.min(90, local[i] + 1.5);
          setProgs([...local]);
        }, 500);
        ticksRef.current.push(tick);
      });

      const stopTicks = () => {
        ticksRef.current.forEach((t) => clearInterval(t));
        ticksRef.current = [];
      };
      const clearActive = () => {
        try {
          localStorage.removeItem(ACTIVE_RUN_KEY);
        } catch {
          /* storage unavailable */
        }
      };
      const isValidUrl = (u?: string): u is string =>
        !!u && (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:"));

      const finish = (urls: string[], tracks: MetaTrack[] = []) => {
        if (runIdRef.current !== myRun) return;
        stopTicks();
        clearActive();
        // Suno 一次返回两首：结果多于占位格时按结果数展开（仅音频；图片批量的
        // n 与结果数本就一致）。补出的格子沿用首格色相。
        const outCells =
          kind === "audio" && urls.length > newCells.length
            ? urls.map(
                (_, i) => newCells[i] ?? { i, hues: newCells[0]?.hues ?? ([0, 80, 200] as MeshHues) },
              )
            : newCells;
        setProgs(new Array(outCells.length).fill(100));
        setCells(outCells.map((c) => ({ ...c, url: urls[c.i] ?? urls[0] })));
        setBusy(false);
        // group every image of this run under one feed key. Insert the whole run as
        // one block (0..n order) with a dedup guard: on refresh-resume, loadHistory
        // may have already seeded this task's items (same run key), and finishing the
        // resumed poll would otherwise render every image twice. Ids are computed
        // outside the updater so it stays pure (React dev double-invokes it).
        const runKey = `task-${taskId}`;
        const ts = new Date().toISOString();
        const built = outCells.map((cell) => ({
          id: nextHistId(),
          run: runKey,
          ts,
          ratio: r,
          hues: cell.hues,
          type: kind,
          title: tracks[cell.i]?.title || p || mdl,
          prompt: p,
          model: mdl,
          url: urls[cell.i] ?? urls[0],
          clipId: tracks[cell.i]?.clipId || undefined,
          trackTitle: tracks[cell.i]?.title || undefined,
          trackCover: tracks[cell.i]?.coverUrl || undefined,
          trackDur: tracks[cell.i]?.duration || undefined,
          params: lastRunRef.current ?? undefined,
        }));
        setHist((prev) => (prev.some((h) => h.run === runKey) ? prev : [...built, ...prev]));
        toast.success(kind === "audio" ? "生成完成 · 点击播放试听" : "生成完成 · 点击图片放大查看");
      };

      const fail = (msg?: string) => {
        if (runIdRef.current !== myRun) return;
        stopTicks();
        clearActive();
        setBusy(false);
        toast.error(msg || "生成失败");
      };

      const poll = async () => {
        if (runIdRef.current !== myRun) return;
        try {
          const res = await aiApi.getTask(taskId);
          if (runIdRef.current !== myRun) return;
          if (!res.success) {
            fail(res.message);
            return;
          }
          const task = res.data;
          if (task.status === AiTaskStatus.SUCCESS) {
            let meta: Record<string, unknown> = {};
            if (typeof task.resultMeta === "string") {
              try {
                meta = JSON.parse(task.resultMeta) || {};
              } catch {
                meta = {};
              }
            } else if (task.resultMeta && typeof task.resultMeta === "object") {
              meta = task.resultMeta as Record<string, unknown>;
            }
            const rawUrls = meta.urls;
            const urls = Array.isArray(rawUrls) ? rawUrls.filter(isValidUrl) : [];
            const all = urls.length ? urls : isValidUrl(task.resultUrl) ? [task.resultUrl] : [];
            if (!all.length) {
              fail("生成结果无效，可能未配置 AI 供应商");
              return;
            }
            finish(all, tracksFromMeta(meta));
          } else if (task.status === AiTaskStatus.FAILED) {
            fail(task.errorMsg);
          } else if (task.status === AiTaskStatus.CANCELLED) {
            if (runIdRef.current !== myRun) return;
            stopTicks();
            clearActive();
            setBusy(false);
          } else {
            // still processing: raise the bar to the real progress (kept as a floor).
            if (typeof task.progress === "number") {
              const pv = Math.min(95, Math.max(PROG_FLOOR, task.progress));
              for (let i = 0; i < n; i++) local[i] = Math.max(local[i], pv);
              setProgs([...local]);
            }
            // deadline checked AFTER reading the task, so a completed task is always
            // picked up even when resumed long after it was started.
            // 音频（Suno）1–4 分钟 + 回存,给 12 分钟;后端整体预算 10 分钟。
            const maxMs = isVid ? 30 * 60 * 1000 : kind === "audio" ? 12 * 60 * 1000 : 7 * 60 * 1000;
            if (Date.now() - run.startedAt > maxMs) {
              fail("生成超时，请重试");
              return;
            }
            pollRef.current = setTimeout(poll, 1500);
          }
        } catch {
          fail("网络错误");
        }
      };
      poll();
    },
    [setHist],
  );

  // Release the synchronous in-flight latch whenever a run settles (busy → false).
  // This single effect covers every setBusy(false) path (driveRun finish/fail/
  // cancelled, startGeneration failure, the simulation branch); paths that set the
  // latch but never start a run (a thrown one-click op) clear it themselves.
  useEffect(() => {
    if (!busy) {
      genInFlightRef.current = false;
      // 结算即刷新余额：成功已扣减、失败/取消已退款，都以后端为准。
      refreshBalance();
    }
  }, [busy, refreshBalance]);

  // Tear down all timers on unmount. Beyond the progress intervals, this must
  // also clear the self-rescheduling poll timeout and bump runIdRef — otherwise
  // `poll` keeps re-arming after navigation, hits getTask forever, and on
  // completion runs setState on an unmounted component + pops a toast on whatever
  // page the user is now on.
  useEffect(
    () => () => {
      ticksRef.current.forEach((t) => clearInterval(t));
      ticksRef.current = [];
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      runIdRef.current += 1; // invalidate any in-flight poll
    },
    [],
  );

  /* Create a backend task and hand the progress UI + polling to driveRun. Shared
     by the panel generate() and the one-click per-result edit ops, so both go
     through the exact same task-create → persist → drive path. */
  const startGeneration = useCallback(
    async (args: {
      handler: string;
      modelId: string;
      input: Record<string, unknown>;
      meta: Omit<ActiveRun, "taskId" | "startedAt">;
    }) => {
      const myRun = (runIdRef.current += 1);
      setBusy(true);
      try {
        await ensureSession();
        if (runIdRef.current !== myRun) return;
        const res2 = await aiApi.generate({
          handler: args.handler,
          modelId: args.modelId,
          input: args.input,
        });
        if (runIdRef.current !== myRun) return;
        if (!res2.success) {
          setBusy(false);
          toast.error(res2.message || "生成请求失败");
          return;
        }
        const run: ActiveRun = { taskId: res2.data.id, ...args.meta, startedAt: Date.now() };
        try {
          localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
        } catch {
          /* storage unavailable — generation still works, just no refresh-resume */
        }
        driveRun(run);
      } catch {
        setBusy(false);
        toast.error("网络错误");
      }
    },
    [ensureSession, driveRun],
  );

  /* One-click per-result edit op (移除背景 / 物体移除 / 高清放大 / 扩图). Fires a
     real generation on the clicked image with a fixed backend handler — the
     server owns the edit instruction, so the user types nothing. The op always
     runs on an image-edit model (resolved independently of the current panel
     model, which may be a video model), and 高清放大 prefers a 4K-capable one. */
  const oneClickEdit = useCallback(
    async (op: string, imageUrl: string, label: string) => {
      if (busy || genInFlightRef.current) {
        toast.info("正在生成中，请稍候…");
        return;
      }
      const handler = EDIT_OP_HANDLER[op];
      if (!handler || !imageUrl) {
        toast.info("该结果暂无可用图片");
        return;
      }
      // latch synchronously, before the awaits below, so a rapid double-click
      // can't slip a second task through (busy is only set later, inside
      // startGeneration). Cleared on every exit that doesn't hand off to a run.
      genInFlightRef.current = true;
      try {
        await ensureSession();
        // resolve an image-edit-capable model (independent of the current panel
        // type, since the panel may be on 视频 while editing an image result).
        const r = await marketApi.studioModels("image");
        const models = (r.success && r.data ? r.data : []) as StudioModelVO[];
        const editable = models.filter((m) => {
          const c = m.config;
          return (c?.operations?.includes("edits") ?? false) || (c?.modes?.includes("i2i") ?? false);
        });
        const pool = editable.length ? editable : models;
        const is4k = (m: StudioModelVO) =>
          /4k/i.test(m.modelKey || "") || /4k|4K/.test(m.name);
        let pick: StudioModelVO | undefined;
        if (op === "hd") {
          pick = pool.find(is4k) ?? pool.find((m) => model === m.name) ?? pool[0];
        } else {
          pick =
            pool.find((m) => m.name === model) ??
            pool.find((m) => /nano-banana-2$/.test(m.modelKey || "")) ??
            pool.find((m) => /gpt-image-2/.test(m.modelKey || "")) ??
            pool[0];
        }
        const modelId = pick?.modelKey || pick?.id || "";
        if (!modelId) {
          genInFlightRef.current = false;
          toast.error("没有可用的图像编辑模型");
          return;
        }
        // input carries only the source image (+ a human label under prompt for
        // history display; the backend overrides it with the engineered prompt)
        // and, for 高清放大, the 4K resolution hint.
        const input: Record<string, unknown> = {
          imageList: [imageUrl],
          sourceImage: imageUrl,
          prompt: label,
          ...(op === "hd" ? { resolution: "4k", clarity: "4k", quality: "high" } : {}),
        };
        const hsh = promptHue(imageUrl);
        const hues: MeshHues[] = [[hsh, (hsh + 80) % 360, (hsh + 200) % 360]];
        // a one-click edit is server-driven with no panel params, so clear the
        // last-run snapshot: the result's 再次生成 / 重新编辑 foot actions must not
        // replay the previous (unrelated) panel run.
        lastRunRef.current = null;
        await startGeneration({
          handler,
          modelId,
          input,
          meta: {
            prompt: label,
            model: pick?.name || model,
            ratio: runMeta?.ratio ?? "1:1",
            spec: label,
            count: 1,
            isVid: false,
            label,
            hues,
            refThumbs: [imageUrl],
          },
        });
      } catch {
        genInFlightRef.current = false;
        toast.error("网络错误，请重试");
      }
    },
    [busy, ensureSession, model, runMeta, startGeneration],
  );

  /* ── generation ───────────────────────────────────────────────────────────
     Calls the real backend (/api/ai/generate → poll /api/ai/tasks/:id) when a
     real studio model is selected; falls back to the design-preview simulation
     only when no backend model is available (studioList empty). */

  const generate = useCallback(() => {
    if (busy || genInFlightRef.current) return;
    const p = prompt.trim();
    // 音乐创作模式互斥（对齐上游 API）：灵感=只看描述;自定义=歌词必填、描述不发;
    // 延长/翻唱=原曲 clip 必选、歌词选填。旧版"风格需搭配歌词"歧义由模式结构消除。
    const musicCustom = isAudio && !isSfx && musicMode === "custom";
    const musicTask = isAudio && !isSfx && (musicMode === "extend" || musicMode === "cover")
      ? musicMode
      : "";
    const audLyrics = isAudio && !isSfx && musicMode !== "inspire" ? lyrics.trim() : "";
    if (musicCustom && !audLyrics) {
      toast.info("自定义歌词模式需先填写歌词 ✦");
      markRequiredField("#fieldLyrics");
      return;
    }
    if (musicTask && !sourceClipId) {
      toast.info(musicTask === "extend" ? "延长模式需先选择原曲 ✦" : "翻唱模式需先选择原曲 ✦");
      markRequiredField("#fieldSourceClip");
      return;
    }
    if (!musicTask && !p && !audLyrics) {
      toast.info(isAudio ? "先写一句音乐描述 ✦" : "先写一句提示词吧 ✦");
      markRequiredField(".ws-promptbox");
      promptRef.current?.focus();
      return;
    }

    // 有参考素材仍在上传时先拦下:否则按「无 url」被当成没传,误报「请先上传参考图片」
    if (Object.values(slotData).some((arr) => (arr || []).some((f) => f.uploading))) {
      toast.info("参考素材上传中，请稍候…");
      return;
    }
    // reference assets from the upload slots (real URLs from 本地上传 / 资产库).
    const slotUrls = (key: string) =>
      (slotData[key] || []).map((f) => f.url).filter((u): u is string => !!u);
    const imageRefs = tool === "i2v" ? slotUrls("first") : slotUrls("img");
    const firstFrame = slotUrls("first")[0];
    const lastFrame = slotUrls("last")[0];
    // 全能参考 (ref) accepts image / video / audio references — any one is enough.
    const vidRefs = tool === "ref" ? slotUrls("video") : [];
    const audRefs = tool === "ref" ? slotUrls("audio") : [];
    const needsRef = (UPLOADS[tool] ?? []).length > 0;
    const hasAnyRef =
      imageRefs.length > 0 || !!firstFrame || !!lastFrame || vidRefs.length > 0 || audRefs.length > 0;
    if (needsRef && !hasAnyRef) {
      toast.info(tool === "ref" ? "请先上传参考素材（图片 / 视频 / 音频）" : "请先上传参考图片");
      markRequiredField("#dropFiles");
      return;
    }
    // 首尾帧模式两帧都必填:只传其一时缺的那帧会被静默省略、上游必拒,
    // 在这里就地拦下(画布视频节点缺尾帧是回退首帧,创作台按显式必填口径)。
    if (tool === "flf" && (!firstFrame || !lastFrame)) {
      toast.info(!firstFrame ? "首尾帧模式需要上传首帧 ✦" : "首尾帧模式需要上传尾帧 ✦");
      markRequiredField("#dropFiles");
      return;
    }
    const refInput: Record<string, unknown> = {};
    if (imageRefs.length) {
      refInput.imageList = imageRefs;
      refInput.sourceImage = imageRefs[0];
      if (imageRefs.length > 1) refInput.references = imageRefs.slice(1);
    }
    if (tool === "flf") {
      if (firstFrame) refInput.firstFrame = firstFrame;
      if (lastFrame) refInput.lastFrame = lastFrame;
    }
    if (tool === "ref") {
      if (vidRefs.length) refInput.videoReferences = vidRefs;
      if (audRefs.length) refInput.audioReferences = audRefs;
    }

    // all early-return guards passed → latch synchronously (before any state
    // update / the async startGeneration) so a double-click can't double-fire.
    genInFlightRef.current = true;
    setBusy(true);

    const isVid = TOOLS[tool].mode === "t2v";
    // video/audio tools always produce a single result; only image batches honor
    // 生成数量 (the count slider is image-only, but `count` persists across type
    // switches — without this a leftover count>1 would spawn N duplicate cells).
    const n = isVid || isAudio ? 1 : count;
    const label = TOOLS[tool].label;
    const r = isAudio ? "" : ratio; // 音频无画面比例
    const mdl = model;
    const hsh = promptHue(p || audLyrics);
    const spec = isAudio ? "" : isVid ? `${r} · ${res} · ${dur}` : `${r} · ${imgRes}`;
    const hues: MeshHues[] = Array.from(
      { length: n },
      (_, i) => [hsh + i * 36, hsh + i * 36 + 80, hsh + i * 36 + 200] as MeshHues,
    );
    const refThumbs = refThumbsForRun(slotData, hsh);

    // snapshot the exact settings of this run for 重新编辑 / 再次生成.
    lastRunRef.current = {
      prompt: p, model: mdl, tool, curType, ratio: r, imgRes, res, dur, quality, count: n,
      imageRefs, firstFrame, lastFrame, videoRefs: vidRefs, audioRefs: audRefs,
      ...(isAudio && !isSfx
        ? {
            lyrics: audLyrics || undefined,
            songStyle: songStyle.trim() || undefined,
            songTitle: songTitle.trim() || undefined,
            instrumental: instrumental || undefined,
            musicMode,
            sourceClipId: musicTask ? sourceClipId : undefined,
            sourceIsUpload: musicTask && sourceIsUpload ? true : undefined,
            continueAt:
              musicTask === "extend" ? parseInt(continueAt, 10) || undefined : undefined,
          }
        : {}),
    };

    setRunMeta({ prompt: p, model: mdl, ratio: r, spec, count: n, label, isVid, refThumbs });
    setCells(hues.map((h, i) => ({ i, hues: h })));
    setProgs(new Array(n).fill(0));

    // clear any stragglers from a previous run + invalidate its poll.
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    // invalidate any in-flight poll from a previous run (startGeneration/driveRun
    // each take their own run id from here).
    runIdRef.current += 1;

    const selStudio = studioList.find((m) => m.name === model) ?? null;
    const modelId = selStudio?.modelKey || selStudio?.id || "";

    // ── design-preview simulation (no backend model configured) ───────────
    if (!modelId) {
      const simRun = `sim-${Date.now()}`;
      const simTs = new Date().toISOString();
      const local = new Array(n).fill(0);
      const doneLocal = new Array(n).fill(false);
      let doneCountLocal = 0;
      hues.forEach((hu, i) => {
        const speed = 1.4 + Math.random() * 1.2;
        const tick = setInterval(() => {
          local[i] = Math.min(100, local[i] + speed + Math.random() * 3);
          setProgs([...local]);
          if (local[i] >= 100) {
            clearInterval(tick);
            if (doneLocal[i]) return;
            doneLocal[i] = true;
            doneCountLocal += 1;
            pushHistory({
              run: simRun,
              ts: simTs,
              ratio: r,
              hues: hu,
              type: isAudio ? "audio" : isVid ? "video" : "image",
              title: p,
              prompt: p,
              model: mdl,
              params: lastRunRef.current ?? undefined,
            });
            if (doneCountLocal >= n) {
              setBusy(false);
              toast.success("生成完成 · 点击图片放大查看");
            }
          }
        }, 90 + i * 40);
        ticksRef.current.push(tick);
      });
      return;
    }

    // ── real generation: build the input, then hand off to startGeneration
    // (shared task-create → persist → drive path). ────────────────────────
    // 技能:只发 skillId,模板由服务端拼到描述前面(客户端先拼会污染落库的 input,
    // 作品标题/重新编辑读到的就全是模板开头)
    const genPrompt = p;
    const skillInput = skill && skill.outputType === curType ? { skillId: skill.id } : {};
    if (skill && skill.outputType === curType) void skillApi.recordUse(skill.id);
    const input: Record<string, unknown> = isAudio
      ? {
          // 音频：灵感模式只发描述；自定义歌词模式只发歌词/风格/歌名（描述不发，
          // 上游有 lyrics 时本就忽略 input）；延长/翻唱经 extras 传 task 与原曲
          // clip_id（此组合上游不做 tags 歧义校验）；SFX 卡只吃描述。
          ...skillInput,
          ...(p && !musicCustom && !musicTask ? { prompt: genPrompt } : {}),
          ...(audLyrics ? { lyrics: audLyrics } : {}),
          ...((audLyrics || musicTask) && songStyle.trim() ? { tags: songStyle.trim() } : {}),
          ...((audLyrics || musicTask) && songTitle.trim() ? { title: songTitle.trim() } : {}),
          ...(!isSfx && instrumental ? { makeInstrumental: true } : {}),
          ...(musicTask
            ? {
                extras:
                  musicTask === "extend"
                    ? {
                        // 上传登记的本地音频延长走 upload_extend(上游对两种来源分开建模)
                        task: sourceIsUpload ? "upload_extend" : "extend",
                        continue_clip_id: sourceClipId,
                        ...(parseInt(continueAt, 10) > 0
                          ? { continue_at: parseInt(continueAt, 10) }
                          : {}),
                      }
                    : { task: "cover", cover_clip_id: sourceClipId },
              }
            : {}),
        }
      : {
          prompt: genPrompt,
          ...skillInput,
          ...refInput,
          ...(ratioOpts.length ? { aspectRatio: r, aspect_ratio: r, ratio: r } : {}),
          ...(isVid
            ? {
                ...(resOpts.length ? { resolution: res } : {}),
                ...(durOpts.length ? { duration: dur } : {}),
              }
            : {
                ...(resOpts.length ? { clarity: imgRes, resolution: imgRes } : {}),
                ...(qualOpts.length ? { quality } : {}),
              }),
          ...(n > 1 ? { batchCount: n } : {}),
        };
    void startGeneration({
      handler: TOOL_TO_HANDLER[tool],
      modelId,
      input,
      meta: { prompt: p, model: mdl, ratio: r, spec, count: n, isVid, kind: curType, label, hues, refThumbs },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, prompt, count, tool, curType, ratio, model, res, dur, imgRes, quality, musicMode, sourceClipId, sourceIsUpload, continueAt, lyrics, songStyle, songTitle, instrumental, slotData, studioList, ratioOpts, resOpts, durOpts, qualOpts, pushHistory, startGeneration, skill]);

  // Refresh-resume: on mount, if a generation was in flight (persisted at start),
  // restore the generating UI and resume polling — the task keeps running on the
  // server, so a reload no longer loses it.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(ACTIVE_RUN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let saved: ActiveRun | null = null;
    try {
      saved = JSON.parse(raw) as ActiveRun;
    } catch {
      saved = null;
    }
    // taskId 是后端雪花 ID，序列化为字符串（见 ActiveRun.taskId: string）。原先误判
    // typeof !== "number" 恒真，导致刷新后在飞的生成任务总被丢弃、"刷新续跑"永久失效。
    if (!saved || typeof saved.taskId !== "string" || !saved.taskId || !Array.isArray(saved.hues)) {
      try {
        localStorage.removeItem(ACTIVE_RUN_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    let cancelled = false;
    (async () => {
      await ensureSession();
      if (!cancelled) driveRun(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession, driveRun]);

  // tear down the current run's intervals + result state (no busy guard).
  const resetRun = useCallback(() => {
    ticksRef.current.forEach((t) => clearInterval(t));
    ticksRef.current = [];
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    runIdRef.current += 1; // invalidate any in-flight poll for the previous run
    try {
      localStorage.removeItem(ACTIVE_RUN_KEY); // a cancelled/cleared run won't resume on refresh
    } catch {
      /* ignore */
    }
    setCells([]);
    setProgs([]);
    setRunMeta(null);
  }, []);

  return {
    busy,
    cells,
    progs,
    runMeta,
    setCells,
    setProgs,
    setRunMeta,
    generate,
    oneClickEdit,
    resetRun,
    lastRunRef,
  };
}
