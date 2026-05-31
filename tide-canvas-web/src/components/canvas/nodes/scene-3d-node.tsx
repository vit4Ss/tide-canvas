"use client";

import { memo, useCallback, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { Layers, Plus, RotateCw, Sun, Camera, Sparkles, ChevronDown, Loader2, Zap, Send } from "lucide-react";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
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

const POSES = ["站立", "行走", "奔跑", "坐姿", "T-Pose"];
const CAMERA_ANGLES = ["正面", "侧面", "俯视", "仰视", "45°"];
const LIGHTS = ["自然光", "工作室", "戏剧", "黄昏", "夜晚"];

export const Scene3DNode = memo(function Scene3DNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const [pose, setPose] = useState("T-Pose");
  const [cameraAngle, setCameraAngle] = useState("45°");
  const [light, setLight] = useState("自然光");
  const { generate, isGenerating } = useAiGeneration();
  const generating = isGenerating(node.id) || node.status === "generating";
  const showAuxUI = isSelected && !isDragging;
  // 导演台场景为 2:1，缩放时维持该比例
  const SCENE_ASPECT = 2;
  const cardHeight = Math.round(node.width / SCENE_ASPECT);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleGenerate = () => {
    generate({
      nodeId: node.id,
      handler: "scene_3d_render",
      modelId: "default",
      input: {
        prompt: node.prompt || `3D scene with mannequin in ${pose} pose, ${cameraAngle} view, ${light} lighting`,
        pose, cameraAngle, light,
      },
    });
  };

  return (
    <div
      data-node-id={node.id}
      className={`absolute select-none ${isSelected ? "z-10" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, cursor: "move" }}
      onMouseDown={handleMouseDown}
    >
      <NodeHeader icon={Layers} title={node.title || "导演台"} visible={showAuxUI} />

      <div className="relative">
        {/* 3D 场景预览 */}
        <div
          className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-800 to-slate-900 transition-all ${
            isConnectTarget ? "border-blue-500 ring-2 ring-blue-500/40" :
            isSelected ? "border-neutral-300 dark:border-neutral-700" : "border-neutral-200 dark:border-neutral-800"
          }`}
          style={{ height: cardHeight }}
        >
          {generating && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                <p className="text-sm text-neutral-300">3D 场景渲染中...</p>
              </div>
            </div>
          )}

          {/* 3D 场景占位：地面 + 假人剪影 */}
          {node.imageSrc ? (
            <img src={node.imageSrc} alt="" draggable={false} className="h-full w-full object-contain" />
          ) : (
            <div className="relative flex h-full items-center justify-center">
              {/* 透视网格地面 */}
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 720 360" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="grid-fade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(148 163 184)" stopOpacity="0" />
                    <stop offset="100%" stopColor="rgb(148 163 184)" stopOpacity="0.3" />
                  </linearGradient>
                </defs>
                {Array.from({ length: 12 }).map((_, i) => (
                  <line key={`h${i}`}
                    x1={0} y1={180 + (i + 1) * 18}
                    x2={720} y2={180 + (i + 1) * 18}
                    stroke="url(#grid-fade)" strokeWidth={1} />
                ))}
                {Array.from({ length: 14 }).map((_, i) => {
                  const x = (i - 6) * 80;
                  return (
                    <line key={`v${i}`}
                      x1={360 + x * 0.3} y1={180}
                      x2={360 + x * 1.5} y2={360}
                      stroke="url(#grid-fade)" strokeWidth={1} />
                  );
                })}
              </svg>

              {/* 人形剪影 */}
              <svg className="relative z-10 h-44 text-slate-400" viewBox="0 0 64 128" fill="currentColor">
                <circle cx="32" cy="16" r="10" />
                <rect x="22" y="28" width="20" height="40" rx="4" />
                <rect x="14" y="32" width="6" height="32" rx="3" />
                <rect x="44" y="32" width="6" height="32" rx="3" />
                <rect x="22" y="70" width="8" height="42" rx="3" />
                <rect x="34" y="70" width="8" height="42" rx="3" />
              </svg>

              {/* 信息标签 */}
              <div className="absolute right-3 top-3 rounded-lg bg-slate-700/60 px-2.5 py-1 text-xs text-slate-200 backdrop-blur">
                {pose} · {cameraAngle} · {light}
              </div>
            </div>
          )}

          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>

      {/* 控制面板 */}
      {showAuxUI && (
        <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <ControlGroup icon={RotateCw} label="姿态" value={pose} options={POSES} onChange={setPose} stop={stop} />
            <ControlGroup icon={Camera} label="视角" value={cameraAngle} options={CAMERA_ANGLES} onChange={setCameraAngle} stop={stop} />
            <ControlGroup icon={Sun} label="灯光" value={light} options={LIGHTS} onChange={setLight} stop={stop} />
          </div>

          <textarea
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value })}
            onMouseDown={stop}
            placeholder="补充提示词（可选），如：高级感产品图，水墨风格..."
            rows={2}
            className="mt-3 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-5 outline-none placeholder:text-neutral-400 focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
            style={{ outline: "none", boxShadow: "none", cursor: "text" }}
          />

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Sparkles className="h-3 w-3 text-blue-500" />
              <span>3D Director</span>
              <ChevronDown className="h-3 w-3" />
              <span className="ml-2 inline-flex items-center gap-0.5">
                <Zap className="h-3 w-3 text-amber-500" fill="currentColor" />
                25
              </span>
            </div>
            <button
              onMouseDown={stop}
              onClick={(e) => { stop(e); handleGenerate(); }}
              disabled={generating}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                generating ? "bg-neutral-100 text-neutral-400 dark:bg-neutral-800" : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
              }`}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function ControlGroup({ icon: Icon, label, value, options, onChange, stop }: {
  icon: typeof Plus;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  stop: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-1.5 flex items-center gap-1 text-neutral-500">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            onMouseDown={stop}
            onClick={(e) => { stop(e); onChange(opt); }}
            className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
              value === opt
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
