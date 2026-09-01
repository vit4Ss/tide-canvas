/** 量图片的真实像素宽高（一键编辑/工具页吸附比例用）。图通常已在页面上
 *  展示过、命中缓存立即返回；未缓存则最多等 4s，量不出返回 null——调用方
 *  回退到"不传比例"的原行为，不阻塞生成。仅浏览器可用（SSR/Node 返回 null）。 */
export function measureImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined" || !url) {
      resolve(null);
      return;
    }
    const img = new Image();
    let settled = false;
    const done = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 4_000);
    img.onload = () => done(
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? { width: img.naturalWidth, height: img.naturalHeight }
        : null,
    );
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** 视频供应商对参考图片的统一长宽比硬限制。边界值允许通过。 */
export const VIDEO_REFERENCE_IMAGE_ASPECT = { min: 0.4, max: 2.5 } as const;

/**
 * 返回可直接展示给用户的参考图比例错误；null 表示尺寸有效且在供应商范围内。
 * 像素尺寸一并展示，用户无需等生成失败后再猜是哪张图有问题。
 */
export function videoReferenceImageAspectIssue(
  width: number,
  height: number,
  label = "参考图",
): string | null {
  const safeLabel = label.trim() || "参考图";
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return `${safeLabel}：无法读取有效尺寸，请重新选择图片`;
  }
  const ratio = width / height;
  if (ratio >= VIDEO_REFERENCE_IMAGE_ASPECT.min && ratio <= VIDEO_REFERENCE_IMAGE_ASPECT.max) return null;
  return `${safeLabel}：图片长宽比必须在 ${VIDEO_REFERENCE_IMAGE_ASPECT.min} 到 ${VIDEO_REFERENCE_IMAGE_ASPECT.max} 之间，当前为 ${ratio.toFixed(3)}（${Math.round(width)}×${Math.round(height)}）`;
}

/** 把真实像素宽高吸附到候选比例档位（"16:9" 等）里最接近的一档。
 *  用对数距离比较，横竖对称（2:1→16:9 与 1:2→9:16 偏差等价）；
 *  宽高非法或候选全不合法时返回 null，调用方维持"不传比例"的原行为。 */
export function nearestAspectRatio(
  width: number,
  height: number,
  candidates: readonly string[],
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const target = Math.log(width / height);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const [w, h] = candidate.split(":").map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
