"use client";

import { memo, useCallback } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { AudioLines, Upload, Loader2, Music } from "lucide-react";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { NodePromptPanel } from "./base/node-prompt-panel";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

export const AudioNode = memo(function AudioNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";
  const showAuxUI = isSelected && !isDragging;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleGenerate = () => {
    generate({
      nodeId: node.id,
      handler: "text_to_audio",
      modelId: "default",
      input: { prompt: node.prompt },
    });
  };

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={AudioLines} title={node.title || "音频节点"} visible={showAuxUI} />

      <div className="relative">
        {showAuxUI && (
          <button onMouseDown={stop}
            className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
            <Upload className="h-3.5 w-3.5" /> 上传
          </button>
        )}

        <div
          className={`relative overflow-hidden rounded-2xl border bg-white transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ height: 180 }}
        >
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-neutral-900/70">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600">AI 音频生成中...</p>
              </div>
            </div>
          )}
          <div className="flex h-full items-center justify-center gap-3">
            <Music className="h-12 w-12 text-neutral-300 dark:text-neutral-600" />
            {/* 音波占位 */}
            <div className="flex items-end gap-1">
              {[10, 18, 25, 32, 28, 20, 12, 24, 30, 16].map((h, i) => (
                <div key={i} className="w-1 rounded-full bg-neutral-300 dark:bg-neutral-600" style={{ height: h }} />
              ))}
            </div>
          </div>

          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>

      {showAuxUI && (
        <NodePromptPanel
          prompt={node.prompt || ""}
          placeholder="描述你想生成的音频内容（音乐 / 音效 / 配音）..."
          modelName="Lib Audio"
          generating={generating}
          canSubmit={!!node.prompt?.trim()}
          pointCost={10}
          onPromptChange={(v) => updateNode(node.id, { prompt: v })}
          onSubmit={handleGenerate}
          onStop={stop}
        />
      )}
    </div>
  );
});
