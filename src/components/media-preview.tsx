"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Box, RefreshCw, Download, ZoomIn, ZoomOut } from "lucide-react";
import type { AiTaskVO } from "@/types/ai";
import { taskMedia, type AssetKind, type AssetMedia } from "@/lib/media";
import { Alert, CopyButton, EmptyState } from "./ui";
import styles from "./media-preview.module.css";
import { ModelPreview } from "./model-preview";
import { downloadOriginal } from "@/lib/downloads";

export function TaskMedia({ task }: { task: AiTaskVO }) {
  return <MediaPreview media={taskMedia(task)} name={task.displayName || task.modelName || "Creation"} />;
}

export function MediaPreview({ media, name = "Creation" }: { media: AssetMedia; name?: string }) {
  if (media.kind === "text" && media.text) return <div className={styles.textResult}><pre>{media.text}</pre><CopyButton value={media.text} label="Copy text" /></div>;
  if (!media.urls.length) return <EmptyState title="No output file available" description="This record does not include a downloadable result. Check Activity for more details." />;
  if (media.kind === "3d") {
    const source = media.urls.find(url => /\.(glb|gltf)(?:[?#]|$)/i.test(url));
    if (source) return <><ModelPreview key={source} source={source} poster={media.poster} /><PreviewActions key={source} source={source} name={name} /></>;
  }
  if (media.kind === "3d" || media.kind === "file") return <div className={styles.fileResult}>{media.poster ? <img src={media.poster} alt={`${name} cover`} /> : <Box size={40} />}<p>{media.kind === "3d" ? "Open this 3D asset in your preferred viewer." : "Open this file in its supported application."}<br />An in-browser preview is not available for this format.</p><PreviewActions key={media.urls[0]} source={media.urls[0]} name={name} /></div>;
  return <div className={styles.results}>{media.urls.map((source, index) => <PreviewFile key={source} source={source} kind={media.kind} poster={media.poster} name={media.urls.length > 1 ? `${name}-${index + 1}` : name} />)}</div>;
}

function PreviewFile({ source, kind, poster, name }: { source: string; kind: AssetKind; poster?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const pan = useRef<HTMLDivElement>(null);
  const fit = () => { setZoom(1); pan.current?.scrollTo({ top: 0, left: 0 }); };
  return <div className={styles.result}>
    {!failed && (kind === "video" ? <video key={attempt} src={source} poster={poster || undefined} controls playsInline preload="metadata" onError={() => setFailed(true)} />
      : kind === "audio" ? <audio key={attempt} src={source} controls preload="metadata" onError={() => setFailed(true)} />
      : <><div className={styles.zoomControls} role="group" aria-label="Image zoom"><button className="button small" disabled={zoom === 1} onClick={() => setZoom(value => Math.max(1, value - .5))} aria-label="Zoom out"><ZoomOut size={16} /></button><span aria-live="polite">{Math.round(zoom * 100)}% of fit</span><button className="button small" disabled={zoom === 4} onClick={() => setZoom(value => Math.min(4, value + .5))} aria-label="Zoom in"><ZoomIn size={16} /></button><button className="button small" disabled={zoom === 1} onClick={fit}>Fit image</button></div><div ref={pan} className={styles.imagePan} data-pan tabIndex={0} role="region" aria-label="Image preview. Use zoom controls, then scroll or swipe to pan." onDoubleClick={() => zoom === 1 ? setZoom(2) : fit()} onKeyDown={event => { if (["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); if (event.key === "0") fit(); else setZoom(value => Math.max(1, Math.min(4, value + (event.key === "-" ? -.5 : .5)))); } }}><img key={attempt} src={source} alt={name} loading="lazy" style={{ width: `${zoom * 100}%`, maxWidth: "none", maxHeight: zoom === 1 ? "60dvh" : "none" }} onError={() => setFailed(true)} /></div></>)}
    {failed && <Alert>This preview could not load. Try again or open the original file.</Alert>}
    {failed && <button className="button small" onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}><RefreshCw size={14} />Try again</button>}
    <PreviewActions source={source} name={name} />
  </div>;
}

function PreviewActions({ source, name }: { source: string; name: string }) {
  const pending = useRef<AbortController | null>(null), alive = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const download = async () => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    setBusy(true); setError(""); setNotice("");
    try { await downloadOriginal({ url: source, name }, controller.signal); if (alive.current) setNotice("Download prepared. Check your browser’s downloads."); }
    catch (cause) { if (alive.current) setError(controller.signal.aborted ? "Download preparation timed out. Retry or open the original file." : cause instanceof Error ? cause.message : "The download could not be prepared."); }
    finally { clearTimeout(timer); pending.current = null; if (alive.current) setBusy(false); }
  };
  return <>{error && <Alert>{error}</Alert>}{notice && <p className="small muted" role="status">{notice}</p>}<div className={styles.actions}><button className="button small" disabled={busy} onClick={() => void download()}><Download size={14} />{busy ? "Preparing download…" : "Download"}</button><a className="button small" href={source} target="_blank" rel="noreferrer">Open original <ArrowUpRight size={14} /></a></div></>;
}
