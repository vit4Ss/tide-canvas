export type CanvasDropKind = "image" | "video" | "audio" | "3d";

export interface CanvasDropFileInfo {
  kind: CanvasDropKind;
  mimeType: string;
}

interface CanvasStoredFileLike {
  name?: string;
  type?: string;
  fileType?: string;
}

const EXTENSIONS: Record<string, CanvasDropFileInfo> = {
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".jpe": { kind: "image", mimeType: "image/jpeg" },
  ".jfif": { kind: "image", mimeType: "image/jpeg" },
  ".png": { kind: "image", mimeType: "image/png" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".avif": { kind: "image", mimeType: "image/avif" },
  ".bmp": { kind: "image", mimeType: "image/bmp" },
  ".mp4": { kind: "video", mimeType: "video/mp4" },
  ".webm": { kind: "video", mimeType: "video/webm" },
  ".mov": { kind: "video", mimeType: "video/quicktime" },
  ".mkv": { kind: "video", mimeType: "video/x-matroska" },
  ".avi": { kind: "video", mimeType: "video/x-msvideo" },
  ".m4v": { kind: "video", mimeType: "video/x-m4v" },
  ".mp3": { kind: "audio", mimeType: "audio/mpeg" },
  ".wav": { kind: "audio", mimeType: "audio/wav" },
  ".m4a": { kind: "audio", mimeType: "audio/mp4" },
  ".aac": { kind: "audio", mimeType: "audio/aac" },
  ".ogg": { kind: "audio", mimeType: "audio/ogg" },
  ".oga": { kind: "audio", mimeType: "audio/ogg" },
  ".flac": { kind: "audio", mimeType: "audio/flac" },
  ".opus": { kind: "audio", mimeType: "audio/ogg" },
  ".glb": { kind: "3d", mimeType: "model/gltf-binary" },
};

function extensionOf(name: string): string {
  return name.trim().toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
}

/**
 * Classify a file dropped on the infinite canvas. Windows and browser drags
 * can leave File.type empty or generic, so filename evidence is the durable
 * fallback. SVG remains blocked by the shared upload security policy; GLTF is
 * intentionally limited to self-contained GLB files because loose .gltf files
 * may depend on sibling buffers and textures that a single-file drop cannot
 * preserve.
 */
export function canvasDropFileInfo(file: { name?: string; type?: string }): CanvasDropFileInfo | null {
  const extension = extensionOf(file.name ?? "");
  if ([".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".xml"].includes(extension)) return null;
  const mimeType = (file.type ?? "").toLowerCase().split(";", 1)[0].trim();
  if (mimeType && mimeType !== "application/octet-stream") {
    if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") return { kind: "image", mimeType };
    if (mimeType.startsWith("video/")) return { kind: "video", mimeType };
    if (mimeType.startsWith("audio/")) return { kind: "audio", mimeType };
    if (mimeType === "model/gltf-binary") return { kind: "3d", mimeType };
    // A specific but unsupported MIME is stronger evidence than the filename.
    // Never relabel active or unrelated content merely because it ends in .png.
    return null;
  }
  return EXTENSIONS[extension] ?? null;
}

/** Stored legacy assets may have only fileType and no MIME/name extension. Use
 * that hint only when there is no contradictory format evidence at all. */
export function canvasStoredFileInfo(file: CanvasStoredFileLike): CanvasDropFileInfo | null {
  const detected = canvasDropFileInfo(file);
  if (detected) return detected;
  const extension = extensionOf(file.name ?? "");
  const mimeType = (file.type ?? "").toLowerCase().split(";", 1)[0].trim();
  if (extension || (mimeType && mimeType !== "application/octet-stream")) return null;
  if (file.fileType === "image") return { kind: "image", mimeType: "image/png" };
  if (file.fileType === "video") return { kind: "video", mimeType: "video/mp4" };
  return null;
}

export function normalizeCanvasDropFile(file: File, info: CanvasDropFileInfo): File {
  const declared = file.type.toLowerCase().split(";", 1)[0].trim();
  if (declared === info.mimeType) return file;
  return new File([file], file.name, { type: info.mimeType, lastModified: file.lastModified });
}

export const CANVAS_DROP_ACCEPT = "image/*,video/*,audio/*,.glb";
export const CANVAS_AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus";
