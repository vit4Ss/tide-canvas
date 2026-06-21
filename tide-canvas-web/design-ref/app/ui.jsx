/* global React, Logo */
// SCARECROWAI — shared UI atoms (icons, media tile, avatar, switches)
const { createElement: e, useState: uState } = React;

// ── icon set — minimal stroke SVGs ──────────────────────────────────────
const PATHS = {
  search: 'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M21 21l-4.3-4.3',
  heart: 'M19.5 12.6 12 20l-7.5-7.4a5 5 0 1 1 7.1-7.1l.4.4.4-.4a5 5 0 1 1 7.1 7.1z',
  play: 'M7 5v14l12-7z',
  sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17l-1.9-5.1L4.5 10l5.6-1.4L12 3z',
  sun: 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M18.4 5.6l1.4-1.4 M4.2 19.8l1.4-1.4 M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18 M3 12h18 M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z',
  palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.4 1-2 2-2h1.5a3.5 3.5 0 0 0 3.5-3.5C21 7 17 3 12 3z M7.5 11.5h.01 M10 8h.01 M14 8h.01 M16.5 11h.01',
  download: 'M12 3v12 M7 11l5 5 5-5 M5 21h14',
  copy: 'M9 9h10v10H9z M5 15V5h10',
  close: 'M6 6l12 12 M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6',
  video: 'M3 6h13v12H3z M16 10l5-3v10l-5-3',
  check: 'M5 12l5 5L20 7',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8 M4 21a8 8 0 0 1 16 0',
  bolt: 'M13 3 4 14h7l-1 7 9-11h-7l1-7z',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  fire: 'M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.5.6-2.6 1.5-3.5C8.5 10 9 11 9.5 11 10 9 11 6.5 12 3z',
  filter: 'M4 5h16 M7 12h10 M10 19h4',
  layers: 'M12 3 3 8l9 5 9-5-9-5z M3 14l9 5 9-5',
  crown: 'M3 8l3.5 3L12 5l5.5 6L21 8l-1.5 11h-15L3 8z M5.5 19h13',
  gift: 'M4 11h16v9H4z M2 7h20v4H2z M12 7v13 M12 7S9.5 3 7.5 4.2 8 7 12 7z M12 7s2.5-4 4.5-2.8S16 7 12 7z',
};
function Icon({ name, size = 18, stroke = 1.7, fill = false, style }) {
  const filled = fill || name === 'play' || name === 'bolt';
  return e('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none',
    stroke: filled ? 'none' : 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', style },
    e('path', { d: PATHS[name] || '' }));
}

// ── avatar from a name (initials on a gradient) ─────────────────────────
function Avatar({ name = '?', size = 28 }) {
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  let hsh = 0; for (let i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) % 360;
  return e('div', {
    style: { width: size, height: size, borderRadius: '50%', flex: 'none', display: 'grid', placeItems: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: '#fff',
      background: `linear-gradient(135deg, hsl(${hsh} 70% 55%), hsl(${(hsh + 60) % 360} 70% 48%))` },
  }, initials);
}

// ── generative cover (placeholder for real artwork) ─────────────────────
function Cover({ art, rounded, eager }) {
  return e('div', {
    style: { position: 'absolute', inset: 0, background: art.c, backgroundBlendMode: 'screen' },
  },
    // faint brand watermark — signals this is a generative placeholder
    e('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', opacity: 0.14 } },
      e(Logo, { size: 46, tone: 'solid' })),
    // subtle grain/vignette
    e('div', { style: { position: 'absolute', inset: 0, background: 'radial-gradient(120% 120% at 50% 0%, transparent 60%, rgba(0,0,0,0.28) 100%)' } }),
  );
}

// ── segmented switch (icon options) ─────────────────────────────────────
function Seg({ options, value, onChange, title }) {
  return e('div', { title, style: { display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--radius-sm)',
    background: 'var(--panel)', border: '1px solid var(--border)' } },
    options.map((o) => e('button', {
      key: o.value, onClick: () => onChange(o.value), title: o.label,
      style: { display: 'grid', placeItems: 'center', minWidth: 30, height: 28, padding: '0 8px', borderRadius: 'calc(var(--radius-sm) - 3px)',
        fontSize: 12, fontWeight: 600, gap: 5,
        color: value === o.value ? 'var(--on-accent)' : 'var(--text-dim)',
        background: value === o.value ? 'var(--accent)' : 'transparent',
        transition: 'all .16s var(--ease)' },
    }, o.icon ? e(Icon, { name: o.icon, size: 15 }) : null, o.text ? e('span', null, o.text) : null)));
}

window.Icon = Icon;
window.Avatar = Avatar;
window.Cover = Cover;
window.Seg = Seg;
