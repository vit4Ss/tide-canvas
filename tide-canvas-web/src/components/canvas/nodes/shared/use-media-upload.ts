"use client";

import { useCallback, useRef, useState } from "react";
import { uploadFileSmart } from "@/lib/api";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import { resolveModelReferenceLimitBytes } from "@/lib/upload-limits";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { toast } from "@/components/shared/toast";
import type { AiModelVO } from "@/types/ai";
import { FileCategory } from "@/types/file";
import { useMountedRef } from "./use-node-runtime";
import {
  canCommitCanvasMediaUpload,
  canReplaceCanvasMedia,
} from "@/lib/canvas-generation-guard";

export type UploadMediaKind = "image" | "video";

/** 图片/视频上传的差异全部收敛在这张表：写回字段、成功后状态、大小上限口径、提示文案 */
const KIND_META: Record<UploadMediaKind, { status: "idle" | "success"; label: string; successToast: string }> = {
  image: { status: "idle", label: "参考图", successToast: "图片已上传，可输入指令进行编辑" },
  video: { status: "success", label: "参考视频", successToast: "视频已上传" },
};

/** 媒体文件上传生命周期：本地 blob 预览 + 原始分辨率探测 + 进度上报 + 成功后写回托管 URL。
 *  送后端只用托管 URL，永不送 blob:；预览 blob 在 finally 统一 revoke，探测 blob 在自身回调回收。 */
export function useMediaUpload(node: CanvasNode, kind: UploadMediaKind, selectedModel: AiModelVO | undefined) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // 上传/加载探测到的原始分辨率，供头部「W × H」展示（节点侧展示图 onLoad 也会回填）
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const uploadAttemptRef = useRef(0);
  const mountedRef = useMountedRef();
  const assetCategory =
    node.type === CHARACTER_NODE_TYPE
      ? FileCategory.CHARACTER
      : node.type === SCENE_NODE_TYPE
        ? FileCategory.SCENE
        : FileCategory.GENERAL;

  // 打开文件选择器
  const openFilePicker = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const current = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
    if (!canReplaceCanvasMedia(current)) {
      toast.info(current?.uploading ? "素材正在上传，请稍候" : "生成期间暂不能替换素材");
      return;
    }
    fileInputRef.current?.click();
  }, [node.id]);

  // 上传媒体文件并设为节点素材（带进度；上传中显示模糊预览 + 百分比）
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const current = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
    if (!canReplaceCanvasMedia(current)) {
      toast.info(current?.uploading ? "素材正在上传，请稍候" : "生成期间暂不能替换素材");
      return;
    }
    const attempt = uploadAttemptRef.current + 1;
    uploadAttemptRef.current = attempt;
    // Store-level uploading is the cross-entry mutex: every generation path
    // sees it synchronously, including actions outside this component.
    updateNode(node.id, { uploading: true, uploadProgress: 0 }, false);
    const objUrl = URL.createObjectURL(file);
    setLocalPreview(objUrl);
    setDims(null); // 换新文件先清掉上一次的尺寸，成功后才由本次探测回填
    // 探测原始分辨率用于头部「W × H」展示。探测用独立的 objectURL,在自身
    // 回调里回收——共用预览 URL 的话,上传瞬间失败时 finally 的 revoke 会
    // 抢在加载完成之前执行,探测报错、尺寸标签永远不出现。
    const probeUrl = URL.createObjectURL(file);
    if (kind === "image") {
      const probe = document.createElement("img");
      const releaseProbe = () => { probe.onload = null; probe.onerror = null; URL.revokeObjectURL(probeUrl); };
      probe.onload = () => { if (mountedRef.current) setDims({ w: probe.naturalWidth, h: probe.naturalHeight }); releaseProbe(); };
      probe.onerror = releaseProbe;
      probe.src = probeUrl;
    } else {
      const probe = document.createElement("video");
      probe.preload = "metadata";
      const releaseProbe = () => { probe.onloadedmetadata = null; probe.onerror = null; URL.revokeObjectURL(probeUrl); };
      probe.onloadedmetadata = () => { if (mountedRef.current) setDims({ w: probe.videoWidth, h: probe.videoHeight }); releaseProbe(); };
      probe.onerror = releaseProbe;
      probe.src = probeUrl;
    }
    setUploadPct(0);
    setUploading(true);
    let ok = false;
    try {
      const res = await uploadFileSmart(file, (pct) => {
        if (mountedRef.current) setUploadPct(pct);
      }, {
        maxBytes: resolveModelReferenceLimitBytes(selectedModel, kind),
        label: KIND_META[kind].label,
        category: assetCategory,
      });
      if (res.success) {
        const latest = useCanvasStore.getState().nodes.find((item) => item.id === node.id);
        if (attempt !== uploadAttemptRef.current || !canCommitCanvasMediaUpload(latest)) {
          toast.info("节点已开始生成，本次上传未替换当前素材");
          return;
        }
        const patch: Partial<CanvasNode> = {
          status: KIND_META[kind].status,
          fileSize: res.data.fileSize,
          fileType: res.data.fileType,
          mimeType: res.data.mimeType,
        };
        if (kind === "image") {
          patch.imageSrc = res.data.fileUrl;
          patch.images = undefined;
        }
        else patch.videoSrc = res.data.fileUrl;
        // Clear the transient mutex before recording history, otherwise Undo
        // would restore a permanently uploading node. The user-visible media
        // replacement itself is one deliberate, reversible history step.
        updateNode(node.id, { uploading: false, uploadProgress: undefined }, false);
        updateNode(node.id, patch, true);
        ok = true;
        toast.success(KIND_META[kind].successToast);
      } else {
        toast.error(res.message || "上传失败");
      }
    } catch {
      toast.error("上传失败");
    } finally {
      if (attempt === uploadAttemptRef.current) {
        updateNode(node.id, { uploading: false, uploadProgress: undefined }, false);
      }
      if (mountedRef.current) {
        setUploading(false);
        setLocalPreview(null);
        // 失败(或探测晚于失败回填)时清掉尺寸标签，避免上传失败后残留一枚孤立的 W×H。
        if (!ok) setDims(null);
      }
      URL.revokeObjectURL(objUrl);
    }
  }, [assetCategory, kind, mountedRef, node.id, selectedModel, updateNode]);

  const mediaSrc = kind === "image" ? node.imageSrc : node.videoSrc;
  const nodeUploading = uploading || node.uploading === true;
  const nodeUploadPct = uploading ? uploadPct : node.uploadProgress ?? 0;
  const uploadPreviewSrc = localPreview || mediaSrc || null;

  return {
    fileInputRef,
    openFilePicker,
    handleFileUpload,
    nodeUploading,
    nodeUploadPct,
    uploadPreviewSrc,
    dims,
    setDims,
    mountedRef,
  };
}
