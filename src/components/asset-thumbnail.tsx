"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Box, FileText, Image as ImageIcon, ImageOff, Play, Video } from "lucide-react";
import type { AssetKind, AssetMedia } from "@/lib/media";
import styles from "./asset-thumbnail.module.css";

const labels: Record<AssetKind, string> = { image: "Image", video: "Video", audio: "Audio", "3d": "3D asset", text: "Text", file: "File" };
const icons = { image: ImageIcon, video: Video, audio: AudioLines, "3d": Box, text: FileText, file: FileText };

export function AssetThumbnail({ media }: { media: AssetMedia }) {
  return <Thumbnail key={`${media.kind}:${media.urls[0] || ""}:${media.poster}`} media={media} />;
}

function Thumbnail({ media }: { media: AssetMedia }) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const source = media.urls[0];
  const image = (!posterFailed && media.poster) || (media.kind === "image" ? source : "");
  const isVideo = media.kind === "video" && !!source && !image;
  const hasPreview = !!image || isVideo;
  const Icon = icons[media.kind];

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !hasPreview || status !== "loading") return;
    const timer = setTimeout(() => setStatus("error"), 15000);
    return () => clearTimeout(timer);
  }, [visible, hasPreview, image, isVideo, status]);

  const message = status === "error" ? "Preview unavailable"
    : hasPreview ? visible ? "Loading preview…" : labels[media.kind]
    : !source && !media.text ? "No output file" : labels[media.kind];

  return (
    <span ref={element} className={styles.thumbnail} data-media-kind={media.kind} data-preview-state={status}>
      {media.kind === "text" && media.text ? (
        <span className={styles.textPreview}>{media.text.slice(0, 600)}</span>
      ) : status !== "ready" && (
        <span className={styles.placeholder}>
          {status === "error" ? <ImageOff size={24} aria-hidden="true" /> : <Icon size={28} aria-hidden="true" />}
          <span>{message}</span>
          {status === "error" && source && <small>Open to retry</small>}
          {!hasPreview && source && <small>{media.kind === "audio" ? "Open to listen" : "Open original file"}</small>}
        </span>
      )}
      {visible && image && (
        <img
          className={styles.media}
          data-ready={status === "ready"}
          src={image}
          alt=""
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => {
            if (!posterFailed && media.poster && source && (media.kind === "video" || (media.kind === "image" && media.poster !== source))) {
              setPosterFailed(true);
              setStatus("loading");
            } else setStatus("error");
          }}
        />
      )}
      {visible && isVideo && (
        <video
          className={styles.media}
          data-ready={status === "ready"}
          src={source}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          disablePictureInPicture
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            // Decode a frame just after the opening, without autoplaying or
            // requiring canvas/CORS access to the user's media host.
            if (Number.isFinite(video.duration) && video.duration > 0) {
              video.currentTime = Math.min(1, video.duration / 10);
            }
          }}
          onLoadedData={(event) => { if (!event.currentTarget.seeking) setStatus("ready"); }}
          onSeeked={(event) => { if (event.currentTarget.readyState >= 2) setStatus("ready"); }}
          onError={() => setStatus("error")}
        />
      )}
      {(status === "ready" || (media.kind === "text" && media.text)) && (
        <span className={styles.badge} aria-hidden="true">
          {media.kind === "video" ? <Play size={12} fill="currentColor" /> : <Icon size={12} />}
          {labels[media.kind]}
        </span>
      )}
    </span>
  );
}
