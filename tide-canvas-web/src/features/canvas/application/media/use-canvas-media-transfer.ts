"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { toast } from "@/components/shared/toast";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { createNode } from "@/lib/canvas-helpers";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { FileCategory, FileType, type FileVO } from "@/types/file";
import { captureCanvasError } from "../../infrastructure/telemetry/canvas-telemetry";
import { currentCanvasUploadContext } from "./canvas-upload-context";

interface CanvasPoint {
  x: number;
  y: number;
}

interface MediaContextTarget extends CanvasPoint {
  nodeId?: string;
}

interface UseCanvasMediaTransferOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  contextTarget: MediaContextTarget | null;
  screenToWorld: (clientX: number, clientY: number) => CanvasPoint;
}

export interface CanvasMediaTransferState {
  assetsOpen: boolean;
  setAssetsOpen: Dispatch<SetStateAction<boolean>>;
  assetsRefreshKey: number;
  isDraggingFile: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  addAssetToCanvas: (file: FileVO) => void;
  saveContextAsset: () => Promise<void>;
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  handleFileDrop: (event: DragEvent<HTMLDivElement>) => Promise<void>;
  requestUpload: () => void;
  handleUploadPick: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

function supportedMediaFiles(files: FileList | readonly File[]): File[] {
  return Array.from(files).filter(
    (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 素材选择、系统拖放和右键上传共用的媒体落画布流程。 */
export function useCanvasMediaTransfer({
  containerRef,
  contextTarget,
  screenToWorld,
}: UseCanvasMediaTransferOptions): CanvasMediaTransferState {
  const nodes = useCanvasStore((state) => state.nodes);
  const addNode = useCanvasStore((state) => state.addNode);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadWorldRef = useRef<CanvasPoint | null>(null);

  const viewportCenter = useCallback((): CanvasPoint => {
    const rect = containerRef.current?.getBoundingClientRect();
    return screenToWorld(
      rect ? rect.left + rect.width / 2 : 0,
      rect ? rect.top + rect.height / 2 : 0,
    );
  }, [containerRef, screenToWorld]);

  const addAssetToCanvas = useCallback((file: FileVO): void => {
    const world = viewportCenter();
    const type = file.category === FileCategory.CHARACTER
      ? CHARACTER_NODE_TYPE
      : file.category === FileCategory.SCENE
        ? SCENE_NODE_TYPE
        : file.fileType === FileType.VIDEO ? "video" : "image";
    const node = createNode(type, world.x, world.y, nodes);
    if (type === "video") node.videoSrc = file.fileUrl;
    else node.imageSrc = file.fileUrl;
    node.status = "success";
    node.fileSize = file.fileSize;
    node.fileType = file.fileType;
    node.mimeType = file.mimeType;
    if (file.originalName) node.title = file.originalName;
    addNode(node);
    selectNode(node.id);
  }, [addNode, nodes, selectNode, viewportCenter]);

  const saveContextAsset = useCallback(async (): Promise<void> => {
    const node = nodes.find((item) => item.id === contextTarget?.nodeId);
    const url = node?.videoSrc || node?.imageSrc;
    if (!url) {
      toast.info("该节点暂无可保存的图片/视频");
      return;
    }

    const response = await fileApi.saveFromUrl({
      url,
      fileType: node.videoSrc ? "video" : "image",
      category: node.type === CHARACTER_NODE_TYPE
        ? FileCategory.CHARACTER
        : node.type === SCENE_NODE_TYPE ? FileCategory.SCENE : FileCategory.GENERAL,
      originalName: node.title,
      ...currentCanvasUploadContext(),
    });
    if (response.success) {
      toast.success("已保存到我的素材");
      setAssetsOpen(true);
      setAssetsRefreshKey((key) => key + 1);
    } else {
      toast.error(response.message || "保存失败");
    }
  }, [contextTarget?.nodeId, nodes]);

  const uploadFilesAt = useCallback(async (files: File[], world: CanvasPoint): Promise<void> => {
    toast.info(files.length > 1 ? `正在上传 ${files.length} 个文件...` : "正在上传...");
    let completed = 0;

    await Promise.all(files.map(async (file, index) => {
      const isVideo = file.type.startsWith("video/");
      const previewUrl = URL.createObjectURL(file);
      const snapshot = useCanvasStore.getState();
      const node = createNode(
        isVideo ? "video" : "image",
        world.x + index * 48,
        world.y + index * 48,
        snapshot.nodes,
      );
      if (isVideo) node.videoSrc = previewUrl;
      else node.imageSrc = previewUrl;
      node.status = "idle";
      node.uploading = true;
      node.uploadProgress = 0;
      node.fileSize = file.size;
      node.fileType = isVideo ? "video" : "image";
      node.mimeType = file.type;
      if (file.name) node.title = file.name;
      addNode(node);
      selectNode(node.id);

      try {
        const response = await uploadFileSmart(file, (progress) => {
          useCanvasStore.getState().updateNode(node.id, { uploadProgress: progress });
        }, currentCanvasUploadContext());
        if (response.success && response.data?.fileUrl) {
          useCanvasStore.getState().updateNode(node.id, {
            ...(isVideo
              ? { videoSrc: response.data.fileUrl }
              : { imageSrc: response.data.fileUrl }),
            status: "success",
            uploading: false,
            uploadProgress: 100,
            fileSize: response.data.fileSize,
            fileType: response.data.fileType,
            mimeType: response.data.mimeType,
          });
          completed += 1;
        } else {
          useCanvasStore.getState().updateNode(node.id, {
            ...(isVideo ? { videoSrc: undefined } : { imageSrc: undefined }),
            status: "error",
            uploading: false,
            uploadProgress: 0,
          });
          toast.error(`上传失败：${response.message || file.name}`);
        }
      } catch (error) {
        useCanvasStore.getState().updateNode(node.id, {
          ...(isVideo ? { videoSrc: undefined } : { imageSrc: undefined }),
          status: "error",
          uploading: false,
          uploadProgress: 0,
        });
        captureCanvasError("canvas.media.upload_failed", error, {
          mediaType: isVideo ? "video" : "image",
          fileSize: file.size,
        });
        toast.error(`上传失败：${errorMessage(error, file.name)}`);
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    }));

    if (completed > 0) {
      toast.success(completed > 1 ? `已添加 ${completed} 个节点` : "已添加到画布");
    }
  }, [addNode, selectNode]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFile(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDraggingFile(false);
  }, []);

  const handleFileDrop = useCallback(async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setIsDraggingFile(false);
    const files = supportedMediaFiles(event.dataTransfer.files);
    if (files.length === 0) {
      if (event.dataTransfer.files.length > 0) toast.error("仅支持拖入图片或视频");
      return;
    }
    await uploadFilesAt(files, screenToWorld(event.clientX, event.clientY));
  }, [screenToWorld, uploadFilesAt]);

  const requestUpload = useCallback((): void => {
    uploadWorldRef.current = contextTarget
      ? { x: contextTarget.x, y: contextTarget.y }
      : null;
    uploadInputRef.current?.click();
  }, [contextTarget]);

  const handleUploadPick = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = supportedMediaFiles(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const world = uploadWorldRef.current ?? viewportCenter();
    uploadWorldRef.current = null;
    await uploadFilesAt(files, world);
  }, [uploadFilesAt, viewportCenter]);

  return {
    assetsOpen,
    setAssetsOpen,
    assetsRefreshKey,
    isDraggingFile,
    uploadInputRef,
    addAssetToCanvas,
    saveContextAsset,
    handleDragOver,
    handleDragLeave,
    handleFileDrop,
    requestUpload,
    handleUploadPick,
  };
}
