/* global React, Logo, Icon, mesh, tr, AuroraBg */
// SCARECROWAI — portal home / 门户主页
const { createElement: g, useState: gS, useEffect: gE, useRef: gR } = React;

const H = {
  cn: {
    promo: 'SCARECROWAI 2.0 不限速 · 年费低至 5.5 折',
    upgrade: '升级',
    t1: '从平凡到非凡',
    t2: '一站式超级 AI 创作智能体',
    sub: '一句话生成图片与视频 · 海量顶级模型一键调用 · 让灵感即刻成真',
    start: '开始创作',
    startUse: '开始使用',
    poweredby: '已接入主流图片 / 视频模型',
    feats: [
      { k: 'image', t: '图片生成', d: 'GPT Image 2 全新上线，高清细节拉满，画风随心定制', icon: 'image', go: 'create' },
      { k: 'video', t: '视频创作', d: 'Seedance 2.0 视听双绝，重塑 AI 视频新标杆', icon: 'video', go: 'create' },
      { k: 'studio', t: '创作间', b: 'Beta', d: '工作流让灵感自动落地，一步步生成你的大片', icon: 'layers', go: 'explore' },
      { k: 'skills', t: 'Skills', b: 'Beta', d: 'Agent Skills，天赋与行动的交汇点，能力可拓展', icon: 'bolt', go: 'market' },
    ],
    bento: [
      { t: 'GPT Image 2', d: '顶级文生图', h: 270, tall: true },
      { t: 'Nano Banana Pro', d: '极速出图', badge: 'NEW' },
      { t: '智能扩图', d: 'Outpainting', icon: 'plus' },
      { t: '移除背景', d: '一键抠图', icon: 'image' },
      { t: '精细编辑', d: '局部重绘', icon: 'sparkle' },
      { t: '移除对象', d: '智能消除', icon: 'close' },
      { t: '高清放大', d: '4× Upscale', icon: 'grid' },
    ],
    midT: '顶级 AI 模型与专业编辑工具相结合',
    midS: '一站式完成所有创作',
    showcaseT: '灵感精选',
    showcaseS: '来自社区的最新佳作，点击即可生成同款',
    showcaseMore: '进入作品广场',
    ctaT: '一站式超级 AI 智能体',
    ctaS: '从想法到成品，只差一句话',
    faqTitle: '常见问题',
    faqs: [
      { q: '什么是 SCARECROWAI？', a: 'SCARECROWAI 是一站式 AI 创作平台。一句话即可生成图片与视频，接入海量顶级模型，由你的中转站算力驱动，无需专业知识也能做出精彩作品。' },
      { q: 'SCARECROWAI 有什么优势？', a: '以「超级 AI 智能体」模式整合图片、视频与专业编辑工具，一个入口完成全部创作，无需在多个工具间来回切换。' },
      { q: '如何使用 SCARECROWAI？', a: '用文字描述你的需求（例如「赛博朋克风格的城市夜景」），点击生成即可在数秒内得到高质量结果。' },
      { q: '支持哪些模型？', a: '已接入 GPT Image 2、Nano Banana、Midjourney、Imagen、Seedance、可灵 Kling、Sora、Wan 等主流图片与视频模型，并持续更新。' },
      { q: '生成一张图 / 一段视频要多久？', a: '图片通常数秒即可完成；视频依据时长与复杂度，一般需要数分钟。' },
      { q: '生成的内容可以商用吗？', a: '你对生成内容拥有使用权，可用于社交媒体、营销推广、产品演示等场景。' },
    ],
    foot: {
      contact: '联系我们', user: '个人用户', biz: '商务合作', pay: '支付方式', keep: '随时与我们保持联系',
      cols: [
        { h: '超级智能体', items: ['深度研究', '主题创作', 'AI 聊天', 'AI 图片', 'AI 视频', 'Nano Banana Pro', 'Sora 2', 'GPT Image 2'] },
        { h: '关于', items: ['关于我们', '博客', '帮助中心', '价格方案', '服务条款', '隐私政策'] },
      ],
    },
  },
  en: {
    promo: 'SCARECROWAI 2.0 · unlimited speed · up to 45% off annual',
    upgrade: 'Upgrade',
    t1: 'From ordinary to extraordinary',
    t2: 'Your all-in-one super AI creation agent',
    sub: 'Generate images & video from a sentence · one-click access to every top model · ideas, made real',
    start: 'Start creating',
    startUse: 'Get started',
    poweredby: 'Powered by leading image / video models',
    feats: [
      { k: 'image', t: 'Image', d: 'GPT Image 2 is here — razor-sharp detail, any style you like', icon: 'image', go: 'create' },
      { k: 'video', t: 'Video', d: 'Seedance 2.0 — a new bar for AI video, sight & sound', icon: 'video', go: 'create' },
      { k: 'studio', t: 'Studio', b: 'Beta', d: 'Workflows that turn inspiration into finished work', icon: 'layers', go: 'explore' },
      { k: 'skills', t: 'Skills', b: 'Beta', d: 'Agent Skills — where talent meets action, fully extensible', icon: 'bolt', go: 'market' },
    ],
    bento: [
      { t: 'GPT Image 2', d: 'Flagship text-to-image', h: 270, tall: true },
      { t: 'Nano Banana Pro', d: 'Instant generation', badge: 'NEW' },
      { t: 'Smart Expand', d: 'Outpainting', icon: 'plus' },
      { t: 'Remove BG', d: 'One-click cutout', icon: 'image' },
      { t: 'Inpaint', d: 'Local re-paint', icon: 'sparkle' },
      { t: 'Remove Object', d: 'Smart erase', icon: 'close' },
      { t: 'Upscale', d: '4× Upscale', icon: 'grid' },
    ],
    midT: 'Top AI models meet pro editing tools',
    midS: 'Everything you create, in one place',
    showcaseT: 'Featured creations',
    showcaseS: 'Fresh community work — click any to remix it yourself',
    showcaseMore: 'Open the gallery',
    ctaT: 'One super AI agent for everything',
    ctaS: 'From idea to finished piece — just one sentence away',
    faqTitle: 'FAQ',
    faqs: [
      { q: 'What is SCARECROWAI?', a: 'SCARECROWAI is an all-in-one AI creation platform. Generate images and video from a single sentence, with one-click access to every top model — powered by your own relay, no expertise required.' },
      { q: 'What makes SCARECROWAI different?', a: 'Its “super AI agent” model unifies image, video and pro editing tools in one place, so you finish every creation from a single entry point without switching tools.' },
      { q: 'How do I use it?', a: 'Describe what you want in words (e.g. “a cyberpunk city at night”), hit generate, and get a high-quality result in seconds.' },
      { q: 'Which models are supported?', a: 'GPT Image 2, Nano Banana, Midjourney, Imagen, Seedance, Kling, Sora, Wan and more leading image & video models — continuously updated.' },
      { q: 'How long does a image / video take?', a: 'Images usually finish in seconds; video takes a few minutes depending on length and complexity.' },
      { q: 'Can I use the output commercially?', a: 'You hold usage rights to what you generate — use it for social media, marketing, product demos and more.' },
    ],
    foot: {
      contact: 'Contact', user: 'Users', biz: 'Business', pay: 'Payment', keep: 'Stay in touch',
      cols: [
        { h: 'Super Agent', items: ['Deep Research', 'Themed Create', 'AI Chat', 'AI Image', 'AI Video', 'Nano Banana Pro', 'Sora 2', 'GPT Image 2'] },
        { h: 'About', items: ['About us', 'Blog', 'Help center', 'Pricing', 'Terms', 'Privacy'] },
      ],
    },
  },
};

const HERO_MODELS = ['GPT Image 2', 'Seedance 2.0', 'Flux.1 Pro', 'Midjourney V7', 'Sora 2'];
const MARQUEE_A = ['GPT Image 2', 'Nano Banana 2', 'Midjourney V7', 'Imagen 4.0 Ultra', 'Flux.1 Pro', 'Kling 3.0 Omni', 'Sora 2', 'Wan 2.5', 'Seedream 4.5', 'Z Image Turbo', 'Qwen Image Plus', 'Google Veo 3.1', 'Seedance 2.0', 'Hailuo 2.3'];
const MARQUEE_B = ['Kling 3.0', 'Wan 2.7', 'Vidu Q2 Pro', 'Seedance 2.0 Fast', 'Hailuo 02', 'SDXL Lightning', 'Pony Diffusion', 'Ideogram 2.0', 'Wan 2.2 Plus', 'Kling O1', 'Wan 2.6', 'Imagen 4.0 Fast', 'Google Veo 3 Fast', 'Kling 2.6'];
const PAYS = ['VISA', 'MC', 'AMEX', '支付宝', '微信', 'Apple', 'PayPal', 'UnionPay'];

function dot(name) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return `linear-gradient(135deg, hsl(${h} 80% 60%), hsl(${(h + 50) % 360} 80% 52%))`; }

// hero typewriter prompt console — cycles example prompts, click to create
const PROMPTS = {
  cn: ['赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实', '青绿山水工笔，矿物颜料石青石绿，宋代院体画风', '液态金属机器人，纯白工作室布光，C4D 渲染', '黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒'],
  en: ['Cyberpunk city at night, neon reflections, cinematic, 8K', 'Gongbi green-mountain landscape, mineral pigments, Song style', 'Liquid-metal robot, white studio lighting, C4D render', 'Dusk profile portrait, 85mm f/1.4, Kodak film grain'],
};
function PromptConsole({ lang, onCreate }) {
  const list = PROMPTS[lang] || PROMPTS.cn;
  const [txt, setTxt] = gS('');
  const i = gR(0), ch = gR(0), del = gR(false);
  gE(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) { setTxt(list[0]); return; }
    let to;
    const step = () => {
      const full = list[i.current % list.length];
      if (!del.current) {
        ch.current++; setTxt(full.slice(0, ch.current));
        if (ch.current >= full.length) { del.current = true; to = setTimeout(step, 1900); return; }
        to = setTimeout(step, 52);
      } else {
        ch.current--; setTxt(full.slice(0, Math.max(0, ch.current)));
        if (ch.current <= 0) { del.current = false; i.current++; to = setTimeout(step, 280); return; }
        to = setTimeout(step, 24);
      }
    };
    to = setTimeout(step, 450);
    return () => clearTimeout(to);
  }, [lang]);
  return g('div', { className: 'console', onClick: onCreate, role: 'button', 'aria-label': lang === 'cn' ? '开始创作' : 'Start creating' },
    g(Icon, { name: 'sparkle', size: 18, style: { color: 'var(--accent)', flex: 'none' } }),
    g('div', { className: 'ph' }, txt, g('span', { className: 'caret' })),
    g('button', { className: 'console-go', onClick: onCreate }, lang === 'cn' ? '生成' : 'Generate', g(Icon, { name: 'chevron', size: 14 })));
}

// stat readout — static, solid numerals (no count-up; reads as polished, never "0")
function StatCounter({ val, label }) {
  return g('div', { style: { textAlign: 'center', minWidth: '4ch' } },
    g('div', { className: 'font-display tnum', style: { fontSize: 'clamp(22px,2.5vw,28px)', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-0.01em' } }, val),
    g('div', { style: { fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4, fontWeight: 500 } }, label));
}

function HomePage({ lang, onCreate, onNav }) {
  const s = H[lang] || H.cn;
  const heroCovers = [mesh(268, 200, 320), mesh(190, 250, 210), mesh(20, 42, 8), mesh(330, 286, 12), mesh(95, 140, 70)];
  const streamTiles = [
    [mesh(268,200,320), 1.42], [mesh(190,250,210), 0.78], [mesh(20,42,8), 1.1], [mesh(330,286,12), 1.5],
    [mesh(95,140,70), 0.86], [mesh(212,170,300), 1.0], [mesh(150,40,260), 0.82], [mesh(40,90,200), 1.46],
    [mesh(300,210,120), 1.2], [mesh(120,260,30), 0.9],
  ].map(([c, ar], i) => ({ c, ar,
    lab: (lang === 'cn'
      ? ['赛博城市','青绿山水','胶片人像','液态机甲','霓虹废土','深海水母','黄昏侧颜','轨道之城','果冻机器人','沙丘正午']
      : ['Cyber City','Ink Scape','Film Portrait','Liquid Mecha','Neon Wastes','Abyssal Jelly','Dusk Profile','Orbital City','Jelly Bot','Dune Noon'])[i],
    lk: ['4.8k','7.1k','2.4k','3.6k','5.2k','1.9k','6.3k','4.1k','2.8k','3.3k'][i], gen: i === 2 }));
  const HEAD = lang === 'cn'
    ? { kick: 'FROM ORDINARY TO EXTRAORDINARY · 从平凡到非凡', a: '超级 AI', b: '创作智能体' }
    : { kick: 'From ordinary to extraordinary', a: 'Super AI', b: 'creation agent' };
  // scroll-reveal: stagger below-the-fold blocks in as they enter the viewport
  gE(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    const els = Array.from(document.querySelectorAll('.home-deck .sec-head, .home-deck .cap-card, .home-deck .bento-tile, .home-deck .mcard, .home-deck .pcard, .home-deck .faq-row, .home-deck [data-reveal]'));
    if (!els.length) return;
    let col = 0, lastTop = -999;
    els.forEach((el) => {
      const top = el.getBoundingClientRect().top;
      col = Math.abs(top - lastTop) < 8 ? col + 1 : 0;
      lastTop = top;
      el.classList.add('reveal');
      el.style.setProperty('--rd', Math.min(col, 5) * 0.06 + 's');
    });
    const io = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    // safety: never leave content hidden
    const fb = setTimeout(() => els.forEach((el) => el.classList.add('in')), 1600);
    return () => { io.disconnect(); clearTimeout(fb); };
  }, [lang]);
  return g('div', { className: 'home-deck', style: { position: 'relative', zIndex: 1 } },

    // ── HERO · editorial command deck ───────────────────────
    g('section', { className: 'hero-tech home-hero', style: { position: 'relative', overflow: 'hidden', padding: '16px 0 clamp(40px,6vw,72px)' } },
      g(AuroraBg, { intensity: 0.82 }),
      g('div', { className: 'hero-grid' }),
      g('div', { className: 'hero-glow', style: { opacity: 0.24, mixBlendMode: 'screen' } }),
      g('div', { className: 'hero-scrim' }),
      g('div', { className: 'hero-edit' },
        g('div', { className: 'hero-topline' },
          g('div', { className: 'eyebrow' },
            g('span', { className: 'dot' }),
            g('span', null, 'SCARECROWAI OS'),
            g('span', { style: { color: 'var(--text-faint)' } }, '·'),
            g('span', { className: 'num' }, 'v2.0')),
          g('div', { className: 'live-chip' },
            g('span', { className: 'live-dot' }),
            lang === 'cn' ? '实时 · 1,240 人正在生成' : 'Live · 1,240 creating now')),
        g('h1', { className: 'hero-head font-display' },
          g('span', { className: 'l1' }, HEAD.kick),
          g('span', { className: 'l2 ac' }, HEAD.a),
          g('span', { className: 'l2' }, HEAD.b)),
        g('div', { className: 'hero-belt' },
          g('p', { className: 'hero-sub' }, s.sub),
          g(PromptConsole, { lang, onCreate }),
          g('div', { style: { marginTop: 13, fontSize: 12.5, color: 'var(--text-faint)' } },
            lang === 'cn' ? '输入一句话，或 ' : 'Type a line, or ',
            g('button', { onClick: () => onNav('market'), style: { color: 'var(--accent)', fontWeight: 600 } }, lang === 'cn' ? '浏览模型 →' : 'browse models →'))),
      ),
      // full-bleed live generation stream
      g('div', { className: 'hero-stream marquee-mask' },
        g('div', { className: 'stream-row' },
          streamTiles.concat(streamTiles).map((t, i) => g('div', { key: i, className: 'stream-tile', onClick: onCreate, style: { aspectRatio: String(t.ar) } },
            g('div', { style: { position: 'absolute', inset: 0, background: t.c } }),
            t.gen
              ? [g('div', { key: 's', className: 'stream-shim' }),
                 g('div', { key: 'g', className: 'stream-gen' }, lang === 'cn' ? '生成中 · 62%' : 'Generating · 62%'),
                 g('div', { key: 'b', className: 'stream-bar' }, g('i'))]
              : [g('span', { key: 'k', className: 'stream-lk' }, '♥ ' + t.lk),
                 g('span', { key: 'l', className: 'stream-lab' }, t.lab)]))),
      ),
      // powered-by + stat band
      g('div', { className: 'hero-powered' },
        g('span', { className: 'hero-powered-l' }, s.poweredby),
        HERO_MODELS.map((m) => g('span', { key: m, className: 'model-chip', style: { height: 34, fontSize: 12.5 } },
          g('span', { style: { width: 14, height: 14, borderRadius: 5, background: dot(m) } }), m))),
      g('div', { className: 'hero-statband' },
        [['5M+', lang === 'cn' ? '活跃创作者' : 'Creators'],
         ['200M+', lang === 'cn' ? '已生成作品' : 'Generations'],
         ['30+', lang === 'cn' ? '顶级模型' : 'Models'],
         ['4.9★', lang === 'cn' ? '用户评分' : 'Rating']]
          .map(([val, label]) => g(StatCounter, { key: label, val, label }))),
    ),

    // ── 01 · CAPABILITIES — asymmetric sticky split ─────────
    g('section', { style: { padding: 'clamp(64px,9vw,108px) 22px 0' } },
      g('div', { className: 'cap-split' },
        g('div', { className: 'cap-aside' },
          g('div', { className: 'eyebrow' }, g('span', { className: 'num' }, '01'), g('span', null, lang === 'cn' ? '核心能力' : 'Capabilities')),
          g('h2', { className: 'sec-title', style: { marginTop: 14, maxWidth: '14ch' } }, s.midT),
          g('p', { style: { fontSize: 14.5, color: 'var(--text-dim)', lineHeight: 1.62, margin: '18px 0 24px', maxWidth: 320 } }, s.midS),
          g('button', { onClick: onCreate, className: 'btn btn-ghost', style: { height: 44 } }, lang === 'cn' ? '全部工具' : 'All tools', g(Icon, { name: 'chevron', size: 15 })),
          g('div', { className: 'cap-points' },
            (lang === 'cn'
              ? [['文生图 · 图生图', '语义级理解，精准控图'], ['一键多模型', '30+ 顶级模型自由切换'], ['数秒出图', '成图即用，支持商用']]
              : [['Text & image-to-image', 'Semantic, precise control'], ['Multi-model', 'Switch 30+ top models'], ['Seconds to result', 'Commercial-ready output']]
            ).map(([t, d], i) => g('div', { key: i, className: 'cap-point' },
              g('span', { className: 'cap-point-i' }, '0' + (i + 1)),
              g('div', null,
                g('div', { className: 'cap-point-t' }, t),
                g('div', { className: 'cap-point-d' }, d)))))),
        g('div', { className: 'cap-grid2' },
          s.feats.map(function (f, i) {
            const cov = [mesh(265,210,320), mesh(150,195,90), mesh(28,48,8), mesh(322,288,200)][i % 4];
            return g('div', { key: f.k, className: 'cap-card', onClick: function () { return f.go === 'create' ? onCreate() : onNav(f.go); } },
              g('div', { className: 'cov', style: { background: cov } }),
              g('div', { className: 'scrim' }),
              g('div', { className: 'body' },
                g('span', { className: 'kick' }, f.b ? f.b : (lang === 'cn' ? '核心' : 'CORE')),
                g('h3', null, f.t),
                g('div', { className: 'cdesc' }, f.d),
                g('span', { className: 'cta' }, lang === 'cn' ? '试一下' : 'Try it', g(Icon, { name: 'chevron', size: 13 }))));
          })))),

    // ── BENTO ───────────────────────────────────────────────
    g('section', { style: { maxWidth: 1200, margin: '0 auto', padding: '40px 22px 0' } },
      g('div', { className: 'eyebrow', style: { marginBottom: 18 } },
        g('span', { style: { color: 'var(--text-faint)' } }, lang === 'cn' ? '配套编辑工具 · 一站直达' : 'Editing toolkit · all in one')),
      g('div', { style: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: '152px', perspective: '1400px' } },
        s.bento.map((b, i) => {
          const cov = heroCovers[i % heroCovers.length] || mesh(i * 40, i * 40 + 90, i * 30 + 200);
          return g('div', { key: i, className: 'bento-tile', onClick: onCreate,
            onMouseMove: (ev) => {
              const el = ev.currentTarget, r = el.getBoundingClientRect();
              const x = ((ev.clientX-r.left)/r.width-0.5)*9;
              const y = ((ev.clientY-r.top)/r.height-0.5)*-9;
              el.style.transform = `perspective(900px) rotateX(${y}deg) rotateY(${x}deg) translateY(-5px)`;
              el.style.transition = 'box-shadow .2s';
            },
            onMouseLeave: (ev) => { ev.currentTarget.style.transform = ''; ev.currentTarget.style.transition = 'all .5s var(--ease)'; },
            style: { gridRow: b.tall ? 'span 2' : 'span 1', gridColumn: i === 0 ? 'span 1' : 'span 1' } },
            g('div', { className: 'bento-img', style: { position: 'absolute', inset: 0, background: cov } }),
            g('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.45) 0%, transparent 38%, transparent 60%, rgba(0,0,0,.55) 100%)' } }),
            g('div', { className: 'bento-content', style: { position: 'absolute', inset: 0 } },
            b.badge ? g('span', { style: { position: 'absolute', top: 11, right: 11, fontSize: 10, fontWeight: 800, color: '#fff', background: 'var(--grad-warm)', padding: '3px 8px', borderRadius: 5 } }, b.badge) : null,
            g('div', { style: { position: 'absolute', top: 12, left: 13, display: 'flex', alignItems: 'center', gap: 8, color: '#fff' } },
              b.icon ? g('span', { style: { width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.18)', backdropFilter: 'blur(6px)' } }, g(Icon, { name: b.icon, size: 15 })) : null,
              g('span', { className: b.tall ? 'font-display' : '', style: { fontSize: b.tall ? 24 : 15, fontWeight: b.tall ? 800 : 700, textShadow: '0 1px 8px rgba(0,0,0,.5)' } }, b.t)),
            g('div', { style: { position: 'absolute', bottom: 12, left: 13, right: 13, fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.9)', textShadow: '0 1px 6px rgba(0,0,0,.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, b.d)));
        })),
    ),

    // ── SHOWCASES (创作间 + 按模型作品展示墙) ─────────────
    g(HomeShowcases, { lang, onCreate, onNav }),

    // ── 02 · MODEL MATRIX — asymmetric statement ────────────
    g('section', { className: 'deck-rule', style: { padding: 'clamp(70px,9vw,112px) 22px 6px' } },
      g('div', { className: 'matrix-split' },
        g('div', { className: 'matrix-copy' },
          g('div', { className: 'eyebrow', style: { marginBottom: 16 } }, g('span', { className: 'num' }, '02'), g('span', null, lang === 'cn' ? '全模型矩阵' : 'Model matrix')),
          g('h2', { className: 'font-display', style: { fontSize: 'clamp(30px, 4.6vw, 58px)', fontWeight: 800, lineHeight: 1.02, margin: '0 0 26px', letterSpacing: '-0.03em' } },
            lang === 'cn' ? '一个平台，' : 'One platform,', g('br'), g('span', { className: 'gtext' }, lang === 'cn' ? '接入所有顶级模型' : 'every top model')),
          g('div', { style: { display: 'flex', gap: 'clamp(20px,3vw,44px)', flexWrap: 'wrap' } },
            [['30+', lang === 'cn' ? '图片 · 视频 · 音频' : 'image · video · audio'],
             ['14', lang === 'cn' ? 'OpenAI · Google · 字节…' : 'OpenAI · Google · ByteDance…'],
             [lang === 'cn' ? '每周' : 'Weekly', lang === 'cn' ? '新模型上线即用' : 'new models, day one']]
              .map(([a, b]) => g('div', { key: b },
                g('div', { className: 'font-display', style: { fontSize: 'clamp(26px,3vw,38px)', fontWeight: 800, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.02em' } }, a),
                g('div', { style: { fontSize: 12.5, color: 'var(--text-faint)', marginTop: 6 } }, b))))),
        g('div', { className: 'matrix-marquees' },
          g('div', { className: 'marquee-mask' },
            g('div', { className: 'marquee-row' }, MARQUEE_A.concat(MARQUEE_A).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { style: { width: 18, height: 18, borderRadius: 6, background: dot(m) } }), m)))),
          g('div', { className: 'marquee-mask' },
            g('div', { className: 'marquee-row rev' }, MARQUEE_B.concat(MARQUEE_B).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { style: { width: 18, height: 18, borderRadius: 6, background: dot(m) } }), m)))),
          g('div', { className: 'marquee-mask' },
            g('div', { className: 'marquee-row' }, MARQUEE_A.slice(5).concat(MARQUEE_A).map((m, i) => g('span', { key: i, className: 'model-chip' }, g('span', { style: { width: 18, height: 18, borderRadius: 6, background: dot(m) } }), m))))))),

    // ── CTA BAND ────────────────────────────────────────────
    g('section', { style: { position: 'relative', overflow: 'hidden', margin: '70px 0 0', padding: 'clamp(40px,7vw,90px) 22px' } },
      g('div', { className: 'hero-glow', style: { top: '-10%', opacity: '.7', height: 520 } }),
      // floating cards
      [{ l: '4%', t: '18%', s: 132, h: 0 }, { l: '12%', t: '54%', s: 108, h: 30 }, { r: '5%', t: '14%', s: 120, h: 60 }, { r: '13%', t: '58%', s: 96, h: 90 }, { r: '3%', t: '70%', s: 80, h: 150 }].map((c, i) =>
        g('div', { key: i, className: 'hide-md float-card', style: { position: 'absolute', left: c.l, right: c.r, top: c.t, width: c.s, height: c.s * 1.15, borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: mesh(c.h, c.h + 90, c.h + 200), '--rot': `${i % 2 ? 5 : -5}deg`, '--dur': `${6 + i * 0.9}s`, animationDelay: `${i * 0.7}s` } })),
      g('div', { className: 'cta-panel' },
        g('div', { className: 'hero-grid', style: { opacity: 0.4 } }),
        g('div', { style: { position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 640, margin: '0 auto' } },
          g('div', { className: 'eyebrow', style: { justifyContent: 'center', marginBottom: 18 } }, g('span', { className: 'dot' }), g('span', null, lang === 'cn' ? '现在开始' : 'Get started')),
          g('h2', { className: 'font-display', style: { fontSize: 'clamp(30px, 4.4vw, 54px)', fontWeight: 800, lineHeight: 1.08, margin: '0 0 14px', letterSpacing: '-0.025em' } }, s.ctaT),
          g('p', { style: { fontSize: 16, color: 'var(--text-dim)', margin: '0 0 30px' } }, s.ctaS),
          g('div', { style: { display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' } },
            g('button', { className: 'cta-pill', onClick: onCreate }, g(Icon, { name: 'sparkle', size: 18, style: { color: 'var(--accent)' } }), s.startUse),
            g('button', { className: 'btn btn-ghost', style: { height: 56, padding: '0 26px', fontSize: 16, borderRadius: 'var(--radius-pill)' }, onClick: () => onNav('explore') }, lang === 'cn' ? '看作品广场' : 'Browse gallery')),
          g('div', { style: { marginTop: 20, fontSize: 12.5, color: 'var(--text-faint)', display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' } },
            g('span', null, lang === 'cn' ? '✓ 免费开始' : '✓ Free to start'),
            g('span', null, lang === 'cn' ? '✓ 无需信用卡' : '✓ No credit card'),
            g('span', null, lang === 'cn' ? '✓ 数秒出图' : '✓ Results in seconds')))),
    ),

    // ── FAQ ─────────────────────────────────────────────────
    g(FaqList, { s, lang }),

    // ── FOOTER ──────────────────────────────────────────────
    g(HomeFooter, { lang, s, onNav, onCreate }),
  );
}

function FaqList({ s, lang }) {
  const [open, setOpen] = gS(0);
  return g('section', { style: { padding: 'clamp(56px,8vw,104px) 22px 30px' } },
    g('div', { className: 'faq-split' },
      // aside
      g('div', { className: 'faq-aside' },
        g('div', { className: 'eyebrow', style: { marginBottom: 16 } }, g('span', { className: 'num' }, '03'), g('span', null, s.faqTitle)),
        g('h2', { className: 'font-display', style: { fontSize: 'clamp(28px, 3.4vw, 44px)', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-0.025em', lineHeight: 1.1 } }, lang === 'cn' ? '还有疑问？' : 'Still curious?'),
        g('p', { style: { fontSize: 14.5, color: 'var(--text-dim)', lineHeight: 1.65, margin: '0 0 22px', maxWidth: 300 } }, lang === 'cn' ? '没找到答案？我们的团队随时在线，几分钟内回复。' : "Can't find it? Our team is online and replies in minutes."),
        g('a', { href: 'mailto:support@scarecrow.ai', className: 'btn btn-primary', style: { textDecoration: 'none' } }, g(Icon, { name: 'sparkle', size: 16 }), lang === 'cn' ? '联系我们' : 'Contact us')),
      // accordion
      g('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        s.faqs.map(function (f, i) {
          const isOpen = open === i;
          return g('div', { key: i, className: 'faq-item glass', 'data-reveal': '1', style: { borderColor: isOpen ? 'var(--accent-soft)' : 'var(--border)', background: isOpen ? 'var(--panel-hover)' : undefined } },
            g('button', { className: 'faq-q', onClick: function () { return setOpen(isOpen ? -1 : i); } },
              g('span', { style: { flex: 1 } }, f.q),
              g('span', { style: { flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', background: isOpen ? 'var(--accent)' : 'var(--panel)', color: isOpen ? 'var(--on-accent)' : 'var(--text-dim)', transition: 'all .2s var(--ease)' } },
                g(Icon, { name: 'plus', size: 15, style: { transform: isOpen ? 'rotate(45deg)' : 'none', transition: 'transform .22s var(--ease)' } }))),
            isOpen ? g('div', { style: { padding: '0 20px 20px', fontSize: 14, lineHeight: 1.65, color: 'var(--text-dim)' } }, f.a) : null);
        }))));
}

function HomeFooter({ lang, s, onNav }) {
  return g('footer', { style: { borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '54px 22px 34px' } },
    g('div', { style: { maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 40, gridTemplateColumns: 'minmax(200px, 1.3fr) repeat(3, minmax(120px, 1fr))', alignItems: 'start' } },
      // brand col
      g('div', null,
        g('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 } }, g(Logo, { size: 26 }), g('span', { className: 'font-display', style: { fontWeight: 800, fontSize: 18 } }, 'SCARECROW', g('span', { style: { color: 'var(--accent)' } }, 'AI'))),
        g('div', { style: { fontSize: 13, color: 'var(--text-faint)', marginBottom: 12 } }, s.foot.keep),
        g('div', { style: { display: 'flex', gap: 9 } }, ['X', 'D', 'Y'].map((x) => g('span', { key: x, style: { width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text-dim)' } }, x))),
        g('div', { style: { marginTop: 22, fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 9 } }, s.foot.pay),
        g('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, PAYS.map((p) => g('span', { key: p, className: 'pay-badge' }, p)))),
      // contact col
      g('div', null,
        g('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 14 } }, s.foot.contact),
        g('div', { style: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 10 } }, s.foot.user, '：', g('a', { className: 'foot-link', style: { display: 'inline', color: 'var(--accent)' }, href: 'mailto:support@scarecrow.ai' }, 'support@scarecrow.ai')),
        g('div', { style: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 } }, s.foot.biz, '：', g('a', { className: 'foot-link', style: { display: 'inline', color: 'var(--accent)' }, href: 'mailto:business@scarecrow.ai' }, 'business@scarecrow.ai'))),
      // link cols
      s.foot.cols.map((col, ci) => g('div', { key: ci },
        g('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 10 } }, col.h),
        col.items.map((it) => g('a', { key: it, className: 'foot-link', onClick: (e) => { e.preventDefault(); if (it.match(/价格|Pricing/)) onNav('market'); }, href: '#' }, it))))),
    g('div', { style: { maxWidth: 1200, margin: '34px auto 0', paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', fontSize: 12, color: 'var(--text-faint)' } },
      g('span', null, '© 2026 SCARECROWAI · ', lang === 'cn' ? '稻草人智绘 · 由你的中转站驱动' : 'Powered by your relay'),
      g('span', null, tr(lang, 'foot.tip'))));
}

window.HomePage = HomePage;
