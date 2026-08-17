"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Loader2, Play, ScanLine, Square } from "lucide-react";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { notifyAssetLibraryChanged } from "@/lib/asset-library-events";
import { requestCanvasFocusPoint } from "@/lib/canvas-navigation";
import { captureVideoFrame, VideoFrameError } from "@/lib/video-frame";
import { useAuthStore } from "@/stores/use-auth-store";
import {
  GROUP_COLORS,
  generateGroupId,
  generateNodeId,
  useCanvasStore,
  type CanvasNode,
} from "@/stores/use-canvas-store";
import type { AiTaskVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodeShell } from "./shared/node-overlays";
import type { CanvasNodeProps } from "./types/node-props";
import {
  BREAKDOWN_NODE_HEIGHT,
  BREAKDOWN_NODE_WIDTH,
  STORYBOARD_FRAME_COUNTS,
  buildStoryboardAnalysisPrompt,
  buildStoryboardOutputs,
  formatStoryboardTime,
  isStoryboardBreakdownConfigNormalized,
  normalizeStoryboardBreakdownConfig,
  parseStoryboardAnalysis,
  sampleStoryboardTimes,
  selectStoryboardAnalysisModel,
  storyboardAnalysisModelConfidence,
  storyboardAnalysisCoverageWarning,
  type StoryboardAnalysisMode,
  type StoryboardFrameAnalysis,
  type StoryboardUploadedFrame,
} from "./video-frame-breakdown";
import {
  awaitStoryboardAnalysisTask,
  cleanupStoryboardFrameTasks,
} from "./storyboard-analysis-task";

const DENSITY_LABELS = {
  6: "精简",
  12: "标准",
  20: "细致",
} as const satisfies Record<(typeof STORYBOARD_FRAME_COUNTS)[number], string>;
const DENSITIES = STORYBOARD_FRAME_COUNTS.map((count) => ({ count, label: DENSITY_LABELS[count] }));

const ANALYSIS_MODES: Array<{ value: StoryboardAnalysisMode; label: string; title: string }> = [
  { value: "storyboard", label: "分镜", title: "分析景别与画面内容" },
  { value: "motion", label: "动态", title: "分析镜头和主体运动" },
  { value: "music", label: "音乐", title: "按画面情绪给出配乐建议" },
];

function taskText(task: AiTaskVO): string {
  let meta: Record<string, unknown> = {};
  if (typeof task.resultMeta === "string") {
    try { meta = JSON.parse(task.resultMeta) as Record<string, unknown>; } catch { return ""; }
  } else if (task.resultMeta && typeof task.resultMeta === "object") {
    meta = task.resultMeta;
  }
  return typeof meta.text === "string" ? meta.text : "";
}

async function prepareStoryboardFrame(
  captured: { blob: Blob; width: number; height: number },
): Promise<{ blob: Blob; width: number; height: number; extension: "jpg" | "png"; mimeType: string }> {
  if (typeof createImageBitmap !== "function") {
    return { ...captured, extension: "png", mimeType: "image/png" };
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(captured.blob);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob
      ? { blob, width, height, extension: "jpg", mimeType: "image/jpeg" }
      : { ...captured, extension: "png", mimeType: "image/png" };
  } catch {
    return { ...captured, extension: "png", mimeType: "image/png" };
  } finally {
    bitmap?.close();
  }
}

async function analyzeStoryboardFrames(
  nodeId: string,
  frames: readonly StoryboardUploadedFrame[],
  modes: readonly StoryboardAnalysisMode[],
  active: () => boolean,
  onTaskCreated: (taskId: string) => void,
  onTaskReleased: (taskId: string) => void,
): Promise<StoryboardFrameAnalysis[]> {
  const modelsResponse = await aiApi.listModels();
  const model = modelsResponse.success ? selectStoryboardAnalysisModel(modelsResponse.data) : undefined;
  if (!model) throw new Error("未配置支持图片输入的文本模型，请联系管理员");
  if (!active()) return [];

  const created = await aiApi.generateIdempotent({
    handler: "skill_text_completion",
    modelId: model.modelId,
    entryPoint: "canvas",
    targetType: "text",
    input: {
      systemPrompt: "你是专业影视拉片师。严格依据输入画面做镜头分析，使用简体中文，不臆造未出现的内容。",
      prompt: buildStoryboardAnalysisPrompt(frames.map((frame) => frame.timeSec), modes),
      imageUrls: frames.map((frame) => frame.url),
      strictJson: true,
    },
  }, `canvas-storyboard:${nodeId}:${Date.now()}`);
  if (!created.success || !created.data?.id) {
    throw new Error(created.message || "镜头语义分析任务创建失败");
  }

  const taskId = String(created.data.id);
  const task = await awaitStoryboardAnalysisTask<AiTaskVO>({
    taskId,
    active,
    getTask: async (id) => {
      const response = await aiApi.getTask(id);
      return response.success && response.data ? response.data : null;
    },
    cancelTask: (id) => aiApi.cancelTask(id),
    onClaim: onTaskCreated,
    onRelease: onTaskReleased,
  });
  if (!task) return [];
  const analysis = parseStoryboardAnalysis(taskText(task), frames.length);
  if (!analysis.length) throw new Error("镜头语义分析结果格式无效");
  return analysis;
}

export const VideoBreakdownNode = memo(function VideoBreakdownNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
  onNodeMouseDown,
  onPortMouseDown,
}: CanvasNodeProps) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const videoInputJSON = useCanvasStore((state) => {
    const sources = state.connections
      .filter((connection) => connection.targetId === node.id)
      .map((connection) => state.nodes.find((candidate) => candidate.id === connection.sourceId))
      .filter((candidate) => candidate?.type === "video" && candidate.videoSrc);
    // Connections are appended chronologically. If a legacy canvas contains
    // more than one input, the most recently connected video is the user's
    // latest intent; choosing the oldest makes a replacement look ineffective.
    const source = sources.at(-1);
    return JSON.stringify({ id: source?.id ?? "", src: source?.videoSrc ?? "", count: sources.length });
  });
  const videoInput = JSON.parse(videoInputJSON) as { id: string; src: string; count: number };
  const sourceVideoId = videoInput.id;
  const sourceVideoSrc = videoInput.src;

  const [videoMeta, setVideoMeta] = useState({ src: "", duration: 0, w: 0, h: 0 });
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState<"frames" | "analysis">("frames");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [analysisPointCost, setAnalysisPointCost] = useState<number | null>(null);
  const [analysisModelConfidence, setAnalysisModelConfidence] = useState<"vision" | "chat-fallback" | null>(null);
  const [analysisModelStatus, setAnalysisModelStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const runRef = useRef(0);
  const breakdownBusyRef = useRef(false);
  const analysisTaskIdRef = useRef<string | null>(null);
  const modelCheckRef = useRef(0);
  const breakdownConfig = useMemo(
    () => normalizeStoryboardBreakdownConfig(node.videoBreakdown),
    [node.videoBreakdown],
  );
  const { frameCount, framesPerGroup, analysisModes } = breakdownConfig;

  const duration = videoMeta.src === sourceVideoSrc ? videoMeta.duration : 0;
  const dims = videoMeta.src === sourceVideoSrc
    ? { w: videoMeta.w, h: videoMeta.h }
    : { w: 0, h: 0 };

  const refreshAnalysisModel = useCallback(async () => {
    const check = ++modelCheckRef.current;
    setAnalysisModelStatus("loading");
    setAnalysisPointCost(null);
    setAnalysisModelConfidence(null);
    try {
      const response = await aiApi.listModels();
      if (modelCheckRef.current !== check) return;
      if (!response.success) {
        setAnalysisModelStatus("error");
        return;
      }
      const model = selectStoryboardAnalysisModel(response.data);
      if (!model) {
        setAnalysisModelStatus("unavailable");
        return;
      }
      setAnalysisPointCost(Math.max(0, Number(model.pointCost) || 0));
      setAnalysisModelConfidence(storyboardAnalysisModelConfidence(model));
      setAnalysisModelStatus("ready");
    } catch {
      if (modelCheckRef.current === check) setAnalysisModelStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshAnalysisModel();
    return () => { modelCheckRef.current += 1; };
  }, [refreshAnalysisModel]);

  // 同步旧画布里持久化的历史尺寸与参数：避免卡片扩容后端口仍停留在旧区域，
  // 也防止异常 JSON 让密度无选中态、分组越界或重复拉片编号拼成字符串。
  useEffect(() => {
    const sizeChanged = node.width !== BREAKDOWN_NODE_WIDTH
      || node.height !== BREAKDOWN_NODE_HEIGHT
      || node.contentW !== BREAKDOWN_NODE_WIDTH
      || node.contentH !== BREAKDOWN_NODE_HEIGHT;
    const configChanged = !isStoryboardBreakdownConfigNormalized(node.videoBreakdown);
    if (sizeChanged || configChanged) {
      updateNode(node.id, {
        width: BREAKDOWN_NODE_WIDTH,
        height: BREAKDOWN_NODE_HEIGHT,
        contentW: BREAKDOWN_NODE_WIDTH,
        contentH: BREAKDOWN_NODE_HEIGHT,
        ...(configChanged ? {
          videoBreakdown: {
            ...node.videoBreakdown,
            ...breakdownConfig,
          },
        } : {}),
      }, false);
    }
  }, [breakdownConfig, node.contentH, node.contentW, node.height, node.id, node.videoBreakdown, node.width, updateNode]);

  useEffect(() => {
    runRef.current += 1;
    if (analysisTaskIdRef.current) void aiApi.cancelTask(analysisTaskIdRef.current).catch(() => undefined);
    analysisTaskIdRef.current = null;
    breakdownBusyRef.current = false;
    setAnalyzing(false);
    setProgress({ done: 0, total: 0 });
    setVideoMeta({ src: "", duration: 0, w: 0, h: 0 });
    setVideoLoadError(false);
  }, [sourceVideoId, sourceVideoSrc]);

  useEffect(() => () => {
    runRef.current += 1;
    breakdownBusyRef.current = false;
    if (analysisTaskIdRef.current) void aiApi.cancelTask(analysisTaskIdRef.current).catch(() => undefined);
    analysisTaskIdRef.current = null;
  }, []);

  const patchBreakdownConfig = useCallback((patch: Partial<NonNullable<CanvasNode["videoBreakdown"]>>) => {
    updateNode(node.id, {
      videoBreakdown: {
        ...node.videoBreakdown,
        ...breakdownConfig,
        ...patch,
      },
    }, true);
  }, [breakdownConfig, node.id, node.videoBreakdown, updateNode]);

  const toggleAnalysisMode = useCallback((mode: StoryboardAnalysisMode) => {
    const next = analysisModes.includes(mode)
      ? analysisModes.filter((item) => item !== mode)
      : [...analysisModes, mode];
    if (!next.length) {
      toast.info("至少保留一个分析维度");
      return;
    }
    patchBreakdownConfig({ analysisModes: next });
  }, [analysisModes, patchBreakdownConfig]);

  const cancelBreakdown = useCallback(() => {
    if (!analyzing) return;
    runRef.current += 1;
    const taskId = analysisTaskIdRef.current;
    analysisTaskIdRef.current = null;
    breakdownBusyRef.current = false;
    if (taskId) void aiApi.cancelTask(taskId).catch(() => undefined);
    setAnalyzing(false);
    setStage("frames");
    setProgress({ done: 0, total: 0 });
    toast.info("已停止逐帧拉片");
  }, [analyzing]);

  const startBreakdown = useCallback(async () => {
    if (analyzing || breakdownBusyRef.current) return;
    if (!sourceVideoSrc || !sourceVideoId) {
      toast.error("请先连接一个已生成的视频节点");
      return;
    }
    if (!duration) {
      if (videoLoadError) toast.error("视频读取失败，请检查源视频后重试");
      else toast.info("视频信息仍在读取，请稍后再试");
      return;
    }

    const times = sampleStoryboardTimes(duration, frameCount);
    if (times.length === 0) return;
    const run = ++runRef.current;
    breakdownBusyRef.current = true;
    const sourceAtStart = sourceVideoSrc;
    const active = () => {
      if (runRef.current !== run) return false;
      const state = useCanvasStore.getState();
      const source = state.nodes.find((candidate) => candidate.id === sourceVideoId);
      return state.nodes.some((candidate) => candidate.id === node.id)
        && source?.videoSrc === sourceAtStart
        && state.connections.some((connection) => connection.sourceId === sourceVideoId && connection.targetId === node.id);
    };

    setAnalyzing(true);
    setStage("frames");
    setProgress({ done: 0, total: times.length });
    const frames: StoryboardUploadedFrame[] = [];
    const capturedTaskIds: string[] = [];
    let outputsCommitted = false;
    let analysisWarning = "";

    try {
      if (!(await useAuthStore.getState().ensureSession())) return;
      if (!active()) return;

      for (let index = 0; index < times.length; index += 1) {
        if (!active()) return;
        const timeSec = times[index];
        const captured = await captureVideoFrame(sourceAtStart, timeSec);
        if (!active()) return;
        const prepared = await prepareStoryboardFrame(captured);
        if (!active()) return;
        const filename = `storyboard-${String(index + 1).padStart(2, "0")}-${timeSec.toFixed(2)}s.${prepared.extension}`;
        const uploaded = await uploadFileSmart(new File([prepared.blob], filename, { type: prepared.mimeType }));
        if (!uploaded.success || !uploaded.data) {
          throw new Error(uploaded.message || `第 ${index + 1} 帧上传失败`);
        }
        if (!active()) {
          await fileApi.delete(uploaded.data.id).catch(() => undefined);
          return;
        }
        const registered = await aiApi.registerCapturedFrame({
          fileId: uploaded.data.id,
          captureTime: timeSec,
          width: prepared.width,
          height: prepared.height,
        });
        if (!registered.success || !registered.data?.id) {
          // If registration really failed the upload is still a File row and can
          // be removed. If the response was lost after commit, this is a harmless
          // 404 because the server already transferred ownership to the task.
          await fileApi.delete(uploaded.data.id).catch(() => undefined);
          throw new Error(registered.message || `第 ${index + 1} 帧保存到生成历史失败`);
        }
        capturedTaskIds.push(String(registered.data.id));
        if (!active()) return;
        frames.push({
          url: uploaded.data.fileUrl,
          fileSize: uploaded.data.fileSize,
          fileType: uploaded.data.fileType,
          mimeType: uploaded.data.mimeType,
          width: prepared.width,
          height: prepared.height,
          timeSec,
        });
        setProgress({ done: index + 1, total: times.length });
      }

      if (!active()) return;
      // 每次运行都重新确认一次模型：管理员可能在节点创建后才启用视觉模型。
      // 分析失败只降级为纯帧输出，不回滚已经成功提取的画面。
      setStage("analysis");
      try {
        const analyses = await analyzeStoryboardFrames(
          node.id,
          frames,
          analysisModes,
          active,
          (taskId) => { analysisTaskIdRef.current = taskId; },
          (taskId) => {
            if (analysisTaskIdRef.current === taskId) analysisTaskIdRef.current = null;
          },
        );
        const byIndex = new Map(analyses.map((item) => [item.index, item]));
        frames.forEach((frame, index) => { frame.analysis = byIndex.get(index + 1); });
        analysisWarning = storyboardAnalysisCoverageWarning(analyses.length, frames.length);
      } catch (error) {
        analysisWarning = error instanceof Error ? error.message : "镜头语义分析不可用";
        if (active()) {
          setAnalysisModelStatus("error");
          setAnalysisPointCost(null);
        }
      }
      if (active() && analysisModelStatus !== "ready") void refreshAnalysisModel();

      if (!active()) return;
      const state = useCanvasStore.getState();
      const processor = state.nodes.find((candidate) => candidate.id === node.id);
      if (!processor) return;
      const runNumber = normalizeStoryboardBreakdownConfig(processor.videoBreakdown).runCount + 1;
      const outputs = buildStoryboardOutputs({
        processor,
        sourceVideoId,
        frames,
        framesPerGroup,
        existingGroupCount: state.groups.length,
        existingNodes: state.nodes,
        runNumber,
        colors: GROUP_COLORS,
        makeNodeId: generateNodeId,
        makeGroupId: generateGroupId,
      });
      const firstOutput = outputs.nodes[0];
      state.addNodesAndConnections(outputs.nodes, outputs.connections, firstOutput?.id ?? node.id, outputs.groups);
      state.updateNode(node.id, {
        videoBreakdown: {
          frameCount,
          framesPerGroup,
          lastFrameCount: frames.length,
          runCount: runNumber,
          analysisModes,
        },
      }, false);
      outputsCommitted = true;
      notifyAssetLibraryChanged({ collection: "hist", mediaKind: "image", origin: "capture" });
      if (firstOutput) {
        requestCanvasFocusPoint({
          x: firstOutput.x + firstOutput.width / 2,
          y: firstOutput.y + firstOutput.height / 2,
        });
      }
      if (analysisWarning) {
        toast.success(`已提取 ${frames.length} 张分镜帧；${analysisWarning}`);
      } else {
        toast.success(`拉片完成，已生成并分析 ${frames.length} 张分镜帧`);
      }
    } catch (error) {
      if (!active()) return;
      const message = error instanceof VideoFrameError
        ? error.message
        : error instanceof Error && error.message
          ? error.message
          : "逐帧拉片失败，请重试";
      toast.error(message);
    } finally {
      if (!outputsCommitted && capturedTaskIds.length) {
        await cleanupStoryboardFrameTasks(capturedTaskIds, (taskId) => aiApi.cancelTask(taskId));
        notifyAssetLibraryChanged({ collection: "hist", mediaKind: "image", origin: "capture" });
      }
      if (runRef.current === run) {
        breakdownBusyRef.current = false;
        setAnalyzing(false);
      }
    }
  }, [analysisModelStatus, analysisModes, analyzing, duration, frameCount, framesPerGroup, node.id, refreshAnalysisModel, sourceVideoId, sourceVideoSrc, videoLoadError]);

  const progressPct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;
  const idleActionLabel = `${node.videoBreakdown?.lastFrameCount ? "重新拉片" : "开始拉片"} · ${frameCount} 帧`;
  const analysisStatusLabel = analysisModelStatus === "loading"
    ? "正在检测 AI 标注"
    : analysisModelStatus === "ready"
      ? `${analysisModelConfidence === "chat-fallback" ? "尝试 AI 标注" : "AI 标注可用"}${analysisPointCost != null ? ` · ${Math.ceil(analysisPointCost)} 积分` : ""}`
      : analysisModelStatus === "unavailable"
        ? "无视觉模型 · 重试"
        : "AI 标注失败 · 重试";
  const analysisStatusRetryable = analysisModelStatus === "unavailable" || analysisModelStatus === "error";
  const actionDisabled = !sourceVideoSrc;
  const actionTitle = !sourceVideoSrc
    ? "请先连接一个已生成的视频节点"
    : `均匀提取 ${frameCount} 帧并生成分镜组`;
  const stopInteraction = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      <div className="relative" style={{ width: BREAKDOWN_NODE_WIDTH }}>
        <div
          className={`relative flex flex-col overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 transition-[box-shadow] duration-150 motion-reduce:transition-none dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70"
              : isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600"
                : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ width: BREAKDOWN_NODE_WIDTH, height: BREAKDOWN_NODE_HEIGHT }}
        >
          <div className="aspect-video shrink-0 bg-neutral-950">
            {sourceVideoSrc ? (
              <CapturableVideo
                src={sourceVideoSrc}
                muted
                playsInline
                preload="metadata"
                controls
                showFrameCapture={false}
                disablePictureInPicture
                controlsList="nodownload noremoteplayback"
                className="h-full w-full object-contain"
                onPointerDown={stopInteraction}
                onMouseDown={stopInteraction}
                onClick={stopInteraction}
                onLoadedMetadata={(event) => {
                  const mediaDuration = event.currentTarget.duration;
                  setVideoLoadError(false);
                  setVideoMeta({
                    src: sourceVideoSrc,
                    duration: Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 0,
                    w: event.currentTarget.videoWidth,
                    h: event.currentTarget.videoHeight,
                  });
                }}
                onError={() => setVideoLoadError(true)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
                <Play className="h-8 w-8" fill="currentColor" aria-hidden />
                <span className="text-xs">连接视频后开始拉片</span>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <div className="flex shrink-0 items-center justify-between gap-3 text-[11px] leading-none text-neutral-500 dark:text-neutral-400">
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap" title={videoInput.count > 1 ? "连接了多个视频，使用最近连接的一个" : undefined}>
                <Film className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="font-medium text-neutral-700 dark:text-neutral-200">
                  {duration > 0 ? formatStoryboardTime(duration) : videoLoadError ? "视频读取失败" : "正在读取视频"}
                </span>
                <span className="text-neutral-300 dark:text-neutral-700">/</span>
                <span>{dims.w && dims.h ? `${dims.w} × ${dims.h}` : "原始分辨率"}</span>
                {videoInput.count > 1 ? <span>· 最近连接 / {videoInput.count}</span> : null}
              </span>
              <button
                type="button"
                onMouseDown={stopInteraction}
                onClick={(event) => {
                  event.stopPropagation();
                  if (analysisStatusRetryable) void refreshAnalysisModel();
                }}
                disabled={!analysisStatusRetryable}
                title={analysisStatusRetryable
                  ? "重新检测 AI 标注模型"
                  : analysisModelConfidence === "chat-fallback"
                    ? "模型目录未声明图片能力，将尝试分析；不支持时仍会保留抽取的帧"
                    : analysisStatusLabel}
                className="shrink-0 whitespace-nowrap text-[10px] text-neutral-400 disabled:cursor-default dark:text-neutral-500"
              >
                {analysisStatusLabel}
              </button>
            </div>

            <div className="shrink-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/50">
              <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 px-3 py-1">
                <span className="w-14 shrink-0 text-[11px] font-medium leading-none text-neutral-500 dark:text-neutral-400">分析维度</span>
                <div className="flex h-8 min-w-0 gap-0.5 rounded-lg bg-neutral-200/60 p-0.5 dark:bg-neutral-950" role="group" aria-label="分析维度">
                  {ANALYSIS_MODES.map((mode) => {
                    const active = analysisModes.includes(mode.value);
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        title={mode.title}
                        aria-pressed={active}
                        onMouseDown={stopInteraction}
                        onClick={(event) => { event.stopPropagation(); toggleAnalysisMode(mode.value); }}
                        disabled={analyzing}
                        className={`min-w-0 flex-1 whitespace-nowrap rounded-md px-1.5 text-[11px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${active
                          ? "bg-white font-medium text-neutral-900 shadow-sm ring-1 ring-black/[0.04] dark:bg-neutral-700 dark:text-white dark:ring-white/10"
                          : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"}`}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3 border-t border-neutral-200/70 px-3 py-1 dark:border-neutral-800">
                <span className="w-14 shrink-0 text-[11px] font-medium leading-none text-neutral-500 dark:text-neutral-400">抽帧数量</span>
                <div className="grid h-8 min-w-0 grid-cols-3 gap-0.5 rounded-lg bg-neutral-200/60 p-0.5 dark:bg-neutral-950" role="group" aria-label="拉片密度">
                  {DENSITIES.map((density) => {
                    const active = frameCount === density.count;
                    return (
                      <button
                        key={density.count}
                        type="button"
                        aria-pressed={active}
                        onMouseDown={stopInteraction}
                        onClick={(event) => { event.stopPropagation(); patchBreakdownConfig({ frameCount: density.count }); }}
                        disabled={analyzing}
                        className={`flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1 text-[11px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${
                          active
                            ? "bg-white font-medium text-neutral-900 shadow-sm ring-1 ring-black/[0.04] dark:bg-neutral-700 dark:text-white dark:ring-white/10"
                            : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                        }`}
                      >
                        <span className="font-medium tabular-nums">{density.count} 帧</span>
                        <span className={active ? "text-neutral-500 dark:text-neutral-300" : "text-neutral-400 dark:text-neutral-500"}>{density.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-neutral-200/70 px-3 py-1 text-[10px] leading-none text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
                <span>均匀取帧 · 不改动源视频</span>
                <span>每 {framesPerGroup} 帧一组</span>
              </div>
            </div>
            <button
              type="button"
              onMouseDown={stopInteraction}
              onClick={(event) => {
                event.stopPropagation();
                if (analyzing) cancelBreakdown();
                else void startBreakdown();
              }}
              disabled={actionDisabled}
              title={actionTitle}
              aria-busy={analyzing}
              className={`relative mt-auto flex h-10 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${analyzing
                ? "bg-neutral-700 text-white hover:bg-neutral-600 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
                : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"}`}
            >
              <span className="relative z-[1] flex items-center gap-2" aria-live="polite">
                {analyzing
                  ? stage === "analysis"
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    : <Square className="h-3 w-3 fill-current" aria-hidden />
                  : <ScanLine className="h-3.5 w-3.5" aria-hidden />}
                {analyzing
                  ? stage === "analysis" ? "语义分析中 · 点击停止" : `停止拉片 · ${progress.done}/${progress.total} · ${progressPct}%`
                  : idleActionLabel}
              </span>
              {analyzing && stage === "frames" && (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/35 transition-transform duration-200 motion-reduce:transition-none dark:bg-neutral-900/30"
                  style={{ transform: `scaleX(${progressPct / 100})` }}
                  aria-hidden
                />
              )}
            </button>
          </div>
        </div>
        <NodeHeader icon={ScanLine} title={node.title || "逐帧拉片"} visible={isSelected && !isDragging} overlay />
        <NodePorts
          nodeId={node.id}
          visible={isSelected && !isDragging}
          overlay
          onPortMouseDown={onPortMouseDown}
          inputTitle="连接待拉片视频"
          outputTitle="连接分镜帧"
        />
      </div>
    </NodeShell>
  );
});
