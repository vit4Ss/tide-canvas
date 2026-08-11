"use client";

import {
  Check,
  Download,
  Eye,
  Loader2,
  Music2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { ossDisplayUrl } from "@/lib/oss-display";
import type { MediaAssetVO } from "@/types/media-asset";
import styles from "./canvas-history.module.css";

interface HistoryAssetCardProps {
  asset: MediaAssetVO;
  batchMode: boolean;
  selected: boolean;
  touchActive: boolean;
  deleting: boolean;
  onTouchActivate: (id: string) => void;
  onSelect: (id: string) => void;
  onPreview: (asset: MediaAssetVO) => void;
  onUse: (asset: MediaAssetVO) => void;
  onDownload: (asset: MediaAssetVO) => void;
  onDelete: (asset: MediaAssetVO) => void;
}

function isTouchFirstInteraction(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

export function HistoryAssetCard({
  asset,
  batchMode,
  selected,
  touchActive,
  deleting,
  onTouchActivate,
  onSelect,
  onPreview,
  onUse,
  onDownload,
  onDelete,
}: HistoryAssetCardProps) {
  const ready = asset.status === 1 && Boolean(asset.url);
  const sourceLabel = asset.sourceType === "generation" ? "AI 生成" : "上传";
  const cover = ossDisplayUrl(asset.thumbnailUrl || asset.url, 480) ?? asset.thumbnailUrl ?? asset.url;

  const activateCard = () => {
    if (!ready) return;
    if (batchMode) {
      onSelect(asset.id);
      return;
    }
    if (isTouchFirstInteraction() && !touchActive) {
      onTouchActivate(asset.id);
      return;
    }
    onPreview(asset);
  };

  return (
    <article
      className={`${styles.card}${selected ? ` ${styles.cardSelected}` : ""}${touchActive ? ` ${styles.cardTouchActive}` : ""}`}
      aria-label={asset.name || sourceLabel}
      onClick={activateCard}
    >
      <div className={styles.cardMedia}>
        {ready ? (
          asset.mediaType === "image" ? (
            // Remote media hosts are configured dynamically; a native image
            // keeps legacy/local/OSS history equally previewable.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={asset.name || "历史图片"} loading="lazy" decoding="async" />
          ) : asset.mediaType === "video" ? (
            <>
              <video
                src={asset.thumbnailUrl ? undefined : asset.url}
                poster={asset.thumbnailUrl || undefined}
                muted
                playsInline
                preload="metadata"
                aria-label={asset.name || "历史视频"}
              />
              <span className={styles.mediaKindIcon} aria-hidden="true"><Play /></span>
            </>
          ) : (
            <div className={styles.audioCover}>
              <Music2 aria-hidden="true" />
              <span>{asset.name || "音频"}</span>
            </div>
          )
        ) : (
          <div className={styles.processing} role="status">
            <Loader2 className={styles.processingSpinner} aria-hidden="true" />
            <span>生成中 {Math.max(1, asset.progress || 1)}%</span>
            <span className={styles.processingTrack} aria-hidden="true">
              <i style={{ width: `${Math.max(4, asset.progress || 4)}%` }} />
            </span>
          </div>
        )}

        <span className={styles.sourceBadge}>{sourceLabel}</span>

        {batchMode && ready && (
          <button
            type="button"
            className={`${styles.selectControl}${selected ? ` ${styles.selectControlOn}` : ""}`}
            aria-label={selected ? "取消选择" : "选择资源"}
            aria-pressed={selected}
            onClick={(event) => { event.stopPropagation(); onSelect(asset.id); }}
          >
            {selected && <Check aria-hidden="true" />}
          </button>
        )}

        {!batchMode && ready && (
          <div className={styles.cardActions}>
            <button
              type="button"
              aria-label={`查看 ${asset.name || "资源"}`}
              onClick={(event) => { event.stopPropagation(); onPreview(asset); }}
            >
              <Eye aria-hidden="true" />
              <span>查看</span>
            </button>
            <button
              type="button"
              aria-label={`使用 ${asset.name || "资源"}`}
              onClick={(event) => { event.stopPropagation(); onUse(asset); }}
            >
              <Plus aria-hidden="true" />
              <span>使用</span>
            </button>
            <button
              type="button"
              aria-label={`下载 ${asset.name || "资源"}`}
              onClick={(event) => { event.stopPropagation(); onDownload(asset); }}
            >
              <Download aria-hidden="true" />
              <span>下载</span>
            </button>
          </div>
        )}

        {!batchMode && ready && (
          <button
            type="button"
            className={styles.deleteControl}
            aria-label={`删除 ${asset.name || "资源"}`}
            disabled={deleting}
            onClick={(event) => { event.stopPropagation(); onDelete(asset); }}
          >
            {deleting ? <Loader2 className={styles.processingSpinner} /> : <Trash2 />}
          </button>
        )}
      </div>
    </article>
  );
}
