import type { CanvasGroup, CanvasNode, Connection } from "@/stores/use-canvas-store";
import type { AiModelVO } from "@/types/ai";

export const STORYBOARD_FRAME_WIDTH = 280;
export const BREAKDOWN_NODE_WIDTH = 360;
export const BREAKDOWN_NODE_HEIGHT = 326;

export type StoryboardAnalysisMode = "storyboard" | "motion" | "music";

export interface StoryboardFrameAnalysis {
  index: number;
  shotSize?: string;
  motion?: string;
  description?: string;
  musicCue?: string;
}

export interface StoryboardUploadedFrame {
  url: string;
  fileSize?: number;
  fileType?: string;
  mimeType?: string;
  width: number;
  height: number;
  timeSec: number;
  analysis?: StoryboardFrameAnalysis;
}

function storyboardVisionCapability(model: Pick<AiModelVO, "config">): boolean {
  try {
    const config = JSON.parse(model.config || "{}") as Record<string, unknown>;
    if (config.vision === true || config.multimodal === true || config.imageInput === true) return true;
    const capabilityValues = [config.capabilities, config.inputModalities, config.modalities]
      .flatMap((value) => Array.isArray(value) ? value : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase().replace(/[\s_]+/g, "-"));
    return capabilityValues.some((value) =>
      value === "vision"
      || value === "multimodal"
      || value === "image"
      || value === "image-input"
      || value === "image-understanding"
      || value === "visual-understanding");
  } catch {
    return false;
  }
}

/** Pick only a text-completion model explicitly configured for image input. */
export function selectStoryboardAnalysisModel(models: readonly AiModelVO[]): AiModelVO | undefined {
  return models.find((candidate) =>
    candidate.type === "text"
    && (!candidate.supportedHandlers?.length || candidate.supportedHandlers.includes("skill_text_completion"))
    && storyboardVisionCapability(candidate),
  );
}

export function sampleStoryboardTimes(duration: number, frameCount: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.max(1, Math.min(24, Math.round(frameCount)));
  const latest = Math.max(0, duration - 0.02);
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = Math.min(latest, ((index + 0.5) / count) * duration);
    if (!times.length || Math.abs(time - times[times.length - 1]) >= 0.001) times.push(time);
  }
  return times;
}

export function formatStoryboardTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const roundedTenths = Math.round(safe * 10);
  const minutes = Math.floor(roundedTenths / 600);
  const rest = (roundedTenths - minutes * 600) / 10;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function buildStoryboardAnalysisPrompt(
  times: readonly number[],
  modes: readonly StoryboardAnalysisMode[],
): string {
  const requested = [
    modes.includes("storyboard") ? "景别与画面内容" : "画面内容",
    modes.includes("motion") ? "镜头或主体运动" : "",
    modes.includes("music") ? "匹配画面情绪的配乐建议（仅建议，不声称听到了音频）" : "",
  ].filter(Boolean).join("、");
  return [
    `按顺序分析这 ${times.length} 张视频帧，时间点依次为：${times.map(formatStoryboardTime).join("、")}。`,
    `需要输出：${requested}。相邻画面内容连续时也要逐帧描述，禁止臆造画面外信息。`,
    "只返回 JSON，格式：{\"frames\":[{\"index\":1,\"shotSize\":\"中景\",\"motion\":\"固定镜头\",\"description\":\"...\",\"musicCue\":\"...\"}]}。index 必须从 1 连续编号；不需要的字段填空字符串。",
  ].join("\n");
}

export function parseStoryboardAnalysis(text: string, frameCount: number): StoryboardFrameAnalysis[] {
  try {
    const parsed = JSON.parse(text) as { frames?: unknown } | unknown[];
    const rawFrames = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray(parsed.frames)
        ? parsed.frames
        : [];
    const valid = rawFrames.flatMap((raw): StoryboardFrameAnalysis[] => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const index = Math.round(Number(item.index));
      if (!Number.isFinite(index) || index < 1 || index > frameCount) return [];
      const stringValue = (key: string) => typeof item[key] === "string" ? item[key].trim().slice(0, 160) : undefined;
      return [{
        index,
        shotSize: stringValue("shotSize"),
        motion: stringValue("motion"),
        description: stringValue("description"),
        musicCue: stringValue("musicCue"),
      }];
    });
    return [...new Map(valid.map((item) => [item.index, item])).values()].sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

export function buildStoryboardOutputs(input: {
  processor: CanvasNode;
  sourceVideoId: string;
  frames: readonly StoryboardUploadedFrame[];
  framesPerGroup: number;
  existingGroupCount: number;
  existingNodes?: readonly CanvasNode[];
  runNumber?: number;
  colors: readonly string[];
  makeNodeId: () => string;
  makeGroupId: () => string;
}): { nodes: CanvasNode[]; connections: Connection[]; groups: CanvasGroup[] } {
  const {
    processor,
    sourceVideoId,
    frames,
    existingGroupCount,
    existingNodes = [],
    colors,
    makeNodeId,
    makeGroupId,
  } = input;
  const framesPerGroup = Math.max(1, Math.min(8, Math.round(input.framesPerGroup)));
  const nodes: CanvasNode[] = [];
  const connections: Connection[] = [];
  const groups: CanvasGroup[] = [];
  const baseX = processor.x + BREAKDOWN_NODE_WIDTH + 140;
  const runNumber = Math.max(1, Math.round(input.runNumber ?? 1));
  const previousOutputs = existingNodes.filter((candidate) =>
    candidate.storyboardFrame?.processorId === processor.id,
  );
  let cursorY = previousOutputs.length
    ? Math.max(...previousOutputs.map((candidate) => candidate.y + (candidate.contentH ?? candidate.height))) + 104
    : processor.y;

  for (let groupStart = 0; groupStart < frames.length; groupStart += framesPerGroup) {
    const slice = frames.slice(groupStart, groupStart + framesPerGroup);
    const groupNodeIds: string[] = [];
    const rowHeights: number[] = [];
    for (let localIndex = 0; localIndex < slice.length; localIndex += 1) {
      const frame = slice[localIndex];
      const row = Math.floor(localIndex / 2);
      const height = Math.max(120, Math.round(STORYBOARD_FRAME_WIDTH * frame.height / Math.max(1, frame.width)));
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);
    }
    const rowTops: number[] = [];
    let rowOffset = 0;
    for (let row = 0; row < rowHeights.length; row += 1) {
      rowTops[row] = rowOffset;
      rowOffset += rowHeights[row] + 42;
    }

    slice.forEach((frame, localIndex) => {
      const absoluteIndex = groupStart + localIndex;
      const row = Math.floor(localIndex / 2);
      const col = localIndex % 2;
      const height = Math.max(120, Math.round(STORYBOARD_FRAME_WIDTH * frame.height / Math.max(1, frame.width)));
      const id = makeNodeId();
      groupNodeIds.push(id);
      nodes.push({
        id,
        type: "image",
        x: baseX + col * (STORYBOARD_FRAME_WIDTH + 48),
        y: cursorY + rowTops[row],
        width: STORYBOARD_FRAME_WIDTH,
        height,
        contentW: STORYBOARD_FRAME_WIDTH,
        contentH: height,
        title: `S${String(absoluteIndex + 1).padStart(2, "0")} · ${formatStoryboardTime(frame.timeSec)}`,
        imageSrc: frame.url,
        aspectRatio: `${frame.width}:${frame.height}`,
        fileSize: frame.fileSize,
        fileType: frame.fileType,
        mimeType: frame.mimeType,
        storyboardFrame: {
          sourceVideoId,
          processorId: processor.id,
          timeSec: frame.timeSec,
          index: absoluteIndex + 1,
          run: runNumber,
          shotSize: frame.analysis?.shotSize,
          motion: frame.analysis?.motion,
          description: frame.analysis?.description,
          musicCue: frame.analysis?.musicCue,
        },
        status: "success",
      });
      connections.push({
        id: `conn_${processor.id}_${id}`,
        sourceId: processor.id,
        targetId: id,
      });
    });

    const groupNumber = groups.length + 1;
    const color = colors.length > 0
      ? colors[(existingGroupCount + groups.length) % colors.length]
      : "#3b82f6";
    groups.push({
      id: makeGroupId(),
      title: `${runNumber > 1 ? `拉片 ${String(runNumber).padStart(2, "0")} · ` : ""}分镜组 ${String(groupNumber).padStart(2, "0")} · ${formatStoryboardTime(slice[0].timeSec)}–${formatStoryboardTime(slice[slice.length - 1].timeSec)}`,
      color,
      nodeIds: groupNodeIds,
    });
    cursorY += rowOffset + 104;
  }

  return { nodes, connections, groups };
}
