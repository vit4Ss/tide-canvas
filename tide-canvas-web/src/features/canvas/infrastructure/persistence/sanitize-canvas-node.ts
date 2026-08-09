import type { CanvasNode } from "../../domain/models/canvas-document";

/** blob: 地址只在当前页面会话有效，绝不能写入持久化画布。 */
function isTransientObjectUrl(url?: string): boolean {
  return Boolean(url?.startsWith("blob:"));
}

/**
 * 保存前移除仍处于上传或本地处理阶段的临时媒体地址。
 *
 * 上传完成后节点会写回正式 URL，并自然触发下一轮自动保存；保留 blob URL
 * 反而会让刷新后的画布持有不可恢复的死链。
 */
export function sanitizeCanvasNodeForPersistence(node: CanvasNode): CanvasNode {
  const hasTransientMedia =
    isTransientObjectUrl(node.imageSrc)
    || isTransientObjectUrl(node.videoSrc)
    || isTransientObjectUrl(node.audioSrc)
    || node.images?.some(isTransientObjectUrl)
    || node.audioTracks?.some((track) => isTransientObjectUrl(track.url));

  if (!hasTransientMedia) return node;

  const sanitized = { ...node };
  if (isTransientObjectUrl(sanitized.imageSrc)) delete sanitized.imageSrc;
  if (isTransientObjectUrl(sanitized.videoSrc)) delete sanitized.videoSrc;
  if (isTransientObjectUrl(sanitized.audioSrc)) delete sanitized.audioSrc;

  if (sanitized.images) {
    sanitized.images = sanitized.images.filter((url) => !isTransientObjectUrl(url));
    if (sanitized.images.length === 0) delete sanitized.images;
  }

  if (sanitized.audioTracks) {
    sanitized.audioTracks = sanitized.audioTracks.filter(
      (track) => !isTransientObjectUrl(track.url),
    );
    if (sanitized.audioTracks.length === 0) delete sanitized.audioTracks;
  }

  return sanitized;
}
