/**
 * 视频抓帧工具 —— 取出播放到某一时刻的那一帧，保持视频的原始分辨率。
 *
 * 源视频经后端下载代理取回(同源 blob)，与 lib/image-slice.ts 同一理由:
 * OSS/CDN 未必带 CORS 头，直接用页面上那个 <video> 画进 canvas 会把画布污染，
 * toBlob 抛 SecurityError。代价是要把视频再下载一遍——AI 成片通常只有几秒，
 * 可以接受;换来的是任何来源的视频都能稳定截出图。
 */

import { getAccessToken } from "@/lib/http";
import { frameCaptureSeekTarget } from "@/lib/video-frame-policy";

const SEEK_TIMEOUT_MS = 20_000;

/** 带用户可读原因的抓帧失败——调用方直接把 message 展示给用户。 */
export class VideoFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoFrameError";
  }
}

export interface CapturedFrame {
  /** 无损 PNG，尺寸即视频的原始分辨率 */
  blob: Blob;
  width: number;
  height: number;
}

/** 已取回的视频(单槽缓存)。从同一个视频连截多帧是最常见的用法，不缓存就要
    把整段视频反复经代理下载一遍。只留一条:换视频即释放上一条，内存占用因此
    封顶在「一个视频」,不会随页面上视频卡的数量增长。 */
let cached: { src: string; objUrl: string } | null = null;

/** 经后端下载代理把视频取成同源 blob URL。返回的 URL 由本模块管理生命周期。 */
async function fetchVideoAsObjectUrl(url: string): Promise<string> {
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    // 本地 blob:/data: 已是同源可读，无需(也无法)走后端代理。
    return url;
  }
  if (cached?.src === url) return cached.objUrl;
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/files/download?url=${encodeURIComponent(url)}&name=source`, {
    headers,
  });
  if (!res.ok) {
    // 400/403 是确定性拒绝(超过代理 100MB 上限、或这个视频不属于当前账号)，
    // 重试多少次都不会成功——别劝用户重试，直接说清原因。
    if (res.status === 400) throw new VideoFrameError("视频过大，无法截取原始分辨率的帧");
    if (res.status === 403) throw new VideoFrameError("无权访问该视频，无法截帧");
    throw new VideoFrameError("视频读取失败，请稍后重试");
  }
  const objUrl = URL.createObjectURL(await res.blob());
  if (cached) URL.revokeObjectURL(cached.objUrl);
  cached = { src: url, objUrl };
  return objUrl;
}

function onceEvent(el: HTMLVideoElement, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(name, ok);
      el.removeEventListener("error", bad);
      window.clearTimeout(timer);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(`video ${name} failed`));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`video ${name} timed out`));
    }, timeoutMs);
    el.addEventListener(name, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

/**
 * 截取 videoUrl 在 timeSec 处的一帧。
 *
 * 输出为原始分辨率的无损 PNG:画布按 videoWidth/videoHeight 建立，与页面上
 * 播放器的显示尺寸无关，所以缩放播放器不会影响截图清晰度。
 */
export function captureVideoFrame(videoUrl: string, timeSec: number): Promise<CapturedFrame> {
  // 全局串行:并发截两个不同视频时，后一次换缓存会 revoke 掉前一次正在解码的
  // blob URL。排队还顺带避免同时解码两段视频(都是几十 MB 的解码开销)。
  const run = queue.then(
    () => captureFrameNow(videoUrl, timeSec),
    () => captureFrameNow(videoUrl, timeSec),
  );
  // 失败不能把队列变成 rejected，否则后续截帧全被带崩。
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let queue: Promise<void> = Promise.resolve();

async function captureFrameNow(videoUrl: string, timeSec: number): Promise<CapturedFrame> {
  const objUrl = await fetchVideoAsObjectUrl(videoUrl);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    // Metadata is enough to compute a safe target. Actual frame decoding is
    // forced by the seek below; waiting only for loadeddata at time 0 is flaky
    // on browsers that keep an unplayed, detached video metadata-only.
    const metadataReady = onceEvent(video, "loadedmetadata", SEEK_TIMEOUT_MS);
    video.src = objUrl;
    video.load();
    await metadataReady;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("video has no decodable frame");

    // 末尾处 seek 常常落不到有效帧(不同浏览器对 duration 边界处理不一致):
    // 往回让出一点点,取最后一个能解码出来的帧。
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = frameCaptureSeekTarget(timeSec, duration);

    // 0 秒会被规范化到一个极小的正数，确保从未播放过的视频也真正解码首帧。
    if (Math.abs(video.currentTime - target) > 0.00001) {
      const seeked = onceEvent(video, "seeked", SEEK_TIMEOUT_MS);
      video.currentTime = target;
      await seeked;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await onceEvent(video, "loadeddata", SEEK_TIMEOUT_MS);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("frame encode failed");
    return { blob, width, height };
  } finally {
    // 断开这个临时元素与数据源的关联，释放解码器；blob URL 本身归上面的单槽
    // 缓存所有(换视频时才 revoke)，这里不能撤销，否则下次连截就要重新下载。
    video.removeAttribute("src");
    video.load();
  }
}
