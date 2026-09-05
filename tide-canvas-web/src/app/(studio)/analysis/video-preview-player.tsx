"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Loader2, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import styles from "./video-preview-player.module.css";

type VideoMetadata = { width: number; height: number; durationSeconds: number };
type InlineVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

function timeLabel(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VideoPreviewPlayer({ src, poster, label, local, onMetadata, onError }: {
  src: string;
  poster?: string;
  label: string;
  local: boolean;
  onMetadata: (metadata: VideoMetadata) => void;
  onError: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const media = useRef<InlineVideo>(null);
  const lastVolume = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const video = media.current;
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    const begin = () => setFullscreen(true);
    const end = () => setFullscreen(false);
    setCanFullscreen(!!(root.current?.requestFullscreen && document.fullscreenEnabled) || !!video?.webkitEnterFullscreen);
    document.addEventListener("fullscreenchange", syncFullscreen);
    video?.addEventListener("webkitbeginfullscreen", begin);
    video?.addEventListener("webkitendfullscreen", end);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      video?.removeEventListener("webkitbeginfullscreen", begin);
      video?.removeEventListener("webkitendfullscreen", end);
    };
  }, []);

  const togglePlay = () => {
    const video = media.current;
    if (!video) return;
    setNotice("");
    if (!video.paused) video.pause();
    else void video.play().catch((error: unknown) => {
      // Pausing or replacing the source can interrupt a pending play promise.
      if (error instanceof Error && error.name === "AbortError") return;
      if (media.current === video) setNotice("暂时无法开始播放，请再点击播放重试");
    });
  };

  const seek = (seconds: number) => {
    const video = media.current;
    if (!video || !duration) return;
    const next = Math.min(duration, Math.max(0, seconds));
    try { video.currentTime = next; setCurrent(next); }
    catch { setNotice("视频仍在加载，请稍后拖动进度"); }
  };

  const toggleMute = () => {
    const video = media.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = lastVolume.current;
    } else video.muted = true;
  };

  const toggleFullscreen = async () => {
    setNotice("");
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (root.current?.requestFullscreen && document.fullscreenEnabled) await root.current.requestFullscreen();
      else media.current?.webkitEnterFullscreen?.();
    } catch { setNotice("暂时无法进入全屏，请重试"); }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Range inputs and buttons retain their native keyboard interactions.
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key.toLowerCase()) {
      case " ": case "k": event.preventDefault(); togglePlay(); break;
      case "arrowleft": event.preventDefault(); seek(current - 5); break;
      case "arrowright": event.preventDefault(); seek(current + 5); break;
      case "m": event.preventDefault(); toggleMute(); break;
      case "f": event.preventDefault(); void toggleFullscreen(); break;
    }
  };

  const progress = duration > 0 ? Math.min(100, current / duration * 100) : 0;
  const silent = muted || volume === 0;
  return (
    <div ref={root} className={styles.player} role="region" aria-label={label} tabIndex={0} onKeyDown={onKeyDown}>
      <video ref={media} src={src} poster={poster} playsInline preload={local ? "auto" : "metadata"}
        aria-label={label} tabIndex={-1} onClick={togglePlay}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const seconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
          setDuration(seconds);
          if (local) onMetadata({ width: video.videoWidth, height: video.videoHeight, durationSeconds: Math.round(seconds) });
        }}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onProgress={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0 && video.buffered.length) {
            setBuffered(Math.min(100, video.buffered.end(video.buffered.length - 1) / video.duration * 100));
          }
        }}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          setVolume(video.volume); setMuted(video.muted);
          if (video.volume > 0) lastVolume.current = video.volume;
        }}
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); setWaiting(false); }}
        onEnded={() => { setPlaying(false); setWaiting(false); }}
        onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)}
        onError={onError}
      />
      {!playing && <button type="button" className={styles.centerPlay} onClick={togglePlay} aria-label={current >= duration && duration > 0 ? "重新播放视频" : "播放视频"}>
        <Play aria-hidden fill="currentColor" />
      </button>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.controls}>
        <div className={styles.timeline} style={{ "--played": `${progress}%`, "--buffered": `${buffered}%` } as CSSProperties}>
          <span className={styles.track} aria-hidden />
          <input type="range" aria-label="视频播放进度" aria-valuetext={`${timeLabel(current)} / ${timeLabel(duration)}`}
            min={0} max={duration || 1} step={0.1} value={Math.min(current, duration || 1)} disabled={!duration}
            onChange={(event) => seek(Number(event.target.value))} />
        </div>
        <div className={styles.controlRow}>
          <button type="button" className={styles.iconButton} onClick={togglePlay} aria-label={playing ? "暂停视频" : "播放视频"} title={playing ? "暂停（空格）" : "播放（空格）"}>
            {waiting && playing ? <Loader2 className={styles.spinner} aria-hidden /> : playing ? <Pause aria-hidden fill="currentColor" /> : <Play aria-hidden fill="currentColor" />}
          </button>
          <span className={styles.time}><b>{timeLabel(current)}</b><span>/</span>{timeLabel(duration)}</span>
          <div className={styles.volume}>
            <button type="button" className={styles.iconButton} onClick={toggleMute} aria-label={silent ? "开启声音" : "静音"} title={silent ? "开启声音（M）" : "静音（M）"}>
              {silent ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
            </button>
            <input type="range" min={0} max={1} step={0.05} value={silent ? 0 : volume} aria-label="视频音量" aria-valuetext={`${Math.round((silent ? 0 : volume) * 100)}%`}
              onChange={(event) => { if (media.current) { media.current.volume = Number(event.target.value); media.current.muted = Number(event.target.value) === 0; } }} />
          </div>
          <button type="button" className={styles.iconButton} onClick={() => void toggleFullscreen()} disabled={!canFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏播放"} title={fullscreen ? "退出全屏" : "全屏（F）"}>
            {fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
