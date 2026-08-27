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
