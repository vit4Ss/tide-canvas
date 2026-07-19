import { fetchWithAuth } from "@/lib/http";

/**
 * Frontend image grid slicing utility.
 * The source image is loaded through the same-origin backend download proxy to avoid CORS-tainted canvas reads.
 */
export interface GridSlice {
  /** Row-major cell index, from 0 to rows*cols-1. */
  cellIndex: number;
  blob: Blob;
}

async function loadImageViaProxy(url: string): Promise<{ img: HTMLImageElement; objUrl: string }> {
  const res = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(url)}&name=source`);
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
 * Slice an image into a rows x cols grid.
 * @param cells Optional row-major indexes to slice. Empty means all cells.
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