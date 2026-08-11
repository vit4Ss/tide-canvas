"use client";

/* 全站可复用的视频播放器 + 「截取当前帧」。

   按钮截的是播放器当前停留的那一时刻(currentTime),导出的是视频**原始分辨率**
   的无损 PNG——与播放器被缩放到多大无关。图片经普通上传接口落到自己的 OSS、
   由 CDN 分发,并因此出现在「资产 · 上传」里,可直接当垫图继续创作。 */

import { useCallback, useRef, useState, type VideoHTMLAttributes } from "react";
import { uploadFileSmart } from "@/lib/api";
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
};

export default function VideoResult({
  src,
  className,
  controls = true,
  playsInline = true,
  preload = "metadata",
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
    const at = el.currentTime;
    setBusy(true);
    try {
      if (!(await useAuthStore.getState().ensureSession())) return; // 未登录会跳 /login
      const { blob, width, height } = await captureVideoFrame(src, at);
      const file = new File([blob], `frame-${stampOf(at)}.png`, { type: "image/png" });
      // uploadFileSmart：体积预检 + 预签名直传 OSS。4K 原图 PNG 常有 10~25MB，
      // 走普通 multipart 会整个穿过我们自己的 API 服务器。
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        // 服务端已经登记 File 记录；同步让资产页丢弃旧缓存，返回资产页时能
        // 立即在“上传历史 / 图片”看到，而不是仍显示截帧前的列表。
        notifyAssetLibraryChanged({
          collection: "upload",
          mediaKind: "image",
          origin: "capture",
        });
        toast.success(`已截取 ${width}×${height}，已保存至资产 · 上传历史 / 图片`);
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
      <button
        type="button"
        className={styles.capture}
        title="截取当前帧（原始分辨率，保存至资产的上传历史）"
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
    </>
  );
}
