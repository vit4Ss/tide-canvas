"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, Play, ScanLine, Square } from "lucide-react";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { notifyAssetLibraryChanged } from "@/lib/asset-library-events";
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
  buildStoryboardAnalysisPrompt,
  buildStoryboardOutputs,
  formatStoryboardTime,
  parseStoryboardAnalysis,
  sampleStoryboardTimes,
  selectStoryboardAnalysisModel,
  type StoryboardAnalysisMode,
  type StoryboardFrameAnalysis,
  type StoryboardUploadedFrame,
} from "./video-frame-breakdown";
import {
  awaitStoryboardAnalysisTask,
  cleanupStoryboardFrameTasks,
} from "./storyboard-analysis-task";

const DENSITIES = [
  { count: 6, label: "精简" },
  { count: 12, label: "标准" },
  { count: 20, label: "细致" },
] as const;

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
    const source = sources[0];
    return JSON.stringify({ id: source?.id ?? "", src: source?.videoSrc ?? "", count: sources.length });
  });
  const videoInput = JSON.parse(videoInputJSON) as { id: string; src: string; count: number };
  const sourceVideoId = videoInput.id;
  const sourceVideoSrc = videoInput.src;

  const [videoMeta, setVideoMeta] = useState({ src: "", duration: 0, w: 0, h: 0 });
  const [analyzing, setAnalyzing] = useState(false);
  const [stage, setStage] = useState<"frames" | "analysis">("frames");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [analysisPointCost, setAnalysisPointCost] = useState<number | null>(null);
  const [analysisModelStatus, setAnalysisModelStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const runRef = useRef(0);
  const analysisTaskIdRef = useRef<string | null>(null);
  const modelCheckRef = useRef(0);
  const frameCount = node.videoBreakdown?.frameCount ?? 12;
  const framesPerGroup = node.videoBreakdown?.framesPerGroup ?? 4;
  const analysisModes = node.videoBreakdown?.analysisModes?.length
    ? node.videoBreakdown.analysisModes
    : ["storyboard", "motion"] satisfies StoryboardAnalysisMode[];

  const duration = videoMeta.src === sourceVideoSrc ? videoMeta.duration : 0;
  const dims = videoMeta.src === sourceVideoSrc
    ? { w: videoMeta.w, h: videoMeta.h }
    : { w: 0, h: 0 };

  const refreshAnalysisModel = useCallback(async () => {
    const check = ++modelCheckRef.current;
    setAnalysisModelStatus("loading");
    setAnalysisPointCost(null);
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
      setAnalysisModelStatus("ready");
    } catch {
      if (modelCheckRef.current === check) setAnalysisModelStatus("error");
    }
  }, []);

  useEffect(() => {
    void refreshAnalysisModel();
    return () => { modelCheckRef.current += 1; };
  }, [refreshAnalysisModel]);

  useEffect(() => {
    runRef.current += 1;
    if (analysisTaskIdRef.current) void aiApi.cancelTask(analysisTaskIdRef.current).catch(() => undefined);
    analysisTaskIdRef.current = null;
    setAnalyzing(false);
    setProgress({ done: 0, total: 0 });
    setVideoMeta({ src: "", duration: 0, w: 0, h: 0 });
  }, [sourceVideoId, sourceVideoSrc]);

  useEffect(() => () => {
    runRef.current += 1;
    if (analysisTaskIdRef.current) void aiApi.cancelTask(analysisTaskIdRef.current).catch(() => undefined);
    analysisTaskIdRef.current = null;
  }, []);

  const patchBreakdownConfig = useCallback((patch: Partial<NonNullable<CanvasNode["videoBreakdown"]>>) => {
    updateNode(node.id, {
      videoBreakdown: {
        frameCount,
        framesPerGroup,
        ...node.videoBreakdown,
        ...patch,
      },
    }, true);
  }, [frameCount, framesPerGroup, node.id, node.videoBreakdown, updateNode]);

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
    if (taskId) void aiApi.cancelTask(taskId).catch(() => undefined);
    setAnalyzing(false);
    setStage("frames");
    setProgress({ done: 0, total: 0 });
    toast.info("已停止逐帧拉片");
  }, [analyzing]);

  const startBreakdown = useCallback(async () => {
    if (analyzing) return;
    if (!sourceVideoSrc || !sourceVideoId) {
      toast.error("请先连接一个已生成的视频节点");
      return;
    }
    if (analysisModelStatus !== "ready") {
      if (analysisModelStatus === "loading") toast.info("正在检查语义分析模型，请稍后");
      else if (analysisModelStatus === "unavailable") toast.error("未配置支持图片输入的文本模型，请联系管理员");
      else void refreshAnalysisModel();
      return;
    }
    if (!duration) {
      toast.info("视频信息仍在读取，请稍后再试");
      return;
    }
    if (!(await useAuthStore.getState().ensureSession())) return;

    const times = sampleStoryboardTimes(duration, frameCount);
    if (times.length === 0) return;
    const run = ++runRef.current;
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
      } catch (error) {
        analysisWarning = error instanceof Error ? error.message : "镜头语义分析不可用";
      }

      if (!active()) return;
      const state = useCanvasStore.getState();
      const processor = state.nodes.find((candidate) => candidate.id === node.id);
      if (!processor) return;
      const runNumber = (processor.videoBreakdown?.runCount ?? 0) + 1;
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
      state.addNodesAndConnections(outputs.nodes, outputs.connections, node.id, outputs.groups);
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
      if (analysisWarning) {
        toast.info(`已生成 ${frames.length} 张分镜帧；${analysisWarning}，本次未添加语义标注`);
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
      if (runRef.current === run) setAnalyzing(false);
    }
  }, [analysisModelStatus, analysisModes, analyzing, duration, frameCount, framesPerGroup, node.id, refreshAnalysisModel, sourceVideoId, sourceVideoSrc]);

  const progressPct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;
  const idleActionLabel = analysisModelStatus === "loading"
    ? "正在检查语义模型"
    : analysisModelStatus === "unavailable"
      ? "未配置视觉模型"
      : analysisModelStatus === "error"
        ? "模型检查失败 · 重试"
        : `${node.videoBreakdown?.lastFrameCount ? "再次拉片" : "开始拉片"}${analysisPointCost != null ? ` · ${Math.ceil(analysisPointCost)} 积分` : ""}`;
  const actionDisabled = !sourceVideoSrc
    || (!analyzing && (analysisModelStatus === "loading" || analysisModelStatus === "unavailable"));
  const actionTitle = !sourceVideoSrc
    ? "请先连接一个已生成的视频节点"
    : analysisModelStatus === "loading"
      ? "正在检查语义分析模型"
      : analysisModelStatus === "unavailable"
        ? "未配置支持图片输入的文本模型，请联系管理员"
        : analysisModelStatus === "error"
          ? "重新检查语义分析模型"
          : undefined;
  const stopInteraction = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      <div className="relative" style={{ width: BREAKDOWN_NODE_WIDTH }}>
        <div
          className={`relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-[box-shadow] duration-150 motion-reduce:transition-none dark:bg-neutral-950 ${
            isConnectTarget ? "ring-2 ring-blue-500/70"
              : isSelected ? "ring-2 ring-neutral-400 dark:ring-neutral-600"
                : "ring-neutral-200 hover:ring-neutral-300 dark:ring-neutral-800 dark:hover:ring-neutral-700"
          }`}
          style={{ width: BREAKDOWN_NODE_WIDTH, height: BREAKDOWN_NODE_HEIGHT }}
        >
          <div className="h-[138px] bg-neutral-950">
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
                  setVideoMeta({
                    src: sourceVideoSrc,
                    duration: Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 0,
                    w: event.currentTarget.videoWidth,
                    h: event.currentTarget.videoHeight,
                  });
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
                <Play className="h-8 w-8" fill="currentColor" aria-hidden />
                <span className="text-xs">连接视频后开始拉片</span>
              </div>
            )}
          </div>

          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
              <span className="flex min-w-0 items-center gap-1.5" title={videoInput.count > 1 ? "连接了多个视频，仅使用第一个" : undefined}>
                <Film className="h-3.5 w-3.5 shrink-0" />
                {duration > 0 ? formatStoryboardTime(duration) : "等待视频"}
                {videoInput.count > 1 ? ` · 使用第 1/${videoInput.count} 个` : ""}
              </span>
              <span>{dims.w && dims.h ? `${dims.w} × ${dims.h}` : "原始分辨率"}</span>
            </div>
            <div className="border-t border-neutral-100 pt-1.5 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              语义分析仅使用画面帧；配乐维度输出画面情绪建议
            </div>
            <div className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">分析</span>
              <div className="flex min-w-0 flex-1 gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-900" role="group" aria-label="分析维度">
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
                      className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${active
                        ? "bg-white font-medium text-neutral-900 dark:bg-neutral-700 dark:text-white"
                        : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"}`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">密度</span>
              <div className="flex min-w-0 flex-1 gap-1.5" role="group" aria-label="拉片密度">
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
                      className={`flex-1 rounded-lg border px-2 py-1 text-[11px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${
                        active
                          ? "border-neutral-900 bg-neutral-900 font-medium text-white dark:border-white dark:bg-white dark:text-neutral-900"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
                      }`}
                    >
                      {density.label} · {density.count} 帧
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              onMouseDown={stopInteraction}
              onClick={(event) => {
                event.stopPropagation();
                if (analyzing) cancelBreakdown();
                else if (analysisModelStatus === "error") void refreshAnalysisModel();
                else void startBreakdown();
              }}
              disabled={actionDisabled}
              title={actionTitle}
              aria-busy={analyzing}
              className={`relative flex h-8 w-full items-center justify-center overflow-hidden rounded-lg text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:focus-visible:ring-neutral-600 ${analyzing
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
