/* global React, Icon, mesh, fmt */
// SCARECROWAI — home showcases: canvas studio + per-model art walls
const { createElement: w, useState: wS, useEffect: wE, useRef: wR } = React;

const SH = {
  canvasT: { cn: '创作间', en: 'Canvas Studio' },
  canvasS: {
    cn: '在无限画布上自由创作：拖拽、组合、迭代，让每个想法都在同一个共享空间中自然流动。',
    en: 'Create freely on an infinite canvas — drag, combine, iterate, and let every idea flow in one shared space.',
  },
  tryit: { cn: '试一试', en: 'Try it' },
  viewAll: { cn: '查看全部', en: 'View all' },
  more: { cn: '更多模型正在持续更新和发布', en: 'More models are continuously updated and released' },
};
function L(o, lang) { return o[lang] || o.cn; }

/* ── deterministic per-tile artwork metadata ──────────────────────────── */
const TILE_TITLES = {
  cn: ['霓虹废土行者', '黄昏侧颜', '赛博艺伎', '雨夜便利店', '苔原小屋', '轨道城市', '冰晶女王', '机甲少女', '森灵', '青绿山水', '果冻机器人', '沙丘正午', '复古唱片封面', '微缩星球', '深海水母', '熵岩流动'],
  en: ['Neon Wastes', 'Dusk Profile', 'Cyber Geisha', 'Rainy Konbini', 'Tundra Cabin', 'Orbital City', 'Frost Queen', 'Mecha Pilot', 'Forest Spirit', 'Verdant Mountains', 'Jelly Bot', 'Dune Noon', 'Retro Sleeve', 'Pocket Planet', 'Abyssal Jelly', 'Lava Flow'],
};
const TILE_AUTHORS = ['夜航', 'Mira', 'KENJI', '青柠', 'Forrest', 'Vega', 'Atlas', 'Studio 3F', 'OceanLab', '砯 Yan', 'FLUXLAB', 'PRESS PLAY'];
const TILE_PROMPTS = {
  cn: ['电影感广角，体积雾，8K 超细节', '85mm f/1.4，黄金时刻，胶片颗粒', '戏剧性布光，全息面具，超清', '柔和霓虹，lofi 氛围，倒影', '等距插画，柔和色调，暑色窗光', '硬科幻，极致细节，蓝调大气'],
  en: ['cinematic wide angle, volumetric fog, 8K', '85mm f/1.4, golden hour, film grain', 'dramatic lighting, holo mask, ultra sharp', 'soft neon, lofi mood, reflections', 'isometric, muted palette, warm glow', 'hard sci-fi, extreme detail, blue tones'],
};
function tileMeta(seed, lang) {
  const t = TILE_TITLES[lang] || TILE_TITLES.cn;
  const p = TILE_PROMPTS[lang] || TILE_PROMPTS.cn;
  return {
    title: t[seed % t.length],
    author: TILE_AUTHORS[(seed * 3) % TILE_AUTHORS.length],
    prompt: p[(seed * 7) % p.length],
    likes: 800 + ((seed * 137) % 14000),
  };
}

/* ── helpers ──────────────────────────────────────────────────────────── */
function gradTile(seed, aspect) {
  const c1 = (seed * 97 + 23) % 360;
  const c2 = (seed * 61 + 170) % 360;
  const c3 = (seed * 43 + 290) % 360;
  return { c: mesh(c1, c2, c3), aspect };
}

const IMG_RATIOS = [
  1.32, 0.75, 1.0, 1.55, 0.88,
  0.68, 1.2, 1.45, 0.92, 1.1,
  1.38, 0.78, 1.05, 0.82, 1.25,
  1.6, 0.9, 1.15, 0.7, 1.42,
];

/* ── per-model masonry wall ───────────────────────────────────────────── */
function ModelWall({ name, desc, seed, cols = 5, count = 16, isVideo, onNav, lang }) {
  const tiles = Array.from({ length: count }, (_, i) => gradTile(seed + i * 17, isVideo ? 9 / 16 : IMG_RATIOS[i % IMG_RATIOS.length]));

  // Split into `cols` balanced columns (column-fill)
  const buckets = Array.from({ length: cols }, () => []);
  tiles.forEach((t, i) => buckets[i % cols].push(t));

  return w('section', { style: { maxWidth: 1280, margin: '0 auto', padding: '60px 22px 0' } },
    // heading
    w('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, margin: '0 0 22px', flexWrap: 'wrap' } },
      w('div', { style: { minWidth: 0 } },
        w('div', { style: { display: 'flex', alignItems: 'center', gap: 11, marginBottom: 9 } },
          w('span', { style: { width: 5, height: 26, borderRadius: 99, background: 'var(--grad)', flex: 'none' } }),
          w('h3', { className: 'font-display', style: { fontSize: 'clamp(22px, 2.8vw, 32px)', fontWeight: 800, letterSpacing: '-0.01em', textTransform: 'uppercase', margin: 0 } }, name)),
        w('p', { style: { fontSize: 14.5, color: 'var(--text-dim)', margin: 0, maxWidth: 820, lineHeight: 1.55 } }, desc)),
      w('button', { onClick: () => onNav('explore'), className: 'hide-sm',
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 600, color: 'var(--text-dim)', flex: 'none', height: 36, padding: '0 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: 'var(--panel)', transition: 'all .16s var(--ease)' },
        onMouseEnter: e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; },
        onMouseLeave: e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)'; } },
        L(SH.viewAll, lang), w(Icon, { name: 'chevron', size: 14 }))),

    isVideo
      // ── video: simple 3×N grid ─────────────────────────────────────
      ? w('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 } },
          tiles.slice(0, cols * 3).map((t, i) => {
            const meta = tileMeta(seed + i * 17, lang);
            return w('div', { key: i, className: 'tile',
              style: { position: 'relative', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 'var(--radius-sm)' } },
              w('div', { style: { position: 'absolute', inset: 0, background: t.c } }),
              w('image-slot', { id: `wall-v-${seed}-${i}`, shape: 'rounded', radius: '8', fit: 'cover',
                placeholder: lang === 'cn' ? '拖入视频封面' : 'Drop a cover',
                style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }),
              w('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.22)', pointerEvents: 'none' } }),
              w('div', { className: 'play-orb', style: { width: 44, height: 44, pointerEvents: 'none' } }, w(Icon, { name: 'play', size: 18 })),
              w('div', { className: 'tile-top', style: { pointerEvents: 'none' } },
                w('span', { className: 'media-badge' }, w(Icon, { name: 'video', size: 10 }), L(SH.viewAll, lang) === 'View all' ? 'VIDEO' : '视频'),
                w('span', { className: 'like-pill' }, w(Icon, { name: 'heart', size: 11 }), fmt(meta.likes))),
              w('div', { className: 'tile-overlay', style: { pointerEvents: 'none' } },
                w('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 2 } }, meta.title),
                w('div', { style: { fontSize: 11.5, opacity: .85 } }, '6s · 24fps · @' + meta.author)));
          }))

      // ── image: column masonry ──────────────────────────────────────
      : w('div', { style: { position: 'relative' } },
          w('div', { style: { columnCount: cols, columnGap: 10, maxHeight: 620, overflow: 'hidden' } },
            tiles.map((t, ti) => {
              const wh = [248, 184, 312, 208, 344, 196, 268, 300, 220, 176][ti % 10];
              const meta = tileMeta(seed + ti * 17, lang);
              return w('div', { key: ti, className: 'tile',
                style: { position: 'relative', width: '100%', height: wh, overflow: 'hidden',
                  borderRadius: 'var(--radius-sm)', breakInside: 'avoid', marginBottom: 10 } },
                w('div', { style: { position: 'absolute', inset: 0, background: t.c } }),
                w('image-slot', { id: `wall-i-${seed}-${ti}`, shape: 'rounded', radius: '8', fit: 'cover',
                  placeholder: lang === 'cn' ? '拖入作品图' : 'Drop artwork',
                  style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } }),
                w('div', { className: 'tile-top', style: { pointerEvents: 'none' } },
                  w('span', { className: 'media-badge' }, name.split(' ')[0]),
                  w('span', { className: 'like-pill' }, w(Icon, { name: 'heart', size: 11 }), fmt(meta.likes))),
                w('div', { className: 'tile-overlay', style: { pointerEvents: 'none' } },
                  w('div', { style: { fontSize: 13.5, fontWeight: 700, marginBottom: 3, lineHeight: 1.25 } }, meta.title),
                  w('div', { className: 'mono', style: { fontSize: 10.5, opacity: .8, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } }, meta.prompt),
                  w('span', { className: 'remix-btn' }, w(Icon, { name: 'sparkle', size: 12 }), L(SH.tryit, lang) === 'Try it' ? 'Remix' : '生成同款')));
            })),
          // fade-out + CTA
          w('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200,
            background: 'linear-gradient(to top, var(--bg) 16%, transparent 100%)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 10 } },
            w('button', { onClick: () => onNav('explore'), className: 'btn btn-primary', style: { height: 46, padding: '0 26px', fontSize: 15 } },
              L(SH.viewAll, lang), ' ', name, ' →'))),
  );
}

/* ── canvas studio section ────────────────────────────────────────────── */
// Node positions for the canvas mockup
const NODES = [
  { id: 'img-in', label: 'Image', x: '5%', y: '18%', w: 175, type: 'img', seed: 12 },
  { id: 'prompt-in', label: 'Prompt', x: '5%', y: '62%', w: 175, type: 'prompt', text: null },
  { id: 'img-out', label: 'Image', x: '35%', y: '8%', w: 290, type: 'grid4', seeds: [8, 68, 128, 200] },
  { id: 'prompt-out', label: 'Prompt', x: '40%', y: '74%', w: 270, type: 'prompt2', text: null },
  { id: 'video', label: 'Video', x: 'calc(100% - 220px)', y: '18%', w: 196, type: 'video', seed: 44 },
];
const WIRES = [
  { x1: '18%', y1: '31%', x2: '35%', y2: '28%' },
  { x1: '18%', y1: '76%', x2: '40%', y2: '80%' },
  { x1: '73%', y1: '38%', x2: 'calc(100% - 220px)', y2: '38%' },
];

function CanvasNode({ node, lang }) {
  const bg = node.type === 'img' ? mesh(node.seed, node.seed + 80, node.seed + 160) :
             node.type === 'video' ? mesh(node.seed, node.seed + 120, node.seed + 240) : null;
  const promptText = lang === 'cn'
    ? '一张低角度的工作室镜像照：短发模特俯身看向地面的镜子，表情略带惊讶、微微张口，银色 Y2K 太阳镜从下方被强调，营造出强烈的戏剧视角感……'
    : 'A low-angle studio mirror shot: the short-haired model leans over a floor mirror, slightly surprised expression, silver Y2K sunglasses emphasized from below, dramatic perspective…';

  return w('div', {
    style: { position: 'absolute', left: node.x, top: node.y, width: node.w, transform: 'translateX(0)',
      background: 'var(--panel-solid)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-card)', overflow: 'hidden' },
  },
    // title bar
    w('div', { style: { padding: '7px 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 } },
      w(Icon, { name: node.type === 'video' ? 'video' : node.type === 'prompt' || node.type === 'prompt2' ? 'copy' : 'image', size: 13 }), node.label),
    // body
    node.type === 'img' && w('div', { style: { background: bg, aspectRatio: '4/3', width: '100%' } }),
    node.type === 'video' && w('div', { style: { position: 'relative', background: bg, aspectRatio: '3/4', width: '100%' } },
      w('div', { className: 'play-orb', style: { width: 40, height: 40, opacity: .85 } }, w(Icon, { name: 'play', size: 16 }))),
    node.type === 'grid4' && w('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, padding: 8 } },
      node.seeds.map((s, i) => w('div', { key: i, style: { background: mesh(s, s + 90, s + 190), borderRadius: 6, aspectRatio: '1' } }))),
    (node.type === 'prompt' || node.type === 'prompt2') && w('div', { style: { padding: '8px 10px', fontSize: 10.5, lineHeight: 1.55, color: 'var(--text-faint)', maxHeight: 88, overflow: 'hidden' } }, promptText),
  );
}

function CanvasSection({ lang, onCreate }) {
  return w('section', { style: { padding: '72px 22px 0', textAlign: 'center' } },
    w('div', { style: { fontSize: 12.5, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 12 } }, L(SH.more, lang)),
    w('h2', { className: 'font-display', style: { fontSize: 'clamp(28px, 3.8vw, 44px)', fontWeight: 800, margin: '0 0 12px', letterSpacing: '-0.02em' } }, L(SH.canvasT, lang)),
    w('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', margin: '0 auto 30px', maxWidth: 740 } },
      w('p', { style: { fontSize: 15, color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 } }, L(SH.canvasS, lang)),
      w('button', { onClick: onCreate, style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap', borderBottom: '2px solid var(--accent)', paddingBottom: 1 } },
        L(SH.tryit, lang), w(Icon, { name: 'chevron', size: 14 }))),

    // canvas panel
    w('div', { style: { position: 'relative', maxWidth: 1180, margin: '0 auto', height: 'clamp(340px, 44vw, 500px)', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
      backgroundSize: '24px 24px' } },
      // ambient glow inside canvas
      w('div', { style: { position: 'absolute', inset: 0, background: 'radial-gradient(60% 70% at 48% 40%, var(--accent-soft), transparent 70%)', pointerEvents: 'none' } }),
      // wires (SVG)
      w('svg', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }, viewBox: '0 0 1000 460', preserveAspectRatio: 'none' },
        w('defs', null,
          w('marker', { id: 'dot', markerWidth: 6, markerHeight: 6, refX: 3, refY: 3 },
            w('circle', { cx: 3, cy: 3, r: 2.5, fill: 'var(--accent)' }))),
        // wire 1: img-in → img-out
        w('path', { d: 'M 184 165 C 280 165 280 155 348 155', fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '5 3', markerStart: 'url(#dot)', markerEnd: 'url(#dot)' }),
        // wire 2: prompt-in → prompt-out
        w('path', { d: 'M 184 360 C 300 360 300 390 405 390', fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '5 3', markerStart: 'url(#dot)', markerEnd: 'url(#dot)' }),
        // wire 3: img-out → video
        w('path', { d: 'M 640 190 C 720 190 740 185 788 190', fill: 'none', stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '5 3', markerStart: 'url(#dot)', markerEnd: 'url(#dot)' }),
      ),
      // nodes
      NODES.map((n) => w(CanvasNode, { key: n.id, node: n, lang })),
    ),
  );
}

/* ── model descriptions ───────────────────────────────────────────────── */
const MODEL_DESC = {
  gpt: { cn: 'OpenAI 最新一代多模态图像生成模型，深度理解语义、文字渲染精准、画质细腻逼真。', en: "OpenAI's latest multimodal image model — deep semantic understanding, precise text rendering, lifelike detail." },
  nano: { cn: 'Google 推出的新一代 AI 图像生成模型，生成速度更快、画质更高，支持精准文字渲染与角色一致性，分辨率最高达 4K。', en: "Google's new-gen image model — faster, sharper, precise text & character consistency, up to 4K." },
  video: { cn: '2026 年最强 AI 视频生成模型，Seedance 2.0 主打音画同步与多模态输入；Kling 3.0 支持原生 4K 60fps 与 AI 多镜头分镜，综合评测全球领先。', en: 'The strongest AI video models of 2026 — Seedance 2.0 nails audio-visual sync; Kling 3.0 brings native 4K 60fps and AI multi-shot direction.' },
};

function HomeShowcases({ lang, onCreate, onNav }) {
  return w('div', null,
    w(CanvasSection, { lang, onCreate }),
    w(ModelWall, { lang, name: 'GPT IMAGE 2', desc: MODEL_DESC.gpt[lang] || MODEL_DESC.gpt.cn, seed: 12, cols: 5, count: 18, onNav }),
    w(ModelWall, { lang, name: 'NANO BANANA 2', desc: MODEL_DESC.nano[lang] || MODEL_DESC.nano.cn, seed: 55, cols: 5, count: 18, onNav }),
    w(ModelWall, { lang, name: 'SEEDANCE 2.0 & KLING 3.0', desc: MODEL_DESC.video[lang] || MODEL_DESC.video.cn, seed: 200, cols: 3, count: 9, isVideo: true, onNav }),
  );
}

window.HomeShowcases = HomeShowcases;
