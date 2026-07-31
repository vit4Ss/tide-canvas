/* ── 内容感知环境光（YouTube Ambient Mode 思路）─────────────────────────────
   取生成图的平均主色，作为该灯箱片泛光的颜色（CSS 变量 --amb，studio.css 的
   .ws-runimg box-shadow 消费）。跨域图片直接进 canvas 会污染画布，所以优先
   借道 Next 图片优化器（/_next/image 同源代理）取 64px 缩略图；失败再试
   crossOrigin 直连；都不行则静默回退中性黑影（--amb 缺省值）。
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。 */

import { useEffect, useState } from "react";

const ambientCache = new Map<string, string | null>();

function extractAmbient(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 10;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 10, 10);
    const d = ctx.getImageData(0, 0, 10, 10).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    r /= n; g /= n; b /= n;
    // 平均色往往偏暗，提亮到可作泛光的亮度（暗房底本来就黑，太暗看不见）。
    const boost = Math.max(1, 110 / Math.max(r, g, b, 1));
    const f = (v: number) => Math.min(255, Math.round(v * boost));
    return `${f(r)} ${f(g)} ${f(b)}`;
  } catch {
    return null; // canvas 被跨域污染
  }
}

export function useAmbient(url?: string): string | null {
  // 缓存命中时在渲染期直接取值；effect 只负责未命中时的异步提取（完成后
  // bump 触发一次重渲染，再从缓存读到结果）。
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || ambientCache.has(url)) return;
    let alive = true;
    const finish = (v: string | null) => {
      ambientCache.set(url, v);
      if (alive) bump((n) => n + 1);
    };
    // 1) 同源优化器缩略图（不污染 canvas）；2) 失败退回 CORS 直连。
    const viaProxy = new Image();
    viaProxy.onload = () => finish(extractAmbient(viaProxy));
    viaProxy.onerror = () => {
      const direct = new Image();
      direct.crossOrigin = "anonymous";
      direct.onload = () => finish(extractAmbient(direct));
      direct.onerror = () => finish(null);
      direct.src = url;
    };
    // 注意 Next 16 只接受 images.qualities 白名单里的 q（默认仅 75）。
    viaProxy.src = `/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`;
    return () => {
      alive = false;
    };
  }, [url]);
  return (url ? ambientCache.get(url) : null) ?? null;
}
