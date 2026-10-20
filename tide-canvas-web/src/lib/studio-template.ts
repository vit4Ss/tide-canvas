import type { StudioTemplate } from "./studio-template-api";

export function templateInputs(row: Pick<StudioTemplate, "requirements" | "mode">): string {
  const parts = [
    row.requirements.images ? `${row.requirements.images} 张图片` : "",
    row.requirements.videos ? `${row.requirements.videos} 段视频` : "",
    row.requirements.audio ? `${row.requirements.audio} 段音频` : "",
  ].filter(Boolean);
  return parts.length
    ? parts.join(" + ")
    : row.mode === "ref"
      ? "至少 1 个参考素材"
      : "无需上传素材";
}
