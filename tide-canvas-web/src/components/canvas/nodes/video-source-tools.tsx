"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Upload } from "lucide-react";
import { CanvasReferencePicker } from "./video-reference-picker";
import { AssetPickerModal } from "@/components/studio/create-studio/asset-picker-modal";
import { toast } from "@/components/shared/toast";
import { uploadFileSmart } from "@/lib/api";
import { canvasDropFileInfo, normalizeCanvasDropFile } from "@/lib/canvas-drop-files";
import type { CanvasVideoReferenceKind } from "@/lib/canvas-video-references";
import { generateNodeId, useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import type { AiModelVO } from "@/types/ai";
import { useMountedRef } from "./shared/use-node-runtime";

interface Props {
  nodeId: string;
  allowedKinds: CanvasVideoReferenceKind[];
  model?: AiModelVO;
  disabled: boolean;
  onPick: (source: CanvasNode, isNew?: boolean) => boolean;
  onUploadingChange: (busy: boolean) => void;
}

/** Uploads and asset selections create upstream sources; the current video result is preserved. */
export function VideoSourceTools({ nodeId, allowedKinds, model, disabled, onPick, onUploadingChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState<{ projectId: string | null; nodeId: string; modelId?: string; existingUrls: string[] } | null>(null);
  const mounted = useMountedRef();
  const latest = useRef({ nodeId, onPick, onUploadingChange, disabled, model, allowedKinds });
  useLayoutEffect(() => { latest.current = { nodeId, onPick, onUploadingChange, disabled, model, allowedKinds }; });
  const lock = useRef(false);
  useEffect(() => () => {
    // Deselecting a node unmounts its composer while the parent node stays mounted.
    if (lock.current) latest.current.onUploadingChange(false);
  }, []);
  const accept = allowedKinds.filter((kind) => kind !== "text").map((kind) => `${kind}/*`).join(",");
  const sourceNode = (kind: "image" | "video" | "audio" | "character", url: string, name: string, sizeBytes?: number): CanvasNode => ({
    id: generateNodeId(), type: kind, title: name, x: 0, y: 0, width: 320, height: 220,
    status: "success", fileSize: sizeBytes,
    ...(kind === "video" ? { videoSrc: url } : kind === "audio" ? { audioSrc: url } : { imageSrc: url }),
  });
  const busy = disabled || uploading;
  return <>
    <button type="button" className="image-composer-chip" disabled={busy || !accept} title={accept ? "上传图片、视频或音频作为参考" : "当前模型不支持媒体参考"}
      onClick={() => input.current?.click()}>{uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}上传</button>
    <input ref={input} type="file" accept={accept} className="hidden" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file || lock.current || latest.current.disabled) return;
      const info = canvasDropFileInfo(file);
      if (!info || info.kind === "3d" || !latest.current.allowedKinds.includes(info.kind)) { toast.error("当前模型不支持这种参考素材"); return; }
      const projectId = useCanvasStore.getState().currentProjectId;
      const modelId = latest.current.model?.modelId;
      const active = () => mounted.current
        && latest.current.nodeId === nodeId
        && useCanvasStore.getState().currentProjectId === projectId
        && latest.current.model?.modelId === modelId
        && useCanvasStore.getState().nodes.some((item) => item.id === nodeId);
      if (!active()) return;
      lock.current = true; setUploading(true); latest.current.onUploadingChange(true);
      try {
        // The caller chooses a compatible video mode and validates that mode's file-size limit.
        const result = await uploadFileSmart(normalizeCanvasDropFile(file, info), undefined, { label: "视频参考素材" });
        if (!active()) return;
        if (!result.success || !result.data?.fileUrl) { toast.error(result.message || "素材上传失败"); return; }
        const source = sourceNode(info.kind, result.data.fileUrl, file.name, result.data.fileSize);
        source.fileType = result.data.fileType; source.mimeType = result.data.mimeType;
        if (!latest.current.onPick(source, true)) toast.info("素材已上传到资产库，本次未加入参考");
      } catch (error) {
        if (active()) toast.error(error instanceof Error ? error.message : "素材上传失败");
      } finally {
        lock.current = false;
        if (mounted.current) { setUploading(false); latest.current.onUploadingChange(false); }
      }
    }} />
    <CanvasReferencePicker nodeId={nodeId} allowedKinds={allowedKinds} disabled={busy} onPick={(source) => onPick(source)} />
    <CanvasReferencePicker nodeId={nodeId} allowedKinds={allowedKinds} characterOnly label="角色库" disabled={busy}
      onPick={(source) => onPick(source)} onOpenLibrary={allowedKinds.includes("image") ? () => {
        const state = useCanvasStore.getState();
        if (latest.current.disabled || lock.current || !state.nodes.some((item) => item.id === nodeId)) return;
        const incomingIds = new Set(state.connections.filter((edge) => edge.targetId === nodeId).map((edge) => edge.sourceId));
        setLibrary({ projectId: state.currentProjectId, nodeId, modelId: latest.current.model?.modelId,
          existingUrls: state.nodes.filter((item) => incomingIds.has(item.id)).flatMap((item) => item.imageSrc ? [item.imageSrc] : []) });
      } : undefined} />
    {library && createPortal(<AssetPickerModal kind="image" defaultFilter="character" allowedFilters={["character"]}
      existingUrls={library.existingUrls} className="canvas-asset-picker-theme" onClose={() => setLibrary(null)} onPick={(assets) => {
        const state = useCanvasStore.getState();
        if (!mounted.current || latest.current.disabled || lock.current || latest.current.nodeId !== library.nodeId
          || state.currentProjectId !== library.projectId || latest.current.model?.modelId !== library.modelId
          || !latest.current.allowedKinds.includes("image") || !state.nodes.some((item) => item.id === library.nodeId)) return;
        for (const asset of assets) {
          if (asset.kind !== "image") { toast.error("角色参考仅支持图片素材"); continue; }
          latest.current.onPick(sourceNode("character", asset.url, asset.name || "角色参考", asset.sizeBytes), true);
        }
      }} />, document.body)}
  </>;
}
