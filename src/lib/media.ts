import type { AiTaskVO } from "../types/ai";
import type { FileVO } from "../types/file";

export type AssetKind = "image" | "video" | "audio" | "3d" | "text" | "file";
export interface AssetMedia {
  kind: AssetKind;
  urls: string[];
  poster: string;
  text: string;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function mediaUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url || /[\p{Cc}\\]/u.test(url)) return "";
  if (/^\/(?!\/)/.test(url)) return url;
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : "";
  } catch { return ""; }
}

const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : [];
const uniqueUrls = (values: unknown[]) => [...new Set(values.map(mediaUrl).filter(Boolean))];

export function resultUrls(meta: unknown, primary = ""): string[] {
  const parsed = object(meta);
  return uniqueUrls([
    primary,
    ...(Array.isArray(parsed.urls) ? parsed.urls : []),
    ...rows(parsed.assets).map((asset) => asset.url),
    ...rows(parsed.tracks).map((track) => track.url),
  ]);
}

export function taskMedia(task: Pick<AiTaskVO, "handler" | "resultMeta" | "resultUrl">): AssetMedia {
  const meta = object(task.resultMeta);
  let urls = resultUrls(meta, task.resultUrl);
  const text = typeof meta.text === "string" && meta.text.trim() ? meta.text : "";
  let kind: AssetKind = "image";
  if (["assistant_chat", "skill_text_completion"].includes(task.handler) || (text && !urls.length)) kind = "text";
  else if (task.handler === "generate_3d") kind = "3d";
  else if (task.handler === "text_to_audio") kind = "audio";
  else if (task.handler.includes("video") && task.handler !== "video_frame_capture") kind = "video";

  const assets = rows(meta.assets);
  if (kind === "3d" && !mediaUrl(task.resultUrl)) {
    const glb = assets.find((asset) => String(asset.type || "").toLowerCase() === "glb" && mediaUrl(asset.url));
    if (glb) urls = uniqueUrls([glb.url, ...urls]);
  }
  const poster = uniqueUrls([
    meta.posterUrl, meta.poster_url, meta.thumbnailUrl, meta.thumbnail_url,
    meta.coverUrl, meta.cover_url, meta.previewImageUrl, meta.preview_image_url,
    ...assets.flatMap((asset) => [asset.previewImageUrl, asset.preview_image_url]),
    ...rows(meta.tracks).map((track) => track.coverUrl),
  ])[0] || "";
  return { kind, urls, poster, text };
}

export function fileMedia(file: Pick<FileVO, "fileType" | "fileUrl" | "mimeType" | "originalName">): AssetMedia {
  const mime = file.mimeType?.toLowerCase() || "";
  const kind: AssetKind = file.fileType === "image" || mime.startsWith("image/") ? "image"
    : file.fileType === "video" || mime.startsWith("video/") ? "video"
    : mime.startsWith("audio/") ? "audio"
    : /\.(glb|gltf|obj|fbx|ply|spz)$/i.test(file.originalName) ? "3d" : "file";
  return { kind, urls: uniqueUrls([file.fileUrl]), poster: "", text: "" };
}
