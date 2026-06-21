/* global React, Logo, mesh, ARTWORKS, fmt */
// SCARECROWAI — redesigned portal home. Shader hero + community work wall.
const { createElement: g, useState: uS, useEffect: uE, useRef: uR, Fragment: Frag } = React;

/* ── compact icon set ─────────────────────────────────────────────────── */
const PATHS = {
  spark: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z',
  chev: 'M9 6l6 6-6 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  play: 'M8 5v14l11-7z',
  heart: 'M12 21s-7.5-4.6-10-9.3C.6 8.4 2 5 5.2 5 7.3 5 8.7 6.3 12 9c3.3-2.7 4.7-4 6.8-4C22 5 23.4 8.4 22 11.7 19.5 16.4 12 21 12 21z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6z',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  video: 'M4 6h11v12H4zM15 10l5-3v10l-5-3',
  layers: 'M12 3l9 5-9 5-9-5zM3 14l9 5 9-5',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18',
  search: 'M11 4a7 7 0 105 12l4 4M11 4a7 7 0 015 12',
};
function Icon({ name, size = 18, style, fill }) {
  const d = PATHS[name] || PATHS.chev;
  const filled = name === 'play' || name === 'spark' || name === 'bolt' || name === 'heart';
  return g('svg', { width: size, height: size, viewBox: '0 0 24 24', style: { flex: 'none', ...style },
    fill: filled ? (fill || 'currentColor') : 'none', stroke: filled ? 'none' : 'currentColor',
    strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    g('path', { d }));
}

function swatch(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 48) % 360} 78% 52%))`; }

/* ── copy ─────────────────────────────────────────────────────────────── */
const C = {
  cn: {
    nav: [['gallery', '作品广场'], ['models', '模型市场'], ['studio', '创作间'], ['pricing', '定价']],
    login: '登录', upgrade: '升级 Pro',
    live: '正在生成', h1a: '一句话，', h1b: '生成万象',
    sub: '一站式超级 AI 创作智能体 —— 文生图、文生视频、海量顶级模型一键直达，让灵感即刻成真。',
    go: '生成', metaA: '输入一句话，或', metaB: '浏览模型 →',
    trust: '已接入', stats: [['200M+', '已生成作品'], ['5M+', '活跃创作者'], ['30+', '顶级模型'], ['4.9★', '用户评分']],
    scroll: '向下探索',
    wallKick: '社区精选', wallTitle: '灵感作品广场', wallSub: '来自全球创作者的最新佳作 —— 点击任意一张，即可生成同款。',
    wallMore: '进入作品广场', remix: '生成同款',
    filters: [['all', '全部'], ['image', '图片'], ['video', '视频'], ['scifi', '科幻'], ['portrait', '人像'], ['anime', '动漫'], ['guofeng', '国风'], ['3d', '3D']],
    featKick: '核心能力', featTitle: '顶级模型 × 专业工具，一处搞定',
    feats: [
      { t: '图片生成', d: 'GPT Image 2 全新上线，高清细节拉满，画风随心定制。', icon: 'image', h: [265, 210, 320] },
      { t: '视频创作', d: 'Seedance 2.0 视听双绝，重塑 AI 视频新标杆。', icon: 'video', h: [190, 250, 210] },
      { t: '创作间 Studio', d: '工作流让灵感自动落地，一步步生成你的大片。', icon: 'layers', h: [28, 48, 8] },
    ],
    mxKick: '全模型矩阵', mxTitle: ['一个平台，', '接入所有顶级模型'],
    mxStats: [['30+', '图片 · 视频 · 音频'], ['14', 'OpenAI · Google · 字节…'], ['每周', '新模型上线即用']],
    ctaKick: '现在开始', ctaTitle: '从想法到成品，只差一句话', ctaSub: '免费开始，无需信用卡，数秒出图。',
    ctaGo: '开始创作', ctaBrowse: '看作品广场',
    fine: ['✓ 免费开始', '✓ 无需信用卡', '✓ 数秒出图'],
    footTag: '稻草人智绘 · 由你的中转站驱动',
    footCols: [
      { h: '超级智能体', items: ['AI 图片', 'AI 视频', 'Nano Banana Pro', 'Sora 2', 'GPT Image 2', '深度研究'] },
      { h: '探索', items: ['作品广场', '模型市场', '创作间', '热门榜单'] },
      { h: '关于', items: ['关于我们', '博客', '帮助中心', '价格方案', '服务条款', '隐私政策'] },
    ],
    foot: '高保真交互原型 · 占位封面为生成式渐变，可替换为真实作品',
  },
  en: {
    nav: [['gallery', 'Gallery'], ['models', 'Models'], ['studio', 'Studio'], ['pricing', 'Pricing']],
    login: 'Sign in', upgrade: 'Upgrade',
    live: 'creating now', h1a: 'One line,', h1b: 'infinite worlds',
    sub: 'Your all-in-one super AI creation agent — text-to-image, text-to-video, every top model one click away. Ideas, made real.',
    go: 'Generate', metaA: 'Type a line, or', metaB: 'browse models →',
    trust: 'Powered by', stats: [['200M+', 'Generations'], ['5M+', 'Creators'], ['30+', 'Models'], ['4.9★', 'Rating']],
    scroll: 'SCROLL',
    wallKick: 'Community picks', wallTitle: 'Inspiration gallery', wallSub: 'The freshest work from creators worldwide — click any piece to remix it yourself.',
    wallMore: 'Open the gallery', remix: 'Remix',
    filters: [['all', 'All'], ['image', 'Image'], ['video', 'Video'], ['scifi', 'Sci-Fi'], ['portrait', 'Portrait'], ['anime', 'Anime'], ['guofeng', 'Guofeng'], ['3d', '3D']],
    featKick: 'Capabilities', featTitle: 'Top models × pro tools, all in one',
    feats: [
      { t: 'Image', d: 'GPT Image 2 is here — razor-sharp detail, any style you like.', icon: 'image', h: [265, 210, 320] },
      { t: 'Video', d: 'Seedance 2.0 — a new bar for AI video, sight and sound.', icon: 'video', h: [190, 250, 210] },
      { t: 'Studio', d: 'Workflows that turn inspiration into finished work, step by step.', icon: 'layers', h: [28, 48, 8] },
    ],
    mxKick: 'Model matrix', mxTitle: ['One platform,', 'every top model'],
    mxStats: [['30+', 'image · video · audio'], ['14', 'OpenAI · Google · ByteDance…'], ['Weekly', 'new models, day one']],
    ctaKick: 'Get started', ctaTitle: 'From idea to finished piece — one sentence away', ctaSub: 'Free to start, no credit card, results in seconds.',
    ctaGo: 'Start creating', ctaBrowse: 'Browse gallery',
    fine: ['✓ Free to start', '✓ No credit card', '✓ Results in seconds'],
    footTag: 'Powered by your relay',
    footCols: [
      { h: 'Super Agent', items: ['AI Image', 'AI Video', 'Nano Banana Pro', 'Sora 2', 'GPT Image 2', 'Deep Research'] },
      { h: 'Explore', items: ['Gallery', 'Models', 'Studio', 'Trending'] },
      { h: 'About', items: ['About us', 'Blog', 'Help center', 'Pricing', 'Terms', 'Privacy'] },
    ],
    foot: 'Hi-fi interactive prototype · placeholder covers are generative gradients — swap in real work',
  },
};

const PROMPTS = {
  cn: ['赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实', '青绿山水工笔，石青石绿设色，宋代院体画风', '液态金属机器人，纯白工作室布光，C4D 渲染', '黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒'],
  en: ['Cyberpunk city at night, neon reflections, cinematic, 8K', 'Gongbi green-mountain landscape, mineral pigments, Song style', 'Liquid-metal robot, white studio lighting, C4D render', 'Dusk profile portrait, 85mm f/1.4, Kodak film grain'],
};
const HERO_MODELS = ['GPT Image 2', 'Seedance 2.0', 'Flux.1 Pro', 'Midjourney V7', 'Sora 2'];
const MQ_A = ['GPT Image 2', 'Nano Banana 2', 'Midjourney V7', 'Imagen 4.0 Ultra', 'Flux.1 Pro', 'Kling 3.0 Omni', 'Sora 2', 'Wan 2.5', 'Seedream 4.5', 'Z Image Turbo', 'Qwen Image Plus', 'Google Veo 3.1'];
const MQ_B = ['Kling 3.0', 'Wan 2.7', 'Vidu Q2 Pro', 'Seedance 2.0 Fast', 'Hailuo 02', 'Ideogram 2.0', 'Wan 2.2 Plus', 'Kling O1', 'Imagen 4.0 Fast', 'Google Veo 3 Fast', 'SDXL Lightning', 'Pony Diffusion'];

/* ── typewriter prompt console ────────────────────────────────────────── */
function Console({ lang }) {
  const list = PROMPTS[lang] || PROMPTS.cn;
  const [txt, setTxt] = uS('');
  const i = uR(0), ch = uR(0), del = uR(false);
  uE(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) { setTxt(list[0]); return; }
    let to;
    const step = () => {
      const full = list[i.current % list.length];
      if (!del.current) {
        ch.current++; setTxt(full.slice(0, ch.current));
        if (ch.current >= full.length) { del.current = true; to = setTimeout(step, 2000); return; }
        to = setTimeout(step, 50);
      } else {
        ch.current--; setTxt(full.slice(0, Math.max(0, ch.current)));
        if (ch.current <= 0) { del.current = false; i.current++; to = setTimeout(step, 300); return; }
        to = setTimeout(step, 22);
      }
    };
    to = setTimeout(step, 500);
    return () => clearTimeout(to);
  }, [lang]);
  const t = C[lang];
  return g('div', { className: 'console', role: 'button', tabIndex: 0 },
    g(Icon, { name: 'spark', size: 20, className: 'console-spark', style: { color: 'var(--accent)' } }),
    g('div', { className: 'console-ph' }, txt, g('span', { className: 'caret' })),
    g('button', { className: 'console-go' }, t.go, g(Icon, { name: 'arrow', size: 15 })));
}

/* ── shader-backed canvas ─────────────────────────────────────────────── */
function ShaderCanvas({ className, intensity, scale }) {
  const ref = uR(null);
  uE(() => {
    if (!ref.current || !window.initAuroraShader) return;
    const down = window.initAuroraShader(ref.current, { intensity, scale });
    return down;
  }, []);
  return g('canvas', { ref, className, 'aria-hidden': true });
}

/* ── live stream marquee ──────────────────────────────────────────────── */
function Stream({ lang }) {
  const tiles = ARTWORKS.slice(0, 10).map((a, idx) => ({
    c: a.c, lab: lang === 'cn' ? a.titleCn : a.titleEn, lk: fmt(a.likes),
    gen: idx === 2 || idx === 7,
  }));
  const row = tiles.concat(tiles);
  return g('div', { className: 'stream' },
    g('div', { className: 'stream-mask' },
      g('div', { className: 'stream-row' },
        row.map((t, i) => g('div', { key: i, className: 'stream-tile' },
          g('div', { className: 'cov', style: { background: t.c } }),
          t.gen
            ? g(Frag, null,
                g('div', { className: 'shim' }),
                g('div', { className: 'genbar' }, g('i')),
                g('div', { className: 'gen' }, lang === 'cn' ? '生成中 · 62%' : 'Generating · 62%'))
            : g(Frag, null,
                g('div', { className: 'lk' }, '♥ ' + t.lk),
                g('div', { className: 'lab' }, t.lab)))))));
}

/* ── work wall ────────────────────────────────────────────────────────── */
function Wall({ lang, filter }) {
  const items = ARTWORKS.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'image') return a.type === 'image';
    if (filter === 'video') return a.type === 'video';
    return a.cat === filter;
  });
  const list = items.length ? items : ARTWORKS;
  return g('div', { className: 'wall' },
    list.map((a) => {
      const isVid = a.type === 'video';
      const h = Math.round(220 * (a.h || 1));
      return g('div', { key: a.id, className: 'tile', 'data-reveal': '1' },
        g('div', { className: 'cov', style: { background: a.c, height: h } }),
        g('div', { className: 'grad' }),
        isVid ? g('div', { className: 'play' }, g(Icon, { name: 'play', size: 20 })) : null,
        g('div', { className: 'top' },
          g('span', { className: 'badge' }, isVid ? (lang === 'cn' ? '视频' : 'VIDEO') : a.model),
          g('span', { className: 'lk' }, g(Icon, { name: 'heart', size: 12 }), fmt(a.likes))),
        g('div', { className: 'info' },
          g('div', { className: 't' }, lang === 'cn' ? a.titleCn : a.titleEn),
          g('div', { className: 'a' }, '@' + a.author),
          g('button', { className: 'remix' }, g(Icon, { name: 'spark', size: 13 }), C[lang].remix)));
    }));
}

/* ── page ─────────────────────────────────────────────────────────────── */
function App() {
  const [lang, setLang] = uS(() => { try { return (localStorage.getItem('scarecrowai_lang') || 'cn') === 'en' ? 'en' : 'cn'; } catch (e) { return 'cn'; } });
  const [filter, setFilter] = uS('all');
  const [stuck, setStuck] = uS(false);
  const t = C[lang];

  uE(() => { try { localStorage.setItem('scarecrowai_lang', lang); } catch (e) {} document.documentElement.lang = lang === 'cn' ? 'zh' : 'en'; }, [lang]);

  uE(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // scroll reveal
  uE(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const els = Array.from(document.querySelectorAll('[data-reveal]'));
    let lastTop = -999, col = 0;
    els.forEach((el) => {
      const top = el.getBoundingClientRect().top;
      col = Math.abs(top - lastTop) < 8 ? col + 1 : 0; lastTop = top;
      el.classList.add('reveal'); el.style.setProperty('--rd', Math.min(col, 4) * 0.06 + 's');
    });
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    els.forEach((el) => io.observe(el));
    const fb = setTimeout(() => els.forEach((el) => el.classList.add('in')), 1600);
    return () => { io.disconnect(); clearTimeout(fb); };
  }, [filter, lang]);

  return g('div', { className: 'page' },

    // NAV
    g('nav', { className: 'nav', 'data-stuck': stuck },
      g('a', { className: 'nav-brand', href: '#' }, g(Logo, { size: 30 }), g('span', { className: 'wm' }, 'SCARECROW', g('span', { style: { color: 'var(--accent)' } }, 'AI'))),
      g('div', { className: 'nav-links' }, t.nav.map(([k, label]) => g('a', { key: k, className: 'nav-link', href: '#' }, label))),
      g('div', { className: 'nav-spacer' }),
      g('div', { className: 'nav-right' },
        g('button', { className: 'nav-link', onClick: () => setLang(lang === 'cn' ? 'en' : 'cn'), style: { gap: 6 } }, g(Icon, { name: 'globe', size: 16 }), lang === 'cn' ? 'EN' : '中'),
        g('a', { className: 'nav-link', href: '#' }, t.login),
        g('a', { className: 'nav-upgrade', href: '#' }, g(Icon, { name: 'bolt', size: 14 }), t.upgrade))),

    // HERO
    g('header', { className: 'hero' },
      g(ShaderCanvas, { className: 'hero-canvas', intensity: 1.0, scale: 0.6 }),
      g('div', { className: 'hero-mesh' }),
      g('div', { className: 'hero-veil' }),
      g('div', { className: 'hero-inner' },
        g('div', { className: 'eyebrow' }, g('span', { className: 'live-dot' }), 'SCARECROWAI OS · v2.0', g('span', { style: { color: 'var(--text-faint)' } }, '·'), g('span', { className: 'tnum' }, lang === 'cn' ? '1,240 人' : '1,240'), lang === 'cn' ? '正在生成' : ' creating now'),
        g('h1', { className: 'hero-h1' }, t.h1a, g('br'), g('span', { className: 'grad' }, t.h1b)),
        g('p', { className: 'hero-sub' }, t.sub),
        g(Console, { lang }),
        g('div', { className: 'hero-meta' }, g('span', null, t.metaA, ' '), g('a', { href: '#' }, t.metaB)),
        g('div', { className: 'trust' },
          g('span', { className: 'trust-label' }, t.trust),
          HERO_MODELS.map((m) => g('span', { key: m, className: 'model-chip' }, g('span', { className: 'swatch', style: { background: swatch(m) } }), m)))),
      g('div', { className: 'hero-stats' },
        t.stats.map(([v, l]) => g('div', { key: l, className: 'hero-stat' }, g('div', { className: 'v' }, v), g('div', { className: 'l' }, l)))),
      g('div', { className: 'scroll-cue' }, g('span', null, t.scroll), g('span', { className: 'bar' }))),

    // STREAM
    g(Stream, { lang }),

    // WORK WALL
    g('section', { className: 'sec wrap' },
      g('div', { className: 'sec-head' },
        g('div', null,
          g('span', { className: 'sec-kick' }, g('span', { className: 'num' }, '01'), t.wallKick),
          g('h2', { className: 'sec-title' }, t.wallTitle),
          g('p', { className: 'sec-sub' }, t.wallSub)),
        g('a', { className: 'link-btn', href: '#' }, t.wallMore, g(Icon, { name: 'arrow', size: 15 }))),
      g('div', { className: 'filters' },
        t.filters.map(([k, label]) => g('button', { key: k, className: 'chip', 'data-active': filter === k, onClick: () => setFilter(k) }, label))),
      g(Wall, { lang, filter })),

    // FEATURE TRIO
    g('section', { className: 'sec wrap' },
      g('div', { className: 'sec-head' },
        g('div', null,
          g('span', { className: 'sec-kick' }, g('span', { className: 'num' }, '02'), t.featKick),
          g('h2', { className: 'sec-title' }, t.featTitle))),
      g('div', { className: 'feat-grid' },
        t.feats.map((f, i) => g('div', { key: i, className: 'feat', 'data-reveal': '1' },
          g('div', { className: 'cov', style: { background: mesh(f.h[0], f.h[1], f.h[2]) } }),
          g('div', { className: 'scrim' }),
          g('span', { className: 'kick' }, lang === 'cn' ? '核心' : 'CORE'),
          g('div', { className: 'body' },
            g('span', { style: { width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(6px)', marginBottom: 12 } }, g(Icon, { name: f.icon, size: 19 })),
            g('h3', null, f.t),
            g('p', null, f.d),
            g('span', { className: 'go' }, lang === 'cn' ? '试一下' : 'Try it', g(Icon, { name: 'chev', size: 14 })))))))
    ,

    // MODEL MATRIX
    g('section', { className: 'sec wrap' },
      g('div', { className: 'matrix' },
        g('div', null,
          g('span', { className: 'sec-kick' }, g('span', { className: 'num' }, '03'), t.mxKick),
          g('h2', { className: 'sec-title', style: { marginTop: 14 } }, t.mxTitle[0], g('br'), g('span', { className: 'gtext' }, t.mxTitle[1])),
          g('div', { style: { display: 'flex', gap: 'clamp(20px,3vw,44px)', flexWrap: 'wrap', marginTop: 28 } },
            t.mxStats.map(([a, b]) => g('div', { key: b },
              g('div', { className: 'font-display', style: { fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 } }, a),
              g('div', { style: { fontSize: 12.5, color: 'var(--text-faint)', marginTop: 6 } }, b))))),
        g('div', null,
          g('div', { className: 'mq' }, g('div', { className: 'mq-row' }, MQ_A.concat(MQ_A).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { className: 'swatch', style: { background: swatch(m) } }), m)))),
          g('div', { className: 'mq' }, g('div', { className: 'mq-row rev' }, MQ_B.concat(MQ_B).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { className: 'swatch', style: { background: swatch(m) } }), m)))),
          g('div', { className: 'mq' }, g('div', { className: 'mq-row' }, MQ_A.slice(4).concat(MQ_A).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { className: 'swatch', style: { background: swatch(m) } }), m))))))),

    // CTA
    g('section', { className: 'sec wrap' },
      g('div', { className: 'cta' },
        g(ShaderCanvas, { className: 'cta-canvas', intensity: 1.15, scale: 0.5 }),
        g('div', { className: 'cta-veil' }),
        g('div', { className: 'cta-inner' },
          g('span', { className: 'sec-kick', style: { justifyContent: 'center' } }, g('span', { className: 'live-dot', style: { width: 7, height: 7, borderRadius: '50%', background: '#2ee6a6', display: 'inline-block' } }), t.ctaKick),
          g('h2', null, t.ctaTitle),
          g('p', null, t.ctaSub),
          g('div', { className: 'cta-actions' },
            g('button', { className: 'cta-pill' }, g(Icon, { name: 'spark', size: 18 }), t.ctaGo),
            g('button', { className: 'cta-ghost' }, t.ctaBrowse)),
          g('div', { className: 'cta-fine' }, t.fine.map((f) => g('span', { key: f }, f)))))),

    // FOOTER
    g('footer', { className: 'foot' },
      g('div', { className: 'foot-grid' },
        g('div', null,
          g('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 } }, g(Logo, { size: 26 }), g('span', { className: 'font-display', style: { fontWeight: 800, fontSize: 18 } }, 'SCARECROW', g('span', { style: { color: 'var(--accent)' } }, 'AI'))),
          g('div', { style: { fontSize: 13, color: 'var(--text-faint)', maxWidth: 240, lineHeight: 1.6 } }, t.footTag),
          g('div', { className: 'foot-social' }, ['X', 'D', 'Y'].map((x) => g('span', { key: x }, x)))),
        t.footCols.map((col, i) => g('div', { key: i },
          g('h4', null, col.h),
          col.items.map((it) => g('a', { key: it, className: 'foot-link', href: '#' }, it))))),
      g('div', { className: 'foot-bottom' },
        g('span', null, '© 2026 SCARECROWAI · ', t.footTag),
        g('span', null, t.foot))));
}

window.HomeApp = App;
