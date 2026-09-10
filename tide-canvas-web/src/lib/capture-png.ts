/** PNG encoding must settle even when the browser drops its callback. The
 * caller releases the drawing buffer in finally, on success and failure. */
export function encodeCapturePNG(canvas: HTMLCanvasElement, timeoutMs = 30_000): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("截图编码超时，请重试"));
    }, timeoutMs);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    try {
      canvas.toBlob((blob) => {
        if (settled) return;
        if (!blob?.size || blob.type !== "image/png") { fail(new Error("截图编码失败，请重试")); return; }
        settled = true;
        clearTimeout(timer);
        resolve(blob);
      }, "image/png");
    } catch (error) { fail(error); }
  });
}
