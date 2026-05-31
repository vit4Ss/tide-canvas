"use client";

import { memo, useCallback, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Video, Upload, Box, MapPin, Camera, Globe, Loader2, Languages, ChevronDown, Play } from "lucide-react";
import { QualityRatioPicker, parseRatio, type QualityRatioValue } from "./quality-ratio-picker";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodePromptPanel } from "./base/node-prompt-panel";
import { NodeChrome } from "./base/node-chrome";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

const DURATIONS = ["3s", "5s", "10s"];

export const VideoNode = memo(function VideoNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  // 当前画布缩放：外置组件按 1/zoom 反向缩放，保持恒定屏幕尺寸
  const zoom = useCanvasStore((s) => s.transform.k);
  const [qualityRatio, setQualityRatio] = useState<QualityRatioValue>({ quality: "standard", clarity: "2K", ratio: "16:9" });
  const [duration, setDuration] = useState("5s");
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";
  const showAuxUI = isSelected && !isDragging;
  // 视频卡片按所选比例渲染，缩放时维持比例
  const ratioParsed = parseRatio(qualityRatio.ratio);
  const cardAspect = ratioParsed ? ratioParsed.w / ratioParsed.h : 16 / 9;
  const cardHeight = Math.round(node.width / cardAspect);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleGenerate = () => {
    generate({
      nodeId: node.id,
      handler: "text_to_video",
      modelId: "default",
      input: { prompt: node.prompt, aspectRatio: qualityRatio.ratio, duration },
    });
  };

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-2xl border bg-white transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ height: cardHeight }}
        >
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600 dark:text-neutral-400">AI 视频生成中...</p>
              </div>
            </div>
          )}
          {node.status === "error" && !generating && (
            <div className="absolute right-3 top-3 z-[5] rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              生成失败
            </div>
          )}

          {node.videoSrc ? (
            <video src={node.videoSrc} controls className="h-full w-full" />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-1 items-center justify-center p-6">
                {(() => {
                  const r = parseRatio(qualityRatio.ratio);
                  const MAX_W = 280, MAX_H = 220;
                  let w = MAX_W, h = MAX_H;
                  if (r) {
                    const aspect = r.w / r.h;
                    if (aspect >= MAX_W / MAX_H) { w = MAX_W; h = MAX_W / aspect; }
                    else { h = MAX_H; w = MAX_H * aspect; }
                  }
                  return (
                    <div className="flex items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800/60" style={{ width: w, height: h }}>
                      <Play className="h-12 w-12 text-neutral-300 dark:text-neutral-600" fill="currentColor" />
                    </div>
                  );
                })()}
              </div>
              <div className="px-6 pb-5">
                <p className="mb-2 text-sm text-neutral-500">尝试：</p>
                <div className="flex flex-col items-start gap-1">
                  <button onMouseDown={stop} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                      <Upload className="h-3.5 w-3.5" />
                    </span>
                    图生视频
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* 外置组件：恒定大小·跟随节点（按 1/zoom 反向缩放，吸附卡片边缘） */}
        <NodeHeader icon={Video} title={node.title || "视频节点"} visible={showAuxUI} zoom={zoom} />
        {showAuxUI && (
          <NodeChrome zoom={zoom} placement="top-center" gap={8}>
            <button onMouseDown={stop}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              <Upload className="h-3.5 w-3.5" /> 上传
            </button>
          </NodeChrome>
        )}
        <NodePorts nodeId={node.id} visible={showAuxUI} zoom={zoom} onPortMouseDown={onPortMouseDown} />

        {showAuxUI && (
          <NodePromptPanel
            prompt={node.prompt || ""}
            placeholder="描述你想生成的视频画面内容..."
            modelName="Veo 3.1"
            generating={generating}
            canSubmit={!!node.prompt?.trim()}
            pointCost={30}
            zoom={zoom}
            overlayWidth={node.width}
            topControls={
            <>
              <button onMouseDown={stop} className="flex flex-col items-center gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                <Box className="h-3.5 w-3.5" />
                <span>风格</span>
              </button>
              <button onMouseDown={stop} className="flex flex-col items-center gap-0.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                <MapPin className="h-3.5 w-3.5" />
                <span>标记</span>
              </button>
            </>
          }
          middleControls={
            <>
              <QualityRatioPicker value={qualityRatio} onChange={setQualityRatio} />
              <button onMouseDown={stop} onClick={() => {
                const i = DURATIONS.indexOf(duration);
                setDuration(DURATIONS[(i + 1) % DURATIONS.length]);
              }} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                时长 {duration}
                <ChevronDown className="h-3 w-3" />
              </button>
              <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Camera className="h-3 w-3" />
                摄像机
              </button>
              <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Globe className="h-3 w-3" />
                全景
              </button>
              <button onMouseDown={stop} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Languages className="h-3 w-3" />
              </button>
            </>
          }
          onPromptChange={(v) => updateNode(node.id, { prompt: v })}
          onSubmit={handleGenerate}
          onStop={stop}
        />
        )}
      </div>
    </div>
  );
});
