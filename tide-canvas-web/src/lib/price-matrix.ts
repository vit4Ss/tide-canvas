/**
 * 价格矩阵容错查找 —— 与服务端 resolveCost（pricing.go 的 matrixLookupFuzzy）
 * 同口径：键大小写、时长带不带 "s"、行列轴序全部兼容。显示端与计费端必须
 * 用同一套规则，否则会出现「界面显示一个价、实际扣另一个价」。
 * 矩阵单元格兼容 number 与数字字符串（后台历史数据两种都有）。
 */

type PriceMatrix = Record<string, Record<string, number | string>> | undefined;

/** 一个轴键的大小写候选（原样 / 小写 / 大写，去重）。 */
export function keyVariants(k: string | number): string[] {
  const s = String(k).trim();
  if (!s) return [];
  return Array.from(new Set([s, s.toLowerCase(), s.toUpperCase()]));
}

/** 时长轴额外兼容 "s" 后缀两种写法（后台存 "4s"，选择器里是数字 4）。 */
export function durationVariants(k: string | number): string[] {
  const base = String(k).trim();
  if (!base) return [];
  const alt = base.endsWith("s") ? base.slice(0, -1) : `${base}s`;
  return Array.from(new Set([...keyVariants(base), ...keyVariants(alt)]));
}

/** 逐候选组合查矩阵（两种嵌套轴序都试），命中第一个正数即返回；未命中 undefined。 */
export function matrixPrice(matrix: PriceMatrix, aKeys: string[], bKeys: string[]): number | undefined {
  if (!matrix) return undefined;
  for (const a of aKeys) {
    for (const b of bKeys) {
      for (const v of [matrix[a]?.[b], matrix[b]?.[a]]) {
        if (v == null) continue;
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return undefined;
}
