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
