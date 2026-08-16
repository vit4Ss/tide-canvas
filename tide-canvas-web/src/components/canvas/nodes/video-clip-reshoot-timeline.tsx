"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  CLIP_RESHOOT_DEFAULT_SECONDS,
  CLIP_RESHOOT_MAX_RANGES,
  addClipReshootRange,
  normalizeClipReshootRanges,
  resizeClipReshootRange,
} from "./video-clip-reshoot";

interface TimelineRange {
  start: number;
  end: number;
}

interface Props {
  src: string;
  duration: number;
  ranges: TimelineRange[];
  currentTime?: number;
  onChange: (ranges: TimelineRange[]) => void;
  onSeek?: (time: number) => void;
  onThumbnailReady?: (thumbnail: string) => void;
}

function captureTimelineFrames(src: string, duration: number, count: number, signal?: AbortSignal): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    let index = 0;
    let settled = false;
    let timer = 0;
    const frames: string[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.removeAttribute("src");
      video.load();
      resolve(frames);
    };
    timer = window.setTimeout(finish, 10000);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) return finish();
    const capture = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 68;
        const context = canvas.getContext("2d");
        if (!context || !video.videoWidth || !video.videoHeight) return finish();
        const sourceAspect = video.videoWidth / video.videoHeight;
        const targetAspect = canvas.width / canvas.height;
        let sx = 0;
        let sy = 0;
        let sw = video.videoWidth;
        let sh = video.videoHeight;
        if (sourceAspect > targetAspect) {
          sw = video.videoHeight * targetAspect;
          sx = (video.videoWidth - sw) / 2;
        } else {
          sh = video.videoWidth / targetAspect;
          sy = (video.videoHeight - sh) / 2;
        }
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        return finish();
      }
      index += 1;
      if (index >= count) {
        finish();
        return;
      }
      video.currentTime = Math.min(Math.max(0, duration - 0.02), ((index + 0.5) / count) * duration);
    };
    video.onerror = finish;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(Math.max(0, duration - 0.02), (0.5 / count) * duration);
    };
    video.onseeked = capture;
    video.src = src;
  });
}

function TimelineVideoFrame({ src, time }: { src: string; time: number }) {
  return (
    <video
      src={src}
      muted
      playsInline
      preload="metadata"
      aria-hidden
      className="pointer-events-none h-full w-full object-cover"
      onLoadedMetadata={(event) => {
        const mediaDuration = event.currentTarget.duration || time;
        event.currentTarget.currentTime = Math.min(time, Math.max(0, mediaDuration - 0.02));
      }}
    />
  );
}

export function VideoClipReshootTimeline({ src, duration, ranges, currentTime = 0, onChange, onSeek, onThumbnailReady }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [frameResult, setFrameResult] = useState<{ key: string; frames: string[] }>({ key: "", frames: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const [drag, setDrag] = useState<{ index: number; edge: "start" | "end" } | null>(null);
  const safeDuration = Math.max(0.1, duration || CLIP_RESHOOT_DEFAULT_SECONDS);
  const normalizedRanges = useMemo(
    () => normalizeClipReshootRanges(ranges, safeDuration),
    [ranges, safeDuration],
  );
  const frameCount = Math.max(8, Math.min(14, Math.ceil(safeDuration * 2)));
  const frameKey = `${src}|${safeDuration}|${frameCount}`;
  const frames = frameResult.key === frameKey ? frameResult.frames : [];
  const frameCaptureFailed = frameResult.key === frameKey && frameResult.frames.length === 0;
  const safeActiveIndex = Math.min(activeIndex, normalizedRanges.length - 1);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void captureTimelineFrames(src, safeDuration, frameCount, controller.signal).then((next) => {
      if (cancelled) return;
      setFrameResult({ key: `${src}|${safeDuration}|${frameCount}`, frames: next });
      if (next[0]) onThumbnailReady?.(next[0]);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [frameCount, onThumbnailReady, safeDuration, src]);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return Math.max(0, Math.min(safeDuration, ((clientX - rect.left) / rect.width) * safeDuration));
  };

  const updateEdge = (clientX: number) => {
    if (!drag) return;
    const time = timeAt(clientX);
    const next = resizeClipReshootRange(normalizedRanges, safeDuration, drag.index, drag.edge, time);
    const target = next[drag.index];
    if (!target) return;
    onChange(next);
    onSeek?.(drag.edge === "start" ? target.start : target.end);
  };

  const addOrActivateRange = (clientX: number) => {
    const time = timeAt(clientX);
    const result = addClipReshootRange(normalizedRanges, safeDuration, time);
    if (result.changed) onChange(result.ranges);
    if (result.activeIndex >= 0) setActiveIndex(result.activeIndex);
    onSeek?.(time);
  };

  const removeRange = (index: number) => {
    if (normalizedRanges.length <= 1) return;
    onChange(normalizedRanges.filter((_, candidate) => candidate !== index));
    setActiveIndex(Math.max(0, index - 1));
  };

  const nudgeEdge = (index: number, edge: "start" | "end", delta: number) => {
    const range = normalizedRanges[index];
    if (!range) return;
    const next = resizeClipReshootRange(
      normalizedRanges,
      safeDuration,
      index,
      edge,
      (edge === "start" ? range.start : range.end) + delta,
    );
    onChange(next);
    onSeek?.(edge === "start" ? next[index]?.start ?? range.start : next[index]?.end ?? range.end);
  };

  return (
    <div
      className="mt-3 flex h-[74px] items-center gap-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 p-2 text-white shadow-sm"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        ref={trackRef}
        role="group"
        aria-label="片段重拍时间范围"
        title="点击空白处添加片段，拖动蓝色边缘调整起止时间"
        className="relative h-full min-w-0 flex-1 touch-none select-none cursor-crosshair overflow-hidden rounded-lg bg-neutral-900"
        onPointerDown={(event) => {
          event.stopPropagation();
          addOrActivateRange(event.clientX);
        }}
        onPointerMove={(event) => updateEdge(event.clientX)}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${frameCount}, minmax(0, 1fr))` }}>
          {Array.from({ length: frameCount }, (_, index) => (
            <div key={index} className="overflow-hidden border-r border-black/30 last:border-r-0">
              {frames[index] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frames[index]} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : frameCaptureFailed ? (
                <TimelineVideoFrame src={src} time={((index + 0.5) / frameCount) * safeDuration} />
              ) : (
                <div className="h-full w-full animate-pulse bg-neutral-800" />
              )}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-black/55" />

        {normalizedRanges.map((range, index) => {
          const left = (range.start / safeDuration) * 100;
          const width = ((range.end - range.start) / safeDuration) * 100;
          const active = index === safeActiveIndex;
          return (
            <div
              key={index}
              className={`absolute inset-y-0 overflow-hidden rounded-md border-2 ${active ? "z-20 border-blue-500" : "z-10 border-blue-400/70"}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setActiveIndex(index);
                onSeek?.(timeAt(event.clientX));
              }}
            >
              <div
                className="absolute inset-y-0"
                style={{
                  left: `${-(range.start / Math.max(0.001, range.end - range.start)) * 100}%`,
                  width: `${(safeDuration / Math.max(0.001, range.end - range.start)) * 100}%`,
                }}
              >
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${frameCount}, minmax(0, 1fr))` }}>
                  {Array.from({ length: frameCount }, (_, frameIndex) => (
                    <div key={frameIndex} className="overflow-hidden border-r border-black/25 last:border-r-0">
                      {frames[frameIndex] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={frames[frameIndex]} alt="" className="h-full w-full object-cover" draggable={false} />
                      ) : frameCaptureFailed ? (
                        <TimelineVideoFrame src={src} time={((frameIndex + 0.5) / frameCount) * safeDuration} />
                      ) : (
                        <div className="h-full w-full bg-neutral-800" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                {(range.end - range.start).toFixed(1)}s
              </span>
              {normalizedRanges.length > 1 && active && (
                <button
                  type="button"
                  aria-label="移除这个片段"
                  title="移除片段"
                  className="absolute right-1 top-1 z-30 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white/80 hover:text-white"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    removeRange(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {(["start", "end"] as const).map((edge) => (
                <button
                  key={edge}
                  type="button"
                  aria-label={edge === "start" ? "调整片段开始时间" : "调整片段结束时间"}
                  className={`absolute inset-y-0 z-30 w-2 cursor-ew-resize bg-blue-500 outline-none focus-visible:ring-2 focus-visible:ring-white ${edge === "start" ? "left-0" : "right-0"}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setActiveIndex(index);
                    setDrag({ index, edge });
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    setDrag(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveIndex(index);
                    const step = event.shiftKey ? 0.5 : 0.1;
                    nudgeEdge(index, edge, event.key === "ArrowLeft" ? -step : step);
                  }}
                />
              ))}
            </div>
          );
        })}

        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.25)]"
          style={{ left: `${(Math.max(0, Math.min(safeDuration, currentTime)) / safeDuration) * 100}%` }}
        />
      </div>
      <div className="w-16 shrink-0 text-center text-xs tabular-nums text-neutral-400">
        <span className="text-neutral-100">{normalizedRanges.length}</span>/{CLIP_RESHOOT_MAX_RANGES} 个片段
      </div>
    </div>
  );
}
