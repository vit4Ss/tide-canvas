"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { AudioLines, Loader2, Music, Send, Zap, Mic2 } from "lucide-react";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { useAuth } from "@/hooks/use-auth";
import { applyTeamFactor } from "@/lib/points";
import { aiApi } from "@/lib/api";
import { AiModelType, type AiModelVO } from "@/types/ai";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import { ModelPicker } from "./model-picker";

interface Props {
  node: CanvasNode;
  isSelected: boolean;
  isDragging?: boolean;
  isConnectTarget?: boolean;
  onNodeMouseDown: (nodeId: string, e: React.MouseEvent) => void;
  onPortMouseDown?: (nodeId: string, side: "input" | "output", clientX: number, clientY: number) => void;
}

const MAX_TEXT = 50000;

interface VoiceOption {
  id: string;
  name: string;
}

/** 从模型 config(JSON) 解析音色列表（每个供应商每个模型各不相同，由后台模型管理维护） */
function voicesOf(model?: AiModelVO): VoiceOption[] {
  if (!model?.config) return [];
  try {
    const cfg = JSON.parse(model.config) as { voices?: unknown };
    if (!Array.isArray(cfg.voices)) return [];
    return cfg.voices
      .filter((v): v is VoiceOption => !!v && typeof (v as VoiceOption).id === "string" && !!(v as VoiceOption).id)
      .map((v) => ({ id: v.id, name: v.name || v.id }));
  } catch {
    return [];
  }
}

export const AudioNode = memo(function AudioNode({ node, isSelected, isDragging = false, isConnectTarget = false, onNodeMouseDown, onPortMouseDown }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const { generate, isGenerating } = useAiGeneration();
  const { user } = useAuth();
  const generating = isGenerating(node.id) || node.status === "generating";
  const showAuxUI = isSelected && !isDragging;

  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelId, setModelId] = useState("");
  const [voice, setVoice] = useState("");

  // 语音模型列表（type=audio）；默认选第一个
  useEffect(() => {
    let active = true;
    aiApi.listModels().then((res) => {
      if (active && res.success) {
        const audios = res.data.filter((m) => m.type === AiModelType.AUDIO);
        setModels(audios);
        if (audios.length) setModelId((prev) => prev || audios[0].modelId);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const selectedModel = models.find((m) => m.modelId === modelId);
  const voices = voicesOf(selectedModel);
  // 切换模型后音色不在新列表内 → 渲染期重置为该模型第一个音色（官方「props 变化调整 state」模式）
  const [lastModelId, setLastModelId] = useState(modelId);
  if (modelId !== lastModelId) {
    setLastModelId(modelId);
    setVoice(voices[0]?.id ?? "");
  }
  const effectiveVoice = voice || voices[0]?.id || "";
  const cost = applyTeamFactor(Number(selectedModel?.pointCost ?? 10), user);
  const textLen = (node.prompt || "").length;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    onNodeMouseDown(node.id, e);
  }, [node.id, onNodeMouseDown]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleGenerate = () => {
    if (!node.prompt?.trim() || generating) return;
    generate({
      nodeId: node.id,
      handler: "text_to_audio",
      modelId: modelId || "default",
      input: {
        prompt: node.prompt,
        ...(effectiveVoice ? { voice: effectiveVoice } : {}),
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
      <NodeHeader icon={AudioLines} title={node.title || "音频节点"} visible={showAuxUI} />

      <div className="relative">
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
                <p className="text-sm text-neutral-600">语音合成中...</p>
              </div>
            </div>
          )}

          {node.audioSrc ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-5">
              <div className="flex items-end gap-1">
                {[10, 18, 25, 32, 28, 20, 12, 24, 30, 16, 22, 14].map((h, i) => (
                  <div key={i} className="w-1 rounded-full bg-blue-400/80" style={{ height: h }} />
                ))}
              </div>
              <audio
                src={node.audioSrc}
                controls
                preload="metadata"
                onMouseDown={stop}
                className="w-full"
                style={{ height: 36 }}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center gap-3">
              <Music className="h-12 w-12 text-neutral-300 dark:text-neutral-600" />
              {/* 音波占位 */}
              <div className="flex items-end gap-1">
                {[10, 18, 25, 32, 28, 20, 12, 24, 30, 16].map((h, i) => (
                  <div key={i} className="w-1 rounded-full bg-neutral-300 dark:bg-neutral-600" style={{ height: h }} />
                ))}
              </div>
            </div>
          )}

          <NodePorts nodeId={node.id} visible={showAuxUI} onPortMouseDown={onPortMouseDown} />
        </div>
      </div>

      {/* 合成面板：文本 + 模型/音色选择 + 字数/积分 + 发送 */}
      {showAuxUI && (
        <div onMouseDown={stop} className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <textarea
            value={node.prompt || ""}
            onChange={(e) => updateNode(node.id, { prompt: e.target.value.slice(0, MAX_TEXT) })}
            placeholder="输入要合成的语音文本..."
            rows={3}
            maxLength={MAX_TEXT}
            className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm leading-5 outline-none placeholder:text-neutral-400 focus:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
            style={{ outline: "none", boxShadow: "none", cursor: "text" }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <ModelPicker models={models} value={modelId} onChange={setModelId} />
              {voices.length > 0 && (
                <span className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  <Mic2 className="h-3 w-3 shrink-0 text-neutral-400" />
                  <select
                    value={effectiveVoice}
                    onChange={(e) => setVoice(e.target.value)}
                    onMouseDown={stop}
                    className="max-w-[120px] cursor-pointer truncate bg-transparent text-xs font-medium outline-none dark:bg-neutral-950"
                  >
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] tabular-nums text-neutral-400">{textLen}/{MAX_TEXT}</span>
              <span className="flex items-center gap-0.5 text-xs text-neutral-500">
                <Zap className="h-3 w-3 text-amber-500" fill="currentColor" /> {cost}
              </span>
              <button
                onMouseDown={stop}
                onClick={(e) => { stop(e); handleGenerate(); }}
                disabled={!node.prompt?.trim() || generating}
                title={generating ? "合成中..." : "开始合成"}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
