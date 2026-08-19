import type { SlotData, ToolKey } from "./types";

export interface StudioReferenceIssue {
  message: string;
  severity: "info" | "error";
  markRequired: boolean;
}

export function uploadedFileUrls(files: SlotData[string]): string[] {
  return files.flatMap((file) => {
    const url = file.url?.trim();
    return url ? [url] : [];
  });
}

function hasUploadedFile(files: SlotData[string]): boolean {
  return uploadedFileUrls(files).length > 0;
}

/**
 * Validate only the reference slots active for the selected model/mode. This
 * intentionally runs before prompt validation: reference-driven modes cannot
 * run without their source material, even when the prompt is also empty.
 */
export function studioReferenceIssue(
  tool: ToolKey,
  activeSlotData: SlotData,
  activeSlotCount: number,
): StudioReferenceIssue | null {
  if (Object.values(activeSlotData).some((files) => files.some((file) => file.uploading))) {
    return { message: "参考素材上传中，请稍候…", severity: "info", markRequired: false };
  }
  if (tool === "ref" && activeSlotCount === 0) {
    return {
      message: "该模型未启用任何全能参考素材，请联系管理员",
      severity: "error",
      markRequired: false,
    };
  }

  const requiredImageReferences = tool === "i2i"
    ? [{ files: activeSlotData.img ?? [], message: "图生图必须上传参考图片" }]
    : tool === "edit"
      ? [{ files: activeSlotData.img ?? [], message: "改图必须上传原图" }]
      : tool === "i2v"
        ? [{ files: activeSlotData.first ?? [], message: "图生视频必须上传首帧图片" }]
        : tool === "flf"
          ? [
              { files: activeSlotData.first ?? [], message: "首尾帧模式需要上传首帧" },
              { files: activeSlotData.last ?? [], message: "首尾帧模式需要上传尾帧" },
            ]
          : [];
  const missingReference = requiredImageReferences.find(({ files }) => !hasUploadedFile(files));
  if (missingReference) {
    return { message: missingReference.message, severity: "info", markRequired: true };
  }
  if (tool === "ref" && !Object.values(activeSlotData).some(hasUploadedFile)) {
    return {
      message: "请先上传参考素材（图片 / 视频 / 音频）",
      severity: "info",
      markRequired: true,
    };
  }
  return null;
}
