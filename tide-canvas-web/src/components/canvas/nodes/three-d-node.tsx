"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Box, ChevronDown, Download, Image as ImageIcon, Layers3, SlidersHorizontal, Zap } from "lucide-react";
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
  NodeShell,
} from "./shared/node-overlays";
import { NodeComposer } from "./shared/node-composer";
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
  const uploading = !!node.uploading;

  // 图生 3D 的全景识别：站内全景节点带 is360/2:1 标记；用户上传的全景照片
  // 没有任何标记，按真实像素比例（equirectangular ≈ 2:1）识别。误判可用
  // 面板上的开关手动纠正。不带 is_pano 提交时 Marble 会把全景当普通透视
  // 照片重建，产出的世界和场景完全对不上。
  const i2SourceUrl = mode === "i2_3d" ? referenceImages[0]?.imageSrc || "" : "";
  const i2SourceFlagged = mode === "i2_3d"
    && (referenceImages[0]?.is360 === true || referenceImages[0]?.aspectRatio === "2:1");
  const [panoAutoDetected, setPanoAutoDetected] = useState(false);
  // 手动勾选持久化在节点配置里：组件态在面板收起/重开时会整个丢失，之前
  // 用户勾了框、重开面板后静默弹回，生成又跑成透视模式。
  // 勾选时同步记录源图地址(isPanoFor):换图后旧选择自动失效回自动识别,
  // 不让上一张图的手动纠正静默套在新图上。旧数据没有 isPanoFor,按原行为生效。
  const storedPanoOverride = node.generationConfig?.isPano ?? null;
  const panoOverrideSource = node.generationConfig?.isPanoFor;
  const panoOverride = storedPanoOverride !== null
    && (panoOverrideSource === undefined || panoOverrideSource === i2SourceUrl)
    ? storedPanoOverride
    : null;
  const setPanoOverride = (next: boolean) => {
    updateNode(node.id, { generationConfig: { ...node.generationConfig, isPano: next, isPanoFor: i2SourceUrl } });
  };
  useEffect(() => {
    setPanoAutoDetected(false);
    if (!i2SourceUrl || i2SourceFlagged) return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (cancelled || !probe.naturalHeight) return;
      const ratio = probe.naturalWidth / probe.naturalHeight;
      if (ratio >= 1.9 && ratio <= 2.1) setPanoAutoDetected(true);
    };
    probe.src = i2SourceUrl;
    return () => { cancelled = true; };
  }, [i2SourceUrl, i2SourceFlagged]);
  // 仅 World 类模型（Marble）理解 is_pano；物体类 3D 模型不受全景识别影响。
  const singleImageIsPanorama = mode === "i2_3d" && isWorldModel && referenceImages.length > 0
    && (panoOverride ?? (i2SourceFlagged || panoAutoDetected));

  const handleGenerate = () => {
    if (uploading) return;
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
    const input: Record<string, unknown> = {
      ...((mode === "t2_3d" || isWorldModel) && prompt ? { prompt } : {}),
      ...(mode === "i2_3d" ? { imageUrl: referenceImages[0].imageSrc } : {}),
      // 三态：手动勾/取消 → 显式 true/false（服务端尊重显式值）；未干预且
      // 识别为全景 → true；其余不传，由服务端按图片真实比例兜底判定。
      ...(mode === "i2_3d" && isWorldModel
        ? panoOverride !== null
          ? { isPano: panoOverride }
          : singleImageIsPanorama
            ? { isPano: true }
            : {}
        : {}),
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
        className={`relative overflow-hidden rounded-xl border transition-colors ${
          isConnectTarget
            ? "border-blue-500 ring-2 ring-blue-500/40"
            : isSelected
              ? "border-[var(--canvas-input-focus-border)]"
              : "border-[var(--border)] hover:border-[var(--canvas-input-focus-border)]"
        }`}
        style={{ height: cardHeight, background: node.modelSrc ? "#16181d" : "var(--popover)" }}
      >
        {node.modelSrc ? (
          glbUrl && isSelected ? (
            <div className="h-full w-full cursor-orbit" onMouseDown={stop}>
              <ThreeDViewport
                key="model-solid"
                glbUrl={glbUrl}
                compact
                initialMode="solid"
                frameInterior={!!directorSceneAsset?.colliderUrl}
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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
            <Box className="h-10 w-10 opacity-60" strokeWidth={1.5} />
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--foreground)]">{isWorldModel ? "生成可漫游 3D 场景" : "生成 3D 模型"}</p>
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

        {uploading && <NodeGeneratingOverlay label={`正在上传 GLB${node.uploadProgress ? ` ${node.uploadProgress}%` : "..."}`} />}
        {generating && !uploading && <NodeGeneratingOverlay label={isWorldModel ? "正在生成 Marble 3D 场景..." : "正在生成 3D 模型..."} />}
        {node.status === "error" && !generating && !uploading && !node.modelSrc && <NodeErrorBadge />}
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
        <NodeComposer
          label="3D 生成设置"
          tools={MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
              className="image-composer-chip"
              style={mode === option.value ? { background: "var(--accent)", color: "var(--foreground)" } : undefined}
            >
              {isWorldModel ? option.label.replace("3D", "3D 场景") : option.label}
            </button>
          ))}
          footer={<>
            <div className="image-composer-model"><ModelPicker models={models} value={modelId} onChange={setModelId} /></div>
            <span className="px-2 text-xs text-[var(--muted-foreground)]">{isWorldModel ? "3D 场景" : resultFormat || "OBJ + GLB"}</span>
            <div className="image-composer-actions">
              <span className="image-composer-cost" title="本次生成消耗积分"><Zap className="h-3 w-3" fill="currentColor" />{cost}</span>
              <GenerateSubmitButton
                compact
                disabled={generating || uploading || !modelId}
                generating={generating}
                title={uploading ? "GLB 上传中..." : generating ? "生成中..." : "开始生成 3D"}
                onClick={handleGenerate}
              />
            </div>
          </>}
        >
          {mode !== "t2_3d" && (
            <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2 rounded-lg bg-[var(--canvas-menu-hover)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
              <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              {referenceImages.length > 0 ? (
                <span className="min-w-0 truncate">
                  已连接 {referenceImages.length} 张参考图
                  {mode === "mv2_3d" ? ` · ${referenceImages.map((_, index) => VIEW_LABELS[index]).join(" / ")}` : ""}
                </span>
              ) : <span>从图片节点连线到此节点作为参考</span>}
              {mode === "i2_3d" && isWorldModel && referenceImages.length > 0 && (
                <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5" title="360° 全景图（宽高比约 2:1）按全景模式重建；普通照片请保持关闭">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--foreground)]"
                    checked={singleImageIsPanorama} onChange={(event) => setPanoOverride(event.target.checked)} />
                  360° 全景图
                </label>
              )}
            </div>
          )}
          {mode !== "i2_3d" ? (
            <textarea
              aria-label="3D 生成描述"
              value={node.prompt || ""}
              onChange={(event) => updateNode(node.id, { prompt: event.target.value })}
              placeholder={mode === "mv2_3d" ? "可选：补充材质、风格或结构要求" : "描述你想生成的 3D 资产..."}
              className="w-full resize-none border-0 bg-transparent text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              style={{ height: 80, maxHeight: 160, outline: "none", boxShadow: "none" }}
            />
          ) : (
            <div className="flex min-h-20 items-center text-xs leading-5 text-[var(--muted-foreground)]">
              图生 3D 使用已连接的单张图片，无需填写描述。
            </div>
          )}
          <details className="group/three-d-settings mt-1 rounded-lg text-xs text-[var(--muted-foreground)]">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1.5 hover:bg-[var(--canvas-menu-hover)]">
              <SlidersHorizontal className="h-3.5 w-3.5" />模型设置<ChevronDown className="h-3 w-3 group-open/three-d-settings:rotate-180" />
            </summary>
            <div className="mt-2 space-y-3 rounded-lg border border-[var(--border)] p-3">
              {isWorldModel ? (
                <div className="leading-5 text-[var(--muted-foreground)]">
                  <div className="font-medium text-[var(--foreground)]">Marble 世界输出</div>
                  <p className="mt-1">生成碰撞 GLB 白膜、SPZ、全景图和缩略图。导演台只连接 GLB 白膜，SPZ 仅作为附加文件下载。</p>
                  <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">场景质量由所选 Marble 模型决定，无需设置面数、PBR 或导出格式。</p>
                </div>
              ) : <>
              <div>
                <div className="mb-1.5 text-[var(--muted-foreground)]">生成类型</div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--canvas-menu-hover)] p-1">
                  {(["Normal", "Geometry"] as CanvasThreeDGenerateType[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={generateType === value}
                      onMouseDown={stop}
                      onClick={(event) => { stop(event); setGenerateType(value); }}
                      className={`h-7 rounded-md transition-colors ${generateType === value ? "bg-[var(--popover)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)]"}`}
                    >
                      {value === "Normal" ? "标准模型" : "纯几何"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 flex justify-between text-[var(--muted-foreground)]"><span>模型面数</span><output>{faceCount.toLocaleString()}</output></span>
                <input
                  type="range"
                  min={3_000}
                  max={1_500_000}
                  step={1_000}
                  value={faceCount}
                  onMouseDown={stop}
                  onChange={(event) => setFaceCount(clampFaceCount(Number(event.target.value)))}
                  className="w-full accent-[var(--foreground)]"
                />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--muted-foreground)]">输出格式</span>
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
                <span><strong className="font-medium text-[var(--foreground)]">PBR 材质</strong><small className="ml-1.5 text-[var(--muted-foreground)]">物理渲染贴图</small></span>
                <button
                  type="button"
                  role="switch"
                  aria-label="PBR 材质"
                  aria-checked={enablePbr}
                  onMouseDown={stop}
                  onClick={(event) => { stop(event); setEnablePbr((value) => !value); }}
                  className={`relative h-5 w-9 rounded-full transition-colors ${enablePbr ? "bg-[var(--foreground)]" : "bg-[var(--border)]"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--popover)] shadow ${enablePbr ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </div>
              </>}
            </div>
          </details>
        </NodeComposer>
      )}
    </NodeShell>
  );
});
