"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Play } from "lucide-react";
import { ossDisplayUrl, fallbackOssDisplayImage } from "@/lib/oss-display";
import type { StudioTemplate } from "@/lib/studio-template-api";
import css from "./template-library.module.css";

export function TemplateMedia({
  row,
  active = false,
  controls = false,
  width = 640,
}: {
  row: Pick<StudioTemplate, "mediaType" | "previewUrl" | "coverUrl" | "title">;
  active?: boolean;
  controls?: boolean;
  width?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const source = row.previewUrl;
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (active && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      void el.play().catch(() => {});
    else if (!controls) el.pause();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) el.pause();
      },
      { threshold: 0 },
    );
    observer.observe(el);
    const pause = () => {
      if (document.hidden) el.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pause);
      el.pause();
    };
  }, [active, controls, source]);
  return (
    <div className={css.media}>
      {row.coverUrl && !imageBroken ? (
        <img
          src={ossDisplayUrl(row.coverUrl, width) || row.coverUrl}
          alt={row.title}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            if (!fallbackOssDisplayImage(e.currentTarget, row.coverUrl))
              setImageBroken(true);
          }}
        />
      ) : (
        <div className={css.placeholder}>
          <ImageIcon size={28} />
          <span>{row.coverUrl ? "图片暂时无法加载" : "预览待补充"}</span>
        </div>
      )}
      {row.mediaType === "video" &&
        source &&
        !broken &&
        (active || controls) && (
          <video
            ref={video}
            src={source}
            poster={row.coverUrl || undefined}
            controls={controls}
            muted={!controls}
            loop={!controls}
            playsInline
            preload={controls ? "metadata" : "none"}
            onError={() => setBroken(true)}
          />
        )}
      {row.mediaType === "video" && !controls && (
        <span className={css.play}>
          <Play size={12} fill="currentColor" /> VIDEO
        </span>
      )}
      {broken && controls && (
        <span className={css.previewError}>
          视频暂时无法预览，请检查素材地址
        </span>
      )}
    </div>
  );
}
