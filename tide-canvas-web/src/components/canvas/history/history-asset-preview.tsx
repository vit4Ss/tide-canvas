"use client";

import { Download, Plus, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { MediaAssetVO } from "@/types/media-asset";
import styles from "./canvas-history.module.css";

interface HistoryAssetPreviewProps {
  asset: MediaAssetVO;
  busy: boolean;
  onClose: () => void;
  onDownload: (asset: MediaAssetVO) => void;
  onUse: (asset: MediaAssetVO) => void;
}

export function HistoryAssetPreview({
  asset,
  busy,
  onClose,
  onDownload,
  onUse,
}: HistoryAssetPreviewProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div className={styles.previewBackdrop} onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.previewDialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${asset.name || "资源"}预览`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.previewHeader}>
          <div>
            <strong>{asset.name || "未命名资源"}</strong>
            <span>{asset.sourceType === "generation" ? "AI 生成" : "上传"}</span>
          </div>
          <div className={styles.previewActions}>
            <button type="button" onClick={() => onDownload(asset)}>
              <Download aria-hidden="true" />下载
            </button>
            <button type="button" className={styles.previewUse} disabled={busy} onClick={() => onUse(asset)}>
              <Plus aria-hidden="true" />使用
            </button>
            <button type="button" className={styles.iconButton} aria-label="关闭预览" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className={styles.previewStage}>
          {asset.mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.url} alt={asset.name || "历史图片"} />
          ) : asset.mediaType === "video" ? (
            <video src={asset.url} controls autoPlay playsInline />
          ) : (
            <div className={styles.previewAudio}>
              <strong>{asset.name || "音频"}</strong>
              <audio src={asset.url} controls autoPlay />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
