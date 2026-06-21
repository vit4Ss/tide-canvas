/* global React, Icon, mesh, tr */
// SCARECROWAI — Inspiration page / 灵感提示词库
const { createElement: ins, useState: insS, useMemo: insM } = React;

const INS_TABS = {
  cn: ['灵感', '主题', '提示词'],
  en: ['Inspiration', 'Topics', 'Prompts'],
};

const TOPICS = [
  { id: 'portrait', cn: '人像写真', en: 'Portrait', icon: 'user', color: '#ec4899' },
  { id: 'landscape', cn: '风景自然', en: 'Landscape', icon: 'image', color: '#10b981' },
  { id: 'anime', cn: '动漫插画', en: 'Anime', icon: 'sparkle', color: '#8b5cf6' },
  { id: 'scifi', cn: '科幻未来', en: 'Sci-Fi', icon: 'bolt', color: '#0ea5e9' },
  { id: 'product', cn: '产品商业', en: 'Product', icon: 'grid', color: '#f59e0b' },
  { id: 'abstract', cn: '抽象艺术', en: 'Abstract', icon: 'layers', color: '#f43f5e' },
  { id: 'guofeng', cn: '国风水墨', en: 'Guofeng', icon: 'image', color: '#84cc16' },
  { id: 'cyber', cn: '赛博朋克', en: 'Cyberpunk', icon: 'video', color: '#a855f7' },
];

function makePrompts(seed) {
  const prompts_cn = [
    { t: '霓虹赛博女孩', d: '赛博朋克风格的女孩，霓虹灯光，未来都市，电影感，8K 细节', m: 'GPT Image 2', s: seed + 0 },
    { t: '水墨山水画', d: '中国传统水墨山水，云雾缭绕，远山如黛，诗意意境', m: 'Nano Banana 2', s: seed + 20 },
    { t: '极简产品摄影', d: '奢侈品手表，白色极简背景，柔光打影，专业商业摄影', m: 'Imagen 4.0', s: seed + 40 },
    { t: '森林小精灵', d: '宫崎骏风格，森林精灵，斑驳光影，发光蘑菇，水彩质感', m: 'Midjourney V7', s: seed + 60 },
    { t: '太空宇航员', d: '宇航员漂浮于宇宙中，地球在背景，超写实渲染，细节丰富', m: 'Flux.1 Pro', s: seed + 80 },
    { t: '古风仙女', d: '汉服飘飘，桃花林，月光如水，工笔画风格，精细细节', m: 'GPT Image 2', s: seed + 100 },
    { t: '液态金属艺术', d: '液态金属形态，工作室打光，反光质感，3D 渲染，超写实', m: 'Nano Banana 2', s: seed + 120 },
    { t: '废土风景', d: '末世废土城市，破败建筑，橙色天空，电影感光比，写实风格', m: 'SDXL Lightning', s: seed + 140 },
    { t: '胶片人像', d: '复古胶片质感，逆光，女孩侧脸，自然散景，VSCO 色调', m: 'Midjourney V7', s: seed + 160 },
    { t: '冰晶世界', d: '冰雪王国，冰晶宫殿，极光天空，冰蓝色调，奇幻风格', m: 'Flux.1 Pro', s: seed + 180 },
    { t: '猫咪咖啡厅', d: '温馨下午茶，慵懒猫咪，阳光透窗，日式治愈风格，柔和色调', m: 'GPT Image 2', s: seed + 200 },
    { t: '蒸汽朋克机械', d: '维多利亚时代蒸汽朋克，齿轮机械，铜黄色调，精细细节', m: 'Imagen 4.0', s: seed + 220 },
  ];
  const prompts_en = [
    { t: 'Neon Cyber Girl', d: 'Cyberpunk girl, neon lights, futuristic city, cinematic, 8K detail', m: 'GPT Image 2', s: seed + 0 },
    { t: 'Ink Landscape', d: 'Traditional Chinese ink painting, misty mountains, poetic mood', m: 'Nano Banana 2', s: seed + 20 },
    { t: 'Minimal Product', d: 'Luxury watch, white minimal background, soft studio light, commercial', m: 'Imagen 4.0', s: seed + 40 },
    { t: 'Forest Sprite', d: 'Ghibli-style forest sprite, dappled light, glowing mushrooms, watercolor', m: 'Midjourney V7', s: seed + 60 },
    { t: 'Space Astronaut', d: 'Astronaut floating in space, Earth backdrop, hyper-real render', m: 'Flux.1 Pro', s: seed + 80 },
    { t: 'Ancient Fairy', d: 'Hanfu flowing, peach forest, moonlit gongbi painting style', m: 'GPT Image 2', s: seed + 100 },
    { t: 'Liquid Metal', d: 'Liquid metal morphing, studio light, reflective surface, 3D', m: 'Nano Banana 2', s: seed + 120 },
    { t: 'Post-Apocalypse', d: 'End-world city, ruined buildings, orange sky, cinematic lighting', m: 'SDXL Lightning', s: seed + 140 },
    { t: 'Film Portrait', d: 'Vintage film grain, backlit, girl profile, natural bokeh, VSCO', m: 'Midjourney V7', s: seed + 160 },
    { t: 'Crystal World', d: 'Ice crystal palace, aurora sky, ice-blue palette, fantasy', m: 'Flux.1 Pro', s: seed + 180 },
    { t: 'Cat Café', d: 'Cozy afternoon, lazy cats, sunlight, Japanese healing style', m: 'GPT Image 2', s: seed + 200 },
    { t: 'Steampunk Mech', d: 'Victorian steampunk, brass gears, copper tones, intricate detail', m: 'Imagen 4.0', s: seed + 220 },
  ];
  return { cn: prompts_cn, en: prompts_en };
}

const ALL_PROMPTS = makePrompts(7);

function PromptCard({ p, lang, onCreate }) {
  return ins('div', { onClick: onCreate,
    style: { display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius)', overflow: 'hidden',
      background: 'var(--panel-solid)', border: '1px solid var(--border)', cursor: 'pointer',
      transition: 'transform .22s var(--ease), box-shadow .22s var(--ease)', boxShadow: 'var(--shadow-card)' },
    onMouseEnter: e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--shadow-pop)'; },
    onMouseLeave: e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-card)'; } },
    // image
    ins('div', { style: { position: 'relative', aspectRatio: '4/3', background: mesh(p.s, p.s + 80, p.s + 200) } },
      ins('div', { style: { position: 'absolute', top: 8, right: 8, display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 5, background: 'rgba(0,0,0,.48)', backdropFilter: 'blur(6px)', fontSize: 10.5, fontWeight: 600, color: '#fff' } }, p.m)),
    // body
    ins('div', { style: { padding: '11px 13px 12px' } },
      ins('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.t),
      ins('div', { style: { fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, p.d),
      ins('div', { style: { marginTop: 10, display: 'flex', gap: 7, alignItems: 'center' } },
        ins('button', { onClick: e => { e.stopPropagation(); onCreate(); },
          style: { flex: 1, height: 30, borderRadius: 'var(--radius-sm)', background: 'var(--grad)', color: 'var(--on-accent)', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 } },
          ins(Icon, { name: 'sparkle', size: 13 }), lang === 'cn' ? '生成同款' : 'Remix'),
        ins('button', { onClick: e => e.stopPropagation(),
          style: { width: 30, height: 30, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)' } },
          ins(Icon, { name: 'copy', size: 14 })))));
}

function InspirationPage({ lang, onCreate }) {
  const [tab, setTab] = insS(0);
  const [topic, setTopic] = insS(null);
  const tabs = INS_TABS[lang] || INS_TABS.cn;
  const prompts = (ALL_PROMPTS[lang] || ALL_PROMPTS.cn);

  return ins('div', { style: { maxWidth: 1280, margin: '0 auto', padding: '36px 22px 80px' } },
    // header
    ins('div', { style: { marginBottom: 24 } },
      ins('h1', { className: 'font-display', style: { fontSize: 'clamp(28px, 3.2vw, 38px)', fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.02em' } }, 'Inspiration'),
      ins('p', { style: { fontSize: 14.5, color: 'var(--text-dim)', margin: 0 } }, lang === 'cn' ? 'AI 提示词库 · 一键生成同款作品' : 'AI prompt library · one-click remix')),

    // tabs
    ins('div', { style: { display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--radius-sm)', background: 'var(--panel)', border: '1px solid var(--border)', marginBottom: 24 } },
      tabs.map((t, i) => ins('button', { key: i, onClick: () => setTab(i),
        style: { height: 34, padding: '0 18px', borderRadius: 'calc(var(--radius-sm) - 3px)', fontSize: 14, fontWeight: 600,
          color: tab === i ? 'var(--on-accent)' : 'var(--text-dim)',
          background: tab === i ? 'var(--accent)' : 'transparent', transition: 'all .16s' } }, t))),

    // ── tab 0: 灵感 (prompts waterfall) ────────────────────────────
    tab === 0 && ins('div', { style: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } },
      prompts.map((p, i) => ins(PromptCard, { key: i, p, lang, onCreate }))),

    // ── tab 1: 主题 ─────────────────────────────────────────────────
    tab === 1 && ins('div', null,
      ins('div', { style: { display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: 32 } },
        TOPICS.map(t => ins('div', { key: t.id, onClick: () => { setTopic(topic === t.id ? null : t.id); },
          style: { position: 'relative', aspectRatio: '3/2', borderRadius: 'var(--radius)', overflow: 'hidden', cursor: 'pointer',
            border: `2px solid ${topic === t.id ? 'var(--accent)' : 'transparent'}`, transition: 'all .2s' } },
          ins('div', { style: { position: 'absolute', inset: 0, background: mesh(parseInt(t.color.slice(1), 16) % 360, (parseInt(t.color.slice(1), 16) + 90) % 360, (parseInt(t.color.slice(1), 16) + 200) % 360) } }),
          ins('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.7) 0%, transparent 60%)' } }),
          ins('div', { style: { position: 'absolute', bottom: 12, left: 14, color: '#fff' } },
            ins('div', { style: { width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', background: t.color + '40', backdropFilter: 'blur(6px)', marginBottom: 6 } },
              ins(Icon, { name: t.icon, size: 16 })),
            ins('div', { style: { fontSize: 15, fontWeight: 700, textShadow: '0 1px 6px rgba(0,0,0,.5)' } }, lang === 'cn' ? t.cn : t.en))))),
      topic && ins('div', { style: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' } },
        prompts.slice(0, 6).map((p, i) => ins(PromptCard, { key: i, p, lang, onCreate })))),

    // ── tab 2: 提示词 ────────────────────────────────────────────────
    tab === 2 && ins('div', null,
      ins('div', { style: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' } },
        prompts.map((p, i) => ins('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--panel-solid)', border: '1px solid var(--border)', flex: '1 1 340px' } },
          ins('div', { style: { width: 40, height: 40, borderRadius: 'var(--radius-sm)', background: mesh(p.s, p.s + 80, p.s + 200), flex: 'none' } }),
          ins('div', { style: { flex: 1, minWidth: 0 } },
            ins('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, p.t),
            ins('div', { className: 'mono', style: { fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, p.d),
            ins('div', { style: { marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' } },
              ins('span', { className: 'tag', style: { fontSize: 11 } }, p.m),
              ins('button', { onClick: () => onCreate(), style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', borderRadius: 20, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12, fontWeight: 600 } },
                ins(Icon, { name: 'sparkle', size: 12 }), lang === 'cn' ? '使用' : 'Use'))))))),
  );
}

window.InspirationPage = InspirationPage;
