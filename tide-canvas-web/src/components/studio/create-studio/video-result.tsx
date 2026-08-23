"use client";

/* 全站可复用的视频播放器 + 「截取当前帧」。

   按钮截的是播放器当前停留的那一时刻(currentTime),导出的是视频**原始分辨率**
   的无损 PNG——与播放器被缩放到多大无关。图片先直传自己的 OSS，再由服务端
   原子登记为生成结果，因此只出现在「资产 · 生成历史」里。 */

import { useCallback, useRef, useState, type VideoHTMLAttributes } from "react";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import { captureVideoFrame, VideoFrameError } from "@/lib/video-frame";
import { notifyAssetLibraryChanged } from "@/lib/asset-library-events";
import styles from "./video-result.module.css";

/** 00:03.480 → "00-03-480",用作截图文件名的时间戳部分。 */
function stampOf(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const mm = String(Math.floor(ms / 60000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${mm}-${ss}-${String(ms % 1000).padStart(3, "0")}`;
}

type VideoResultProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  src: string;
  /** Upload/reference previews only need playback; generated results also expose frame capture. */
  showFrameCapture?: boolean;
};

export default function VideoResult({
  src,
  className,
  controls = true,
  playsInline = true,
  preload = "metadata",
  showFrameCapture = true,
  onClick,
  ...videoProps
}: VideoResultProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  // 守卫用 ref 而不是 busy 状态:两次点击落在同一个渲染周期里时，disabled 还没
  // 生效、busy 也还是旧值，两次都会放行——结果是传两份同名截图进资产库。
  const shooting = useRef(false);

  const shoot = useCallback(async () => {
    const el = videoRef.current;
    if (!el || shooting.current) return;
    shooting.current = true;
    // 先把时间点定下来:抓帧要下载视频,期间用户可能继续播放。
    const at = Number.isFinite(el.currentTime) ? Math.max(0, el.currentTime) : 0;
    setBusy(true);
    try {
      if (!(await useAuthStore.getState().ensureSession())) return; // 未登录会跳 /login
      const { blob, width, height } = await captureVideoFrame(src, at);
      const file = new File([blob], `frame-${stampOf(at)}.png`, { type: "image/png" });
      // uploadFileSmart：体积预检 + 预签名直传 OSS。4K 原图 PNG 常有 10~25MB，
      // 走普通 multipart 会整个穿过我们自己的 API 服务器。
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl && res.data.id) {
        const registered = await aiApi.registerCapturedFrame({
          fileId: String(res.data.id),
          captureTime: at,
          width,
          height,
          moveOriginal: !res.data.reused,
        });
        if (!registered.success) {
          // 4xx 是确定性未归档；网络/5xx 即使重试后仍可能是“服务端已提交、
          // 响应丢失”，不能武断告诉用户图片一定在哪个 tab。
          const uncertain =
            !registered.code || registered.code === 408 || registered.code === 429 ||
            (registered.code >= 500 && registered.code < 600);
          notifyAssetLibraryChanged({
            collection: uncertain ? "all" : "upload",
            mediaKind: "image",
            origin: "capture",
          });
          toast.error(
            uncertain
              ? "截帧已上传，保存状态暂未确认，请稍后在资产库查看"
              : registered.message || "截帧已上传，但保存到生成历史失败，请重试",
          );
          return;
        }
        // 生成任务已落库；失效对应缓存，资产页无需整库刷新。
        notifyAssetLibraryChanged({
          collection: "hist",
          mediaKind: "image",
          origin: "capture",
        });
        toast.success(`已截取 ${width}×${height}，已保存至资产 · 生成历史 / 图片`);
      } else {
        toast.error(res.message || "截图上传失败，请重试");
      }
    } catch (e) {
      // 永久性失败(如视频超过代理上限)不该劝用户重试
      toast.error(e instanceof VideoFrameError ? e.message : "截图失败，请重试");
    } finally {
      shooting.current = false;
      setBusy(false);
    }
  }, [src]);

  return (
    <>
      <video
        {...videoProps}
        ref={videoRef}
        className={className}
        src={src}
        controls={controls}
        playsInline={playsInline}
        preload={preload}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
      />
      {showFrameCapture && (
        <button
          type="button"
          className={styles.capture}
          title="截取当前帧（原始分辨率，保存至资产的生成历史）"
          aria-label="截取当前帧"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void shoot();
          }}
        >
          {busy ? (
            <span className={styles.spinner} aria-hidden />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.6h5l1 1.6H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
          )}
          <span className={styles.label}>{busy ? "截取中…" : "截取当前帧"}</span>
        </button>
      )}
    </>
  );
}
