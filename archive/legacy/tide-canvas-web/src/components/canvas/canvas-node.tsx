"use client";

import { memo, useCallback } from "react";
import type { CanvasNode } from "@/stores/use-canvas-store";
import { useCanvasStore } from "@/stores/use-canvas-store";
import {
  AlignLeft, Image as ImageIcon, Video, Scissors, Layers, AudioLines, FileCode2,
  Loader2, X,
} from "lucide-react";
import { ImageNode } from "./nodes/image-node";
import { VideoNode } from "./nodes/video-node";
import { AudioNode } from "./nodes/audio-node";
import { TextNode } from "./nodes/text-node";
import { ScriptNode } from "./nodes/script-node";
import { Scene3DNode } from "./nodes/scene-3d-node";
import { VideoComposeNode } from "./nodes/video-compose-node";

const TYPE_ICONS: Record<string, typeof AlignLeft> = {
  text: AlignLeft,
  image: ImageIcon,
  video: Video,
  video_compose: Scissors,
  scene_3d: Layers,
  audio: AudioLines,
  script: FileCode2,
};

export interface CanvasNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

export const CanvasNodeComponent = memo(function CanvasNodeComponent(props: CanvasNodeProps) {
  switch (props.node.type) {
    case "image": return <ImageNode {...props} />;
    case "video": return <VideoNode {...props} />;
    case "audio": return <AudioNode {...props} />;
    case "text": return <TextNode {...props} />;
    case "script": return <ScriptNode {...props} />;
    case "scene_3d": return <Scene3DNode {...props} />;
    case "video_compose": return <VideoComposeNode {...props} />;
    default: return <DefaultNode {...props} />;
  }
});

const DefaultNode = memo(function DefaultNode({ node, isSelected, isDragging = false, isConnectTarget, onNodeMouseDown, onPortMouseDown }: CanvasNodeProps) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const Icon = TYPE_ICONS[node.type] || AlignLeft;
  const showAuxUI = isSelected && !isDragging;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => onNodeMouseDown(node.id, e),
    [node.id, onNodeMouseDown]
  );

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none rounded-xl border bg-white shadow-sm transition-all dark:bg-neutral-950 ${
        isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
        isSelected ? "border-blue-400 shadow-lg ring-2 ring-blue-400 ring-offset-2" : "border-neutral-200 hover:shadow-md dark:border-neutral-800"
      }`}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-neutral-500" />
          <span className="text-xs font-medium">{node.title}</span>
        </div>
        <div className="flex items-center gap-1">
          {node.status === "generating" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
          <button onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
            className="rounded p-0.5 text-neutral-300 hover:text-red-500">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3">
        <textarea
          value={node.prompt || ""}
          onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="输入提示词..."
          className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900"
          rows={3}
        />
      </div>

      {/* 输入端口 */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, "input", e.clientX, e.clientY); }}
        className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-neutral-300 bg-white hover:border-blue-500 hover:bg-blue-50 dark:border-neutral-600 dark:bg-neutral-800"
        title="输入端口"
      />
      {/* 输出端口 */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); onPortMouseDown?.(node.id, "output", e.clientX, e.clientY); }}
        className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-neutral-300 bg-white hover:border-blue-500 hover:bg-blue-50 dark:border-neutral-600 dark:bg-neutral-800"
        title="输出端口"
      />
    </div>
  );
});
