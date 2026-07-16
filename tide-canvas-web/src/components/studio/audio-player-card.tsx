"use client";

/* ============================================================================
   AudioPlayerCard — 创作台音频结果的定制播放卡。

   原生 <audio controls> 与产品语言脱节，这里用「圆形播放钮 + 波形 + 时间」
   的经典音频形态替代：

   - 波形优先用 Web Audio 解码真实峰值（模块级缓存，一首歌只解一次）；
     OSS 未配 CORS 时解码会失败，退回由 URL 哈希播种的伪波形（确定性,
     同一首歌每次渲染一致），交互不受影响。
   - 已播进度以亮色扫过波形，点击/拖动波形跳播。
   - 同页多张卡互斥播放（开始播放时暂停其它卡）。

   仅消费 studio.css 的既有 token（--text/--bg/--mono 等），不引入新颜色。
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";

const BAR_COUNT = 56;

/** 解码峰值缓存：url → 归一化峰值数组（或 null 表示解码失败,用伪波形）。 */
const peaksCache = new Map<string, number[] | null>();

/** 同页互斥播放：记录当前在播的 <audio>，新卡开播时暂停它。 */
let nowPlaying: HTMLAudioElement | null = null;

/** mulberry32 —— URL 哈希播种的确定性 PRNG（伪波形用）。 */
function seeded(seedStr: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 伪波形：平滑随机 + 两端收敛的包络，形态接近真实音乐。 */
function pseudoPeaks(url: string): number[] {
  const rnd = seeded(url);
  const raw = Array.from({ length: BAR_COUNT }, () => 0.18 + 0.82 * rnd());
  // 三点滑动平均去毛刺，再叠一层慢波起伏
  return raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(BAR_COUNT - 1, i + 1)];
    const smooth = (a + b * 2 + c) / 4;
    const swell = 0.72 + 0.28 * Math.sin((i / BAR_COUNT) * Math.PI * 2.3 + rnd() * 0.4);
    const edge = Math.min(1, Math.min(i + 1, BAR_COUNT - i) / 4); // 两端淡出
    return Math.max(0.12, Math.min(1, smooth * swell * (0.55 + 0.45 * edge)));
  });
}

/** 真实峰值：解码整段音频，按桶取 RMS 再归一化。失败返回 null。
 *  经同源代理 /api/files/download 取字节——OSS 未配 CORS,直连 fetch 会被浏览器
 *  拦下并在控制台刷错;代理由后端出网抓取(下载按钮同款通道),天然免 CORS。 */
async function decodePeaks(url: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`/api/files/download?url=${encodeURIComponent(url)}`);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    type AudioContextCtor = new () => AudioContext;
    const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const audio = await ctx.decodeAudioData(buf);
      const data = audio.getChannelData(0);
      const bucket = Math.floor(data.length / BAR_COUNT);
      if (bucket < 1) return null;
      const peaks: number[] = [];
      let max = 0;
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        const start = i * bucket;
        // 桶内隔点采样(最多 512 点)足够算 RMS，避免长音频全量扫
        const step = Math.max(1, Math.floor(bucket / 512));
        let n = 0;
        for (let j = start; j < start + bucket; j += step) {
          sum += data[j] * data[j];
          n++;
        }
        const rms = Math.sqrt(sum / Math.max(1, n));
        peaks.push(rms);
        if (rms > max) max = rms;
      }
      if (max <= 0) return null;
      return peaks.map((p) => Math.max(0.12, Math.min(1, p / max)));
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "-:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayerCard({ src, autoPlay }: { src: string; autoPlay?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const peaksRef = useRef<number[]>(pseudoPeaks(src));
  // 波形入场：峰值就绪后 ~360ms 从中线长出（ease-out）
  const growRef = useRef({ start: 0 });
  const rafRef = useRef(0);
  const draggingRef = useRef(false);

  /* ── 波形绘制（canvas，读容器 computed color 适配主题） ─────────────── */
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const au = audioRef.current;
    if (!cv || !au) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const color = getComputedStyle(cv).color || "#fff";
    const peaks = peaksRef.current;
    const n = peaks.length;
    const gap = 2.5;
    const bw = Math.max(2, (W - gap * (n - 1)) / n);
    const mid = H / 2;
    const played = au.duration > 0 ? au.currentTime / au.duration : 0;

    // 入场缩放因子（0→1, ease-out cubic）
    let grow = 1;
    if (growRef.current.start) {
      const t = Math.min(1, (performance.now() - growRef.current.start) / 360);
      grow = 1 - Math.pow(1 - t, 3);
      if (t >= 1) growRef.current.start = 0;
    }

    for (let i = 0; i < n; i++) {
      const x = i * (bw + gap);
      const h = Math.max(2.5, peaks[i] * (H - 6) * grow);
      const isPlayed = (i + 0.5) / n <= played;
      ctx.globalAlpha = isPlayed ? 0.95 : 0.28;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, mid - h / 2, bw, h, bw / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);

  // 播放中 / 入场动画期间用 RAF 平滑重绘
  useEffect(() => {
    let alive = true;
    const loop = () => {
      if (!alive) return;
      draw();
      if (playing || growRef.current.start) rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [playing, draw]);

  // 真实峰值异步解码（有缓存；失败保持伪波形）
  useEffect(() => {
    let alive = true;
    const cached = peaksCache.get(src);
    if (cached) {
      peaksRef.current = cached;
      growRef.current.start = performance.now();
      draw();
      return;
    }
    if (cached === null) return; // 已知解码失败,伪波形即最终形态
    growRef.current.start = performance.now();
    void decodePeaks(src).then((peaks) => {
      peaksCache.set(src, peaks);
      if (!alive || !peaks) return;
      peaksRef.current = peaks;
      growRef.current.start = performance.now();
      draw();
      // 触发一次 RAF 循环画完入场
      cancelAnimationFrame(rafRef.current);
      const loop = () => {
        draw();
        if (growRef.current.start) rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    });
    return () => {
      alive = false;
    };
  }, [src, draw]);

  // 容器尺寸变化时重绘（feed 列宽自适应）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    return () => ro.disconnect();
  }, [draw]);

  // 预览浮层场景：打开即播（由点击手势触发,自动播放策略一般放行;被拦则静候）
  useEffect(() => {
    if (!autoPlay) return;
    const au = audioRef.current;
    if (!au) return;
    if (nowPlaying && nowPlaying !== au) nowPlaying.pause();
    nowPlaying = au;
    void au.play().catch(() => {});
  }, [autoPlay]);

  /* ── 播放控制 ─────────────────────────────────────────────────────────── */
  const toggle = () => {
    const au = audioRef.current;
    if (!au) return;
    if (au.paused) {
      if (nowPlaying && nowPlaying !== au) nowPlaying.pause();
      nowPlaying = au;
      void au.play();
    } else {
      au.pause();
    }
  };

  const seekTo = (clientX: number) => {
    const au = audioRef.current;
    const cv = canvasRef.current;
    if (!au || !cv || !(au.duration > 0)) return;
    const r = cv.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    au.currentTime = ratio * au.duration;
    setCur(au.currentTime);
    draw();
  };

  return (
    <div className="ap-card" onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration)}
        onDurationChange={(e) => setDur((e.target as HTMLAudioElement).duration)}
      />
      <button
        type="button"
        className="ap-btn"
        aria-label={playing ? "暂停" : "播放"}
        onClick={toggle}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
            <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            {/* 三角微右移补偿视觉重心 */}
            <path d="M9 5.6v12.8c0 .8.9 1.3 1.6.9l9.4-6.4c.6-.4.6-1.4 0-1.8L10.6 4.7c-.7-.4-1.6.1-1.6.9z" />
          </svg>
        )}
      </button>
      <canvas
        ref={canvasRef}
        className="ap-wave"
        onPointerDown={(e) => {
          draggingRef.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekTo(e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
      />
      <span className="ap-time">
        {fmtTime(playing || cur > 0 ? cur : dur)}
        {(playing || cur > 0) && dur > 0 ? ` / ${fmtTime(dur)}` : ""}
      </span>
    </div>
  );
}
