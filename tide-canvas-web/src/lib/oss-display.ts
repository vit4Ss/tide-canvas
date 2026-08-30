/**
 * 画布展示用图片降采样：给本站存储公网直链追加 x-oss-process 缩放参数。
 * <p>
 * 生成结果多为 2K~4K 原图，画布卡片实际显示宽度只有几百 px；几十张原图
 * 同屏参与 GPU 合成是画布掉帧的大头。仅在「确定安全」时改写：
 * - 仅 http(s) 且主机为本站存储域（*.aliyuncs.com 直链或 CDN 加速域名；
 *   blob:/data:/本地静态不动）。CDN 回源需开启「保留请求参数」，
 *   x-oss-process 才能透传到 OSS 触发图片处理
 * - 已带查询串的不动（可能是签名 URL，追加参数会破坏签名）
 * 全屏查看/下载/作为生成参考图等场景请继续用原始 URL。
 */

/** 支持 x-oss-process 图片处理的本站存储域（CDN 域名与后台存储配置保持一致）。 */
const PROCESSABLE_HOSTS = ["cdn.mbfczzzz.top"];
// test-cdn 当前不会把 x-oss-process 查询参数传到 OSS：请求 640px 时仍返回
// 原始对象。列表里几十张 2K/4K 原图同时解码会耗尽浏览器内存/GPU，因此该域
// 必须走本站 Next 图片优化器，不能再伪装成 OSS 缩略图。
const NEXT_IMAGE_PROXY_HOSTS = new Set(["test-cdn.mbfczzzz.top"]);
const NEXT_IMAGE_WIDTHS = [16, 32, 48, 64, 96, 128, 160, 256, 384, 512, 640, 750, 828, 1024, 1080, 1200, 1280, 1920, 2048, 3840];
const MAX_DISABLED_URLS = 256;
// Deliberately memory-only: reading sessionStorage during the first client
// render would make its src differ from SSR and cause a hydration mismatch.
// A full reload may retry processing once, then immediately falls back again.
const processingDisabledUrls = new Set<string>();

/**
 * Remember source images that OSS cannot process (most commonly files over
 * the 20 MB source-image limit). The original object remains a valid display
 * URL, so subsequent renders should skip x-oss-process for this page session.
 */
export function disableOssDisplayProcessing(url: string | undefined | null): void {
  if (!url || processingDisabledUrls.has(url)) return;
  processingDisabledUrls.add(url);
  while (processingDisabledUrls.size > MAX_DISABLED_URLS) {
    const oldest = processingDisabledUrls.values().next().value;
    if (typeof oldest !== "string") break;
    processingDisabledUrls.delete(oldest);
  }
}

/** Clear imperative failure styles when an image (including an updated src)
 * loads successfully in a reused DOM element. */
export function restoreOssDisplayImage(image: HTMLImageElement): void {
  image.style.visibility = "";
  delete image.dataset.ossOriginalFallback;
}

/**
 * <img> error recovery for an OSS-derived display URL. The first failure
 * falls back to the original object and disables processing for later views;
 * if the original itself also fails, hide the native broken-image glyph.
 */
export function fallbackOssDisplayImage(
  image: HTMLImageElement,
  originalUrl: string | undefined | null,
): boolean {
  if (!originalUrl) {
    image.style.visibility = "hidden";
    return false;
  }
  const alreadyTriedOriginal =
    image.dataset.ossOriginalFallback === "1" || image.getAttribute("src") === originalUrl;
  if (!alreadyTriedOriginal) {
    disableOssDisplayProcessing(originalUrl);
    image.dataset.ossOriginalFallback = "1";
    image.src = originalUrl;
    return true;
  }
  image.style.visibility = "hidden";
  return false;
}

export function ossDisplayUrl(url: string | undefined | null, width: number): string | undefined {
  if (!url) return url ?? undefined;
  if (processingDisabledUrls.has(url)) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const host = new URL(url).hostname;
    if (NEXT_IMAGE_PROXY_HOSTS.has(host)) {
      const requestedWidth = Math.max(1, Math.round(width));
      const proxyWidth = NEXT_IMAGE_WIDTHS.find((candidate) => candidate >= requestedWidth)
        ?? NEXT_IMAGE_WIDTHS[NEXT_IMAGE_WIDTHS.length - 1];
      return `/_next/image?url=${encodeURIComponent(url)}&w=${proxyWidth}&q=75`;
    }
    if (url.includes("?")) return url;
    if (!host.endsWith(".aliyuncs.com") && !PROCESSABLE_HOSTS.includes(host)) return url;
  } catch {
    return url;
  }
  // m_lfit:等比缩小到宽不超过 width,原图更小则原样返回;不放大、不裁剪
  return `${url}?x-oss-process=image/resize,w_${Math.max(1, Math.round(width))},m_lfit`;
}
