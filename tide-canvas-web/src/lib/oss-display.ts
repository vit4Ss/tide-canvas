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

export function ossDisplayUrl(url: string | undefined | null, width: number): string | undefined {
  if (!url) return url ?? undefined;
  if (!/^https?:\/\//i.test(url) || url.includes("?")) return url;
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith(".aliyuncs.com") && !PROCESSABLE_HOSTS.includes(host)) return url;
  } catch {
    return url;
  }
  // m_lfit:等比缩小到宽不超过 width,原图更小则原样返回;不放大、不裁剪
  return `${url}?x-oss-process=image/resize,w_${Math.max(1, Math.round(width))},m_lfit`;
}
