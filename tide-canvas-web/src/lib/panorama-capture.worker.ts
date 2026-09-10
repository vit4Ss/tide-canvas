import { MAX_PANORAMA_SOURCE_PIXELS, projectPanorama, type PanoramaView } from "./panorama-projection";

self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; view: PanoramaView }>) => {
  const { bitmap, view } = event.data;
  let sourceCanvas: OffscreenCanvas | undefined;
  let outputCanvas: OffscreenCanvas | undefined;
  try {
    const { width, height } = bitmap;
    if (width * height > MAX_PANORAMA_SOURCE_PIXELS) throw new Error("全景原图超过 4000 万像素，无法安全导出；8K 全景可正常处理");
    sourceCanvas = new OffscreenCanvas(width, height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!sourceContext) throw new Error("浏览器无法读取全景原图");
    sourceContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    const source = sourceContext.getImageData(0, 0, width, height);
    sourceCanvas.width = sourceCanvas.height = 1;
    const pixels = projectPanorama(source.data, width, height, view);
    outputCanvas = new OffscreenCanvas(view.width, view.height);
    const context = outputCanvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("浏览器无法创建全景截图");
    context.putImageData(new ImageData(pixels, view.width, view.height), 0, 0);
    if (typeof outputCanvas.convertToBlob !== "function") throw new Error("当前浏览器不支持原画质全景截图，请升级浏览器后重试");
    const blob = await outputCanvas.convertToBlob({ type: "image/png" });
    if (!blob.size || blob.type !== "image/png") throw new Error("全景截图编码失败");
    self.postMessage({ blob, width: view.width, height: view.height });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "全景截图失败" });
  } finally {
    bitmap.close();
    if (sourceCanvas) sourceCanvas.width = sourceCanvas.height = 1;
    if (outputCanvas) outputCanvas.width = outputCanvas.height = 1;
  }
};
