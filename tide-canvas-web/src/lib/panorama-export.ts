import { MAX_PANORAMA_SOURCE_PIXELS, type PanoramaView } from "./panorama-projection";

export interface PanoramaCapture { blob: Blob; width: number; height: number }
let queue: Promise<void> = Promise.resolve();

/** Only one high-resolution export across the entire canvas at a time. Each
 * worker and all its pixel buffers are freed after that image is encoded. */
export function exportPanorama(source: HTMLImageElement, view: PanoramaView, signal: AbortSignal): Promise<PanoramaCapture> {
  // The view belongs to the click, even if its caller later moves the camera.
  const capturedView = { ...view };
  const run = queue.then(() => exportNow(source, capturedView, signal));
  queue = run.then(() => {}, () => {});
  return run;
}

async function exportNow(source: HTMLImageElement, view: PanoramaView, signal: AbortSignal): Promise<PanoramaCapture> {
  signal.throwIfAborted();
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("当前浏览器不支持原画质全景截图，请升级浏览器后重试");
  }
  const sourcePixels = source.naturalWidth * source.naturalHeight;
  if (!Number.isSafeInteger(sourcePixels) || sourcePixels <= 0) throw new Error("全景原图尺寸无效，无法导出");
  if (sourcePixels > MAX_PANORAMA_SOURCE_PIXELS) throw new Error("全景原图超过 4000 万像素，无法安全导出；8K 全景可正常处理");
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const finish = (result?: PanoramaCapture, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      worker?.terminate();
      if (result) resolve(result);
      else reject(error);
    };
    const onAbort = () => finish(undefined, new DOMException("全景截图已取消", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("全景截图处理超时，请重试")), 60_000);
    signal.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      try {
        const bitmap = await createImageBitmap(source);
        if (settled || signal.aborted) { bitmap.close(); onAbort(); return; }
        try {
          worker = new Worker(new URL("./panorama-capture.worker.ts", import.meta.url));
          worker.onmessage = (event: MessageEvent<Partial<PanoramaCapture> & { error?: string } | null>) => {
            const result = event.data;
            if (typeof result?.error === "string") finish(undefined, new Error(result.error));
            else if (result?.blob instanceof Blob && result.blob.type === "image/png" && result.blob.size > 0
              && result.width === view.width && result.height === view.height) finish({ blob: result.blob, width: view.width, height: view.height });
            else finish(undefined, new Error("全景截图结果无效"));
          };
          worker.onerror = (event) => { event.preventDefault(); finish(undefined, new Error("全景截图处理失败，请重试")); };
          worker.onmessageerror = () => finish(undefined, new Error("全景截图读取失败"));
          worker.postMessage({ bitmap, view }, [bitmap]);
        } catch (error) { bitmap.close(); throw error; }
      } catch (error) { finish(undefined, error); }
    })();
  });
}
