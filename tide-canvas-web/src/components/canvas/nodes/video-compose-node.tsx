"use client";

import { memo, useCallback, useState } from "react";
import type { CanvasNode } from "@/stores/use-canvas-store";
import { Scissors, Plus, Play, Trash2, Volume2 } from "lucide-react";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

interface Clip {
  id: string;
  name: string;
  duration: number; // 秒
  color: string;
}

const CLIP_COLORS = [
  "bg-blue-400", "bg-purple-400", "bg-amber-400", "bg-emerald-400",
  "bg-rose-400", "bg-cyan-400", "bg-orange-400",
];

export const VideoComposeNode = memo(function VideoComposeNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const [clips, setClips] = useState<Clip[]>([
    { id: "c1", name: "片段 1", duration: 4, color: CLIP_COLORS[0] },
    { id: "c2", name: "片段 2", duration: 3, color: CLIP_COLORS[1] },
  ]);
  const showAuxUI = isSelected && !isDragging;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const addClip = () => {
    const id = `c${Date.now()}`;
    const color = CLIP_COLORS[clips.length % CLIP_COLORS.length];
    setClips([...clips, { id, name: `片段 ${clips.length + 1}`, duration: 3, color }]);
  };

  const removeClip = (id: string) => setClips(clips.filter((c) => c.id !== id));

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
  const playheadPercent = 30; // 演示用静态值

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: isDragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={Scissors} title={node.title || "视频合成"} visible={showAuxUI} />

      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-2xl border bg-white transition-all dark:bg-neutral-950 ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
        >
          {/* 预览区 */}
          <div className="flex items-center justify-center bg-black" style={{ height: 200 }}>
            <div className="flex flex-col items-center gap-2 text-neutral-500">
              <Play className="h-12 w-12" fill="currentColor" />
              <span className="text-xs">预览区</span>
            </div>
          </div>

          {/* 控制栏 */}
          <div className="flex items-center gap-3 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
            <button onMouseDown={stop} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Play className="h-4 w-4" />
            </button>
            <button onMouseDown={stop} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Volume2 className="h-4 w-4" />
            </button>
            <span className="text-xs text-neutral-400">{formatTime(0)} / {formatTime(totalDuration)}</span>
            <div className="flex-1" />
            <button onMouseDown={stop} onClick={(e) => { stop(e); addClip(); }}
              className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 dark:bg-neutral-800">
              <Plus className="h-3 w-3" /> 添加片段
            </button>
          </div>

          {/* 时间轴 */}
          <div className="border-t border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            {/* 标尺 */}
            <div className="mb-2 flex justify-between text-[10px] text-neutral-400">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i}>{formatTime((totalDuration * i) / 5)}</span>
              ))}
            </div>

            {/* 片段轨道 */}
            <div className="relative h-12 rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <div className="flex h-full gap-0.5 p-0.5">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    onMouseDown={stop}
                    className={`group relative flex items-center justify-center rounded-md text-xs font-medium text-white ${clip.color}`}
                    style={{ width: `${(clip.duration / Math.max(totalDuration, 1)) * 100}%` }}
                  >
                    <span className="px-1 truncate">{clip.name} · {clip.duration}s</span>
                    <button onMouseDown={stop} onClick={(e) => { stop(e); removeClip(clip.id); }}
                      className="absolute right-1 top-1 hidden rounded bg-black/20 p-0.5 group-hover:flex">
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {clips.length === 0 && (
                  <div className="flex flex-1 items-center justify-center text-xs text-neutral-400">
                    拖入视频片段或连接视频节点
                  </div>
                )}
              </div>

              {/* 播放头 */}
              <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-red-500" style={{ left: `${playheadPercent}%` }}>
                <div className="absolute -top-1 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-red-500" />
              </div>
            </div>
          </div>

          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>
    </div>
  );
});

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
