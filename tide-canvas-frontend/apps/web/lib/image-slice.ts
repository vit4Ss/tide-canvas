/**
 * 前端图片网格切分工具。
 * 源图经后端下载代理取回(同源 blob)，规避上游(relay/MJ 等)无 CORS 头导致的 canvas 污染；
 * 切块在浏览器完成(原生支持 WebP/AVIF 解码)，调用方负责后续上传与展示。
 */

export interface GridSlice {
  /** 行优先的格子索引(0..rows*cols-1) */
  cellIndex: number;
  blob: Blob;
}

/** 经后端下载代理加载图片为可读像素的 HTMLImageElement(返回的 objUrl 由调用方负责 revoke) */
async function loadImageViaProxy(url: string): Promise<{ img: HTMLImageElement; objUrl: string }> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const res = await fetch(`/api/files/download?url=${encodeURIComponent(url)}&name=source`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`fetch source failed: ${res.status}`);
  const objUrl = URL.createObjectURL(await res.blob());
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = objUrl;
    });
  } catch (e) {
    URL.revokeObjectURL(objUrl);
    throw e;
  }
  return { img, objUrl };
}

/**
 * 把图片按 rows×cols 网格切块。
 *
 * @param cells 指定只切这些格子(行优先索引)；空/缺省切全部
 */
export async function sliceImageGrid(
  sourceUrl: string,
  rows: number,
  cols: number,
  cells?: number[] | null,
): Promise<GridSlice[]> {
  const { img, objUrl } = await loadImageViaProxy(sourceUrl);
  try {
    const fullW = img.naturalWidth;
    const fullH = img.naturalHeight;
    if (!fullW || !fullH) throw new Error("empty image");
    const order = cells && cells.length ? cells : Array.from({ length: rows * cols }, (_, i) => i);
    const slices: GridSlice[] = [];
    for (const idx of order) {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = Math.floor((c * fullW) / cols);
      const y = Math.floor((r * fullH) / rows);
      const w = Math.floor(((c + 1) * fullW) / cols) - x;
      const h = Math.floor(((r + 1) * fullH) / rows) - y;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("encode failed");
      slices.push({ cellIndex: idx, blob });
    }
    return slices;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}
