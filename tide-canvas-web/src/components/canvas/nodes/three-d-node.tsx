"use client";

import { memo, useMemo, useState } from "react";
import { Box, Download, Image as ImageIcon, Layers3, Zap } from "lucide-react";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { AiModelType } from "@/types/ai";
import type {
  CanvasThreeDGenerateType,
  CanvasThreeDMode,
  CanvasThreeDResultFormat,
} from "@/types/canvas-three-d";
import type { ModelConfig } from "@/types/admin-models";
import {
  canvasThreeDAssetExtension,
  canvasThreeDGlbUrl,
  canvasThreeDPreviewUrl,
  canvasThreeDSceneAssetFromNode,
} from "@/lib/canvas-three-d";
import { MAX_SINGLE_UPLOAD_BYTES, resolveUploadLimitBytes, validateKnownFileSize } from "@/lib/upload-limits";
import { THREE_D_VIEW_SLOTS } from "@/components/studio/create-studio/constants";
import { threeDMultiViewLimit } from "@/components/studio/create-studio/utils";
import { ThreeDViewport } from "@/components/studio/three-d-studio/viewport";
import { toast } from "@/components/shared/toast";
import { PopoverSelect } from "@/components/shared/popover-select";
import { ModelPicker } from "./model-picker";
import { NodeHeader } from "./base/node-header";
import { NodePorts } from "./base/node-ports";
import {
  GenerateSubmitButton,
  NodeErrorBadge,
  NodeGeneratingOverlay,
  NodePanelChrome,
  NodeShell,
} from "./shared/node-overlays";
import { useFileDownload } from "./shared/use-file-download";
import { useAiModels, useNodeRuntime } from "./shared/use-node-runtime";
import { getIncomingSources, parseModelConfig, stopEvent as stop } from "./shared/node-utils";
import type { CanvasNodeProps } from "./types/node-props";

const MODE_OPTIONS: Array<{ value: CanvasThreeDMode; label: string }> = [
  { value: "t2_3d", label: "文生 3D" },
  { value: "i2_3d", label: "图生 3D" },
  { value: "mv2_3d", label: "多视图" },
];

const FORMAT_OPTIONS: Array<{ value: CanvasThreeDResultFormat; label: string }> = [
  { value: "", label: "OBJ + GLB" },
  { value: "STL", label: "STL" },
  { value: "USDZ", label: "USDZ" },
  { value: "FBX", label: "FBX" },
];

const VIEW_LABELS = ["正", "左", "右", "背", "顶", "底", "左前", "右前"];

function clampFaceCount(value: number) {
  return Math.min(1_500_000, Math.max(3_000, Math.round(value / 1_000) * 1_000));
}

export const ThreeDNode = memo(function ThreeDNode({
  node,
  isSelected,
  isDragging = false,
  isConnectTarget = false,
  onNodeMouseDown,
  onPortMouseDown,
}: CanvasNodeProps) {
  const updateNode = useCanvasStore((state) => state.updateNode);
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const connections = useCanvasStore((state) => state.connections);
  const incomingImages = useMemo(
    () => getIncomingSources({ nodes: canvasNodes, connections }, node.id).filter((source) => !!source.imageSrc),
    [canvasNodes, connections, node.id],
  );
  const { generate, generating, showAuxUI } = useNodeRuntime(node, isSelected, isDragging);
  const { models, modelId, setModelId, selectedModel } = useAiModels(
    AiModelType.THREE_D,
    node.generationConfig?.modelId,
  );
  const modelConfig = useMemo(() => parseModelConfig<ModelConfig>(selectedModel), [selectedModel]);
  const isWorldModel = modelConfig.threeDKind === "world" || modelConfig.provider?.toLowerCase() === "worldlabs";
  const [mode, setMode] = useState<CanvasThreeDMode>(node.generationConfig?.threeDMode ?? "t2_3d");
  const [enablePbr, setEnablePbr] = useState(node.generationConfig?.enablePbr ?? false);
  const [faceCount, setFaceCount] = useState(() => clampFaceCount(node.generationConfig?.faceCount ?? 500_000));
  const [generateType, setGenerateType] = useState<CanvasThreeDGenerateType>(node.generationConfig?.generateType ?? "Normal");
  const [resultFormat, setResultFormat] = useState<CanvasThreeDResultFormat>(node.generationConfig?.resultFormat ?? "");
  const { downloading, download } = useFileDownload();

  const glbUrl = canvasThreeDGlbUrl(node);
  const directorSceneAsset = canvasThreeDSceneAssetFromNode(node);
  const previewUrl = canvasThreeDPreviewUrl(node);
  const multiViewLimit = threeDMultiViewLimit(modelConfig);
  const referenceImages = mode === "i2_3d"
    ? incomingImages.slice(0, 1)
    : mode === "mv2_3d"
      ? incomingImages.slice(0, multiViewLimit)
      : [];
  const cost = modelConfig.creditCost ?? selectedModel?.pointCost ?? 0;
  const cardHeight = Math.round(node.width * 9 / 16);
  const hasRenderableModel = !!directorSceneAsset;

  const handleGenerate = () => {
    const prompt = node.prompt?.trim() || "";
    if (!modelId) {
      toast.error("暂无可用的 3D 模型");
      return;
    }
    if (mode === "t2_3d" && !prompt) {
      toast.info(isWorldModel ? "请先描述要生成的 3D 场景" : "请先描述要生成的 3D 模型");
      return;
    }
    if (mode === "i2_3d" && referenceImages.length < 1) {
      toast.info("请先连接一张图片到 3D 节点");
      return;
    }
    if (mode === "mv2_3d" && referenceImages.length < 1) {
      toast.info("请至少连接一张视角图片到 3D 节点");
      return;
    }
    if (mode === "mv2_3d" && incomingImages.length > multiViewLimit) {
      toast.info(`当前模型最多支持 ${multiViewLimit} 张多视图图片，请断开多余连接`);
      return;
    }
    const configuredMaxBytes = Number(modelConfig.max3DImageSizeMB) > 0
      ? Number(modelConfig.max3DImageSizeMB) * 1024 * 1024
      : MAX_SINGLE_UPLOAD_BYTES;
    const maxReferenceBytes = resolveUploadLimitBytes(configuredMaxBytes);
    for (const source of referenceImages) {
      const sizeIssue = validateKnownFileSize(source.fileSize, source.title, {
        maxBytes: maxReferenceBytes,
        label: "3D 参考图",
      });
      if (sizeIssue) {
        toast.error(`${sizeIssue}，请更换图片或切换模型后重试`);
        return;
      }
    }

    const multiViewImages = mode === "mv2_3d"
      ? referenceImages.map((source, index) => ({
          viewType: THREE_D_VIEW_SLOTS[index].viewType,
          viewImageUrl: source.imageSrc as string,
        }))
      : undefined;
    const singleImageIsPanorama = mode === "i2_3d"
      && (referenceImages[0].is360 === true || referenceImages[0].aspectRatio === "2:1");
    const input: Record<string, unknown> = {
      ...((mode === "t2_3d" || isWorldModel) && prompt ? { prompt } : {}),
      ...(mode === "i2_3d" ? { imageUrl: referenceImages[0].imageSrc } : {}),
      ...(singleImageIsPanorama ? { isPano: true } : {}),
      ...(multiViewImages?.length ? { multiViewImages } : {}),
      ...(!isWorldModel ? {
        enablePbr,
        faceCount,
        generateType,
        ...(resultFormat ? { resultFormat } : {}),
      } : {}),
    };
    updateNode(node.id, {
      generationConfig: {
        ...node.generationConfig,
        modelId,
        threeDMode: mode,
        enablePbr,
        faceCount,
        generateType,
        resultFormat,
      },
    });
    void generate({ nodeId: node.id, handler: "generate_3d", modelId, input });
  };

  return (
    <NodeShell node={node} isSelected={isSelected} isDragging={isDragging} onNodeMouseDown={onNodeMouseDown}>
      <NodeHeader icon={Box} title={node.title || (isWorldModel ? "3D 场景节点" : "3D 节点")} visible={showAuxUI} overlay />
      <div
        className={`relative overflow-hidden rounded-2xl border bg-[#16181d] transition-all ${
          isConnectTarget
            ? "border-blue-500 ring-2 ring-blue-500/40"
            : isSelected
              ? "border-neutral-400 dark:border-neutral-600"
              : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-700"
        }`}
        style={{ height: cardHeight }}
      >
        {node.modelSrc ? (
          glbUrl && isSelected ? (
            <div className="h-full w-full cursor-orbit" onMouseDown={stop}>
              <ThreeDViewport
                key="model-solid"
                glbUrl={glbUrl}
                compact
                initialMode="solid"
              />
            </div>
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider-owned 3D preview image
            <img src={previewUrl} alt={node.title || "3D 模型"} draggable={false} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/55">
              <Layers3 className="h-12 w-12" />
              <div className="text-center">
                <p className="text-sm font-medium text-white/80">{isWorldModel ? "3D 场景已生成" : "3D 模型已生成"}</p>
                <p className="mt-1 text-xs">{hasRenderableModel ? "可连接到 3D 导演台继续编辑" : "当前输出格式不可在线预览"}</p>
              </div>
            </div>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/45">
            <Box className="h-12 w-12" />
            <div className="text-center">
              <p className="text-sm font-medium text-white/75">{isWorldModel ? "生成可漫游 3D 场景" : "生成 3D 模型"}</p>
              <p className="mt-1 text-xs">支持文生、图生和多视图</p>
            </div>
          </div>
        )}

        {showAuxUI && node.modelAssets?.length ? (
          <div className="absolute right-3 top-3 z-[7] flex items-center gap-1 rounded-lg bg-black/55 p-1 backdrop-blur">
            {node.modelAssets.map((asset, index) => (
              <button
                key={`${asset.type}:${asset.url}`}
                type="button"
                disabled={downloading}
                onMouseDown={stop}
                onClick={(event) => void download(
                  event,
                  asset.url,
                  `${node.title || "3D模型"}-${asset.type || index + 1}`,
                  canvasThreeDAssetExtension(asset.type, asset.url),
                )}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium uppercase text-white/80 transition-colors hover:bg-white/15 disabled:opacity-50"
                title={`下载 ${asset.type.toUpperCase()} 文件`}
              >
                <Download className="h-3 w-3" /> {asset.type}
              </button>
            ))}
          </div>
        ) : null}

        {generating && <NodeGeneratingOverlay label={isWorldModel ? "正在生成 Marble 3D 场景..." : "正在生成 3D 模型..."} />}
        {node.status === "error" && !generating && !node.modelSrc && <NodeErrorBadge />}
      </div>

      {/* 端口必须与 overflow-hidden 卡片同级：端口锚在卡片外，放卡片内会被整体裁掉 */}
      <NodePorts
        nodeId={node.id}
        visible={showAuxUI}
        overlay
        inputTitle="连接图片作为 3D 参考"
        outputTitle={hasRenderableModel ? "连接到 3D 导演台作为白膜场景" : "生成可渲染的 GLB 后可连接到导演台"}
        onPortMouseDown={onPortMouseDown}
      />

      {showAuxUI && (
        <NodePanelChrome width={700} height={330}>
          <div className="flex items-center gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onMouseDown={stop}
                onClick={(event) => { stop(event); setMode(option.value); }}
                className={`h-8 flex-1 rounded-md text-xs font-medium transition-colors ${mode === option.value ? "bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
              >
                {isWorldModel ? option.label.replace("3D", "3D 场景") : option.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-4">
            <div className="flex min-h-0 flex-col">
              {mode !== "t2_3d" && (
                <div className="mb-2 flex min-h-8 items-center gap-2 rounded-lg bg-neutral-50 px-3 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-400">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {referenceImages.length > 0 ? (
                    <span className="min-w-0 truncate">
                      已连接 {referenceImages.length} 张参考图
                      {mode === "mv2_3d" ? ` · ${referenceImages.map((_, index) => VIEW_LABELS[index]).join(" / ")}` : ""}
                    </span>
                  ) : (
                    <span>从图片节点连线到此节点作为参考</span>
                  )}
                </div>
              )}
              {mode !== "i2_3d" ? (
                <textarea
                  value={node.prompt || ""}
                  onChange={(event) => updateNode(node.id, { prompt: event.target.value })}
                  onMouseDown={stop}
                  placeholder={mode === "mv2_3d" ? "可选：补充材质、风格或结构要求" : "描述你想生成的 3D 资产..."}
                  className="min-h-0 flex-1 resize-none rounded-lg border border-neutral-200 bg-transparent p-3 text-sm leading-6 text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-neutral-400 dark:border-neutral-800 dark:text-neutral-200 dark:focus:border-neutral-600"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-200 text-center text-xs leading-5 text-neutral-400 dark:border-neutral-800">
                  图生 3D 只使用连接的单张图片，<br />不同时提交提示词
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs">
              {isWorldModel ? (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 leading-5 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-400">
                  <div className="font-medium text-neutral-800 dark:text-neutral-200">Marble 世界输出</div>
                  <p className="mt-1">生成碰撞 GLB 白膜、SPZ、全景图和缩略图。导演台只连接 GLB 白膜，SPZ 仅作为附加文件下载。</p>
                  <p className="mt-2 text-[10px] text-neutral-400">场景质量由所选 Marble 模型决定，无需设置面数、PBR 或导出格式。</p>
                </div>
              ) : <>
              <div>
                <div className="mb-1.5 text-neutral-500">生成类型</div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
                  {(["Normal", "Geometry"] as CanvasThreeDGenerateType[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onMouseDown={stop}
                      onClick={(event) => { stop(event); setGenerateType(value); }}
                      className={`h-7 rounded-md transition-colors ${generateType === value ? "bg-white text-neutral-950 shadow-sm dark:bg-neutral-800 dark:text-white" : "text-neutral-500"}`}
                    >
                      {value === "Normal" ? "标准模型" : "纯几何"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 flex justify-between text-neutral-500"><span>模型面数</span><output>{faceCount.toLocaleString()}</output></span>
                <input
                  type="range"
                  min={3_000}
                  max={1_500_000}
                  step={1_000}
                  value={faceCount}
                  onMouseDown={stop}
                  onChange={(event) => setFaceCount(clampFaceCount(Number(event.target.value)))}
                  className="w-full accent-neutral-900 dark:accent-white"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-neutral-500">输出格式</span>
                <PopoverSelect
                  value={resultFormat}
                  options={FORMAT_OPTIONS}
                  onChange={(value) => setResultFormat(value as CanvasThreeDResultFormat)}
                  className="h-7 w-[112px] text-xs"
                  label="输出格式"
                />
              </div>
              {resultFormat && (
                <p className="-mt-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400">
                  3D 导演台只加载 GLB；当前格式生成后仍可下载，但不能作为导演台场景。
                </p>
              )}
              <div className="flex items-center justify-between">
                <span><strong className="font-medium text-neutral-700 dark:text-neutral-200">PBR 材质</strong><small className="ml-1.5 text-neutral-400">物理渲染贴图</small></span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enablePbr}
                  onMouseDown={stop}
                  onClick={(event) => { stop(event); setEnablePbr((value) => !value); }}
                  className={`relative h-5 w-9 rounded-full transition-colors ${enablePbr ? "bg-neutral-900 dark:bg-white" : "bg-neutral-200 dark:bg-neutral-700"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all dark:bg-neutral-950 ${enablePbr ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </div>
              </>}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-900">
            <ModelPicker models={models} value={modelId} onChange={setModelId} />
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="flex items-center gap-1 tabular-nums"><Zap className="h-3 w-3" fill="currentColor" />{cost}</span>
              <GenerateSubmitButton
                disabled={generating || !modelId}
                generating={generating}
                title={generating ? "生成中..." : "开始生成 3D"}
                onClick={handleGenerate}
              />
            </div>
          </div>
        </NodePanelChrome>
      )}
    </NodeShell>
  );
});
