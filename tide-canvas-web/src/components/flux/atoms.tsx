// Shared UI atoms — ported from design-ref/app/ui.jsx + design-ref/app/brand.jsx,
// adapted to the liuguang theme (CSS vars from src/styles/liuguang/flux.css).
//
// Avatar / Cover / Logo / Wordmark. All pure presentational React — SSR-safe,
// no hooks, no browser APIs, no Next-specific imports. Framework-agnostic.

import type { CSSProperties } from 'react';
import { mesh } from '@/lib/mesh';

/* ── Avatar — initials on a deterministic gradient derived from the name ──── */

export interface AvatarProps {
  name?: string;
  /** px diameter. Default 28. */
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function Avatar({ name = '?', size = 28, style, className }: AvatarProps) {
  const initials =
    name
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  let hsh = 0;
  for (let i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) % 360;
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        color: '#fff',
        background: `linear-gradient(135deg, hsl(${hsh} 70% 55%), hsl(${(hsh + 60) % 360} 70% 48%))`,
        ...style,
      }}
    >
      {initials}
    </div>
  );
}

/* ── Cover — generative placeholder tile (mesh fallback + brand watermark) ─── */

export interface CoverProps {
  /**
   * Either a ready CSS gradient string (e.g. from `mesh(...)`) or an object with
   * a `.c` gradient (mirrors the design's artwork records). When omitted, a
   * deterministic mesh fallback is generated.
   */
  art?: string | { c: string };
  /** apply rounded corners (var(--r)). Default false (parent usually clips). */
  rounded?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function Cover({ art, rounded = false, style, className }: CoverProps) {
  const bg = typeof art === 'string' ? art : art?.c || mesh(258, 210, 320);
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        backgroundBlendMode: 'screen',
        borderRadius: rounded ? 'var(--r)' : undefined,
        overflow: rounded ? 'hidden' : undefined,
        ...style,
      }}
    >
      {/* faint brand watermark — signals this is a generative placeholder */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          opacity: 0.14,
        }}
      >
        <Logo size={46} tone="solid" />
      </div>
      {/* subtle grain/vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 120% at 50% 0%, transparent 60%, rgba(0,0,0,0.28) 100%)',
        }}
      />
    </div>
  );
}

/* ── Logo — FlowingLight (流光) mark: a gradient tile swept by a flowing light
   ribbon with a glint head, duo/solid tone ────────────────────────────────── */

export interface LogoProps {
  /** px size. Default 28. */
  size?: number;
  /** 'duo' = accent tile + light ribbon; 'solid' = currentColor tile. */
  tone?: 'duo' | 'solid';
  style?: CSSProperties;
  className?: string;
}

export function Logo({ size = 28, tone = 'duo', style, className }: LogoProps) {
  const solid = tone === 'solid';
  // Self-contained gradient (theme vars with hard fallbacks) so the mark renders
  // on any theme/background — including the admin light theme — without relying on
  // external CSS. A fixed gradient id is fine across instances (identical defs).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={{ display: 'block', flex: 'none', ...style }}
      aria-hidden
    >
      {!solid && (
        <defs>
          <linearGradient id="fl-mark-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent, #6d8bf5)" />
            <stop offset="100%" stopColor="var(--accent-2, #9b7bf0)" />
          </linearGradient>
        </defs>
      )}
      {/* rounded brand tile */}
      <rect x={2} y={2} width={28} height={28} rx={8.5} fill={solid ? 'currentColor' : 'url(#fl-mark-grad)'} />
      {/* flowing-light ribbon — an S-curve light sweep across the tile (流光) */}
      <path
        d="M6 22 C 11.5 22, 11.5 11, 17 11 C 21 11, 22 16, 26.4 11.4"
        stroke="#fff"
        strokeWidth={2.6}
        strokeLinecap="round"
        fill="none"
        opacity={0.97}
      />
      {/* glint head of the light streak */}
      <circle cx={26.4} cy={11.4} r={2} fill="#fff" />
    </svg>
  );
}

/* ── Wordmark — "FLOWING" + accented "LIGHT", optional 流光 tagline ──────────── */

export interface WordmarkProps {
  /** base font px. Default 18. */
  size?: number;
  /** 'cn' adds the 稻草人智绘 tagline; 'en' omits it. Default 'cn'. */
  lang?: 'cn' | 'en';
  /** show the Logo mark. Default true. */
  mark?: boolean;
  /** override mark px size (defaults to size * 1.5). */
  markSize?: number;
  style?: CSSProperties;
  className?: string;
}

export function Wordmark({
  size = 18,
  lang = 'cn',
  mark = true,
  markSize,
  style,
  className,
}: WordmarkProps) {
  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: size * 0.5, ...style }}
    >
      {mark && <Logo size={markSize || size * 1.5} />}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <div
          className="disp"
          style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.01em' }}
        >
          FLOWING
          <span style={{ color: 'var(--accent)' }}>LIGHT</span>
        </div>
        {lang === 'cn' && (
          <div
            style={{
              fontSize: size * 0.42,
              letterSpacing: '0.34em',
              color: 'var(--text-faint)',
              marginTop: size * 0.18,
              fontWeight: 500,
              paddingLeft: 1,
            }}
          >
            流 光
          </div>
        )}
      </div>
    </div>
  );
}
