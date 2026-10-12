"use client";

import { useState } from "react";
import { ArrowUpRight, Box, RefreshCw } from "lucide-react";
import type { AiTaskVO } from "@/types/ai";
import { taskMedia, type AssetKind, type AssetMedia } from "@/lib/media";
import { Alert, CopyButton, EmptyState } from "./ui";
import styles from "./media-preview.module.css";

export function TaskMedia({ task }: { task: AiTaskVO }) {
  return <MediaPreview media={taskMedia(task)} />;
}

export function MediaPreview({ media }: { media: AssetMedia }) {
  if (media.kind === "text" && media.text) return <div className={styles.textResult}><pre>{media.text}</pre><CopyButton value={media.text} label="Copy text" /></div>;
  if (!media.urls.length) return <EmptyState title="No output file available" description="This record does not include a downloadable result. Check Activity for more details." />;
  if (media.kind === "3d" || media.kind === "file") return <div className={styles.fileResult}>{media.poster ? <PreviewFile key={media.poster} source={media.poster} kind="image" /> : <Box size={40} />}<p>{media.kind === "3d" ? "Open this 3D asset in your preferred viewer." : "Open this file in its supported application."}<br />An in-browser preview is not available for this format.</p><a className="button" href={media.urls[0]} target="_blank" rel="noreferrer">Open original <ArrowUpRight size={15} /></a></div>;
  return <div className={styles.results}>{media.urls.map((source) => <PreviewFile key={source} source={source} kind={media.kind} poster={media.poster} />)}</div>;
}

function PreviewFile({ source, kind, poster }: { source: string; kind: AssetKind; poster?: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <div className={styles.result}>
    {!failed && (kind === "video" ? <video key={attempt} src={source} poster={poster || undefined} controls playsInline preload="metadata" onError={() => setFailed(true)} />
      : kind === "audio" ? <audio key={attempt} src={source} controls preload="metadata" onError={() => setFailed(true)} />
      : <img key={attempt} src={source} alt="Creation preview" loading="lazy" onError={() => setFailed(true)} />)}
    {failed && <Alert>This preview could not load. Try again or open the original file.</Alert>}
    <div className={styles.actions}>
      {failed && <button className="button small" onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}><RefreshCw size={14} />Try again</button>}
      <a className="button small" href={source} target="_blank" rel="noreferrer">Open original <ArrowUpRight size={14} /></a>
    </div>
  </div>;
}
