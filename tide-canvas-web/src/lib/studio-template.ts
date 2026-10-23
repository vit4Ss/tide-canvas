import type { StudioTemplate } from "./studio-template-api";

export function templateInputs(row: Pick<StudioTemplate, "requirements" | "mode">): string {
  const optional = row.requirements.optionalImages?.length || 0;
  const parts = [
    row.requirements.images ? optional ? `${row.requirements.images-optional} 张必填图片 + ${optional} 张选填图片` : `${row.requirements.images} 张图片` : "",
    row.requirements.videos ? `${row.requirements.videos} 段视频` : "",
    row.requirements.audio ? `${row.requirements.audio} 段音频` : "",
  ].filter(Boolean);
  return parts.length
    ? parts.join(" + ")
    : row.mode === "ref"
      ? "至少 1 个参考素材"
      : "无需上传素材";
}
