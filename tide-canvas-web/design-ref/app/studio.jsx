/* global React, Icon, Logo, Avatar, mesh, fmt, ARTWORKS */
// SCARECROWAI — Unified Studio (image + video) — 3-column layout matching imini
const { createElement: s, useState: sS, useMemo: sM, useRef: sR, useEffect: sE } = React;

// ── data ──────────────────────────────────────────────────────────────────
const IMG_MODELS = [
  { id: 'gpt2', name: 'GPT Image 2', tag: 'GP', seed: 12 },
  { id: 'nano2', name: 'Nano Banana 2', tag: 'NB', seed: 55 },
  { id: 'flux1pro', name: 'Flux.1 Pro', tag: 'FX', seed: 88 },
  { id: 'mj7', name: 'Midjourney V7', tag: 'MJ', seed: 140 },
  { id: 'imagen4', name: 'Imagen 4.0', tag: 'IM', seed: 176 },
  { id: 'ideogram', name: 'Ideogram 2.1', tag: 'ID', seed: 210 },
];
const VID_MODELS = [
  { id: 'seedance2', name: 'Seedance 2.0', tag: 'SD', seed: 44 },
  { id: 'kling3', name: 'Kling 3.0', tag: 'KL', seed: 88 },
  { id: 'sora2', name: 'Sora 2', tag: 'S2', seed: 130 },
  { id: 'veo31', name: 'Google Veo 3.1', tag: 'VE', seed: 170 },
  { id: 'wan27', name: 'Wan 2.7', tag: 'WN', seed: 210 },
  { id: 'hailuo', name: 'Hailuo 2.3', tag: 'HL', seed: 250 },
];

const AI_TOOLS = {
  cn: [
    { name: '智能扩图', desc: '一键延伸画面边界', seed: 31 },
    { name: '移除物体', desc: '精准擦除不想要的元素', seed: 72 },
    { name: '移除背景', desc: '抠图秒级完成', seed: 113 },
    { name: '高清放大', desc: '最高 4× 无损放大', seed: 154 },
  ],
  en: [
    { name: 'Smart Expand', desc: 'Extend image borders intelligently', seed: 31 },
    { name: 'Object Remove', desc: 'Erase unwanted elements', seed: 72 },
    { name: 'BG Remove', desc: 'Instant background removal', seed: 113 },
    { name: 'HD Upscale', desc: 'Up to 4× lossless upscaling', seed: 154 },
  ],
};

const INSPIRE_TAGS = {
  cn: ['全部', '人像写真', '动漫插画', '产品电商', '科幻未来', '国风水墨', '风景自然', '赛博朋克', '3D 渲染'],
  en: ['All', 'Portrait', 'Anime', 'Product', 'Sci-Fi', 'Guofeng', 'Landscape', 'Cyberpunk', '3D Render'],
};

const IMG_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16'];
const VID_RATIOS = ['16:9', '9:16', '1:1', '4:3'];
const VID_DURATIONS = ['4s', '8s', '16s'];
const VID_QUALITY = ['720P', '1080P', '4K'];

const HOT_SEEDS = [8, 44, 80, 128, 200, 260, 20, 160, 100, 240];
const INSPIRE_TILES = [
  { s: 12, h: 1.35 }, { s: 55, h: 0.78 }, { s: 88, h: 1.05 }, { s: 140, h: 1.55 }, { s: 176, h: 0.88 },
  { s: 210, h: 1.25 }, { s: 244, h: 0.72 }, { s: 30, h: 1.42 }, { s: 66, h: 0.95 }, { s: 100, h: 1.18 },
  { s: 134, h: 0.82 }, { s: 168, h: 1.38 }, { s: 200, h: 0.7 }, { s: 234, h: 1.1 }, { s: 18, h: 1.45 },
  { s: 52, h: 0.9 }, { s: 86, h: 1.22 }, { s: 120, h: 0.75 }, { s: 156, h: 1.32 }, { s: 190, h: 1.0 },
];

const HOT_TITLES_CN = ['梵高风格', '拍立得风格', '老照片修复', '可爱的毛绒玩具', '新潮阴影人像', '经典商务肖像', '产品悬浮展示', '工业设计渲染', '肖像贴纸', '宠物试穿广告'];
const HOT_TITLES_EN = ['Van Gogh', 'Polaroid', 'Photo Restore', 'Plush Toy', 'Shadow Portrait', 'Corporate Shot', 'Product Float', 'Industrial', 'Portrait Sticker', 'Pet Ad'];

function modelGrad(seed) {
  return `linear-gradient(135deg, hsl(${seed % 360} 82% 56%), hsl(${(seed + 55) % 360} 80% 48%))`;
}

// ── sub-components ────────────────────────────────────────────────────────
function MTag({ label }) {
  return s('span', {
    style: { fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: 'var(--accent-soft)', color: 'var(--accent)', letterSpacing: '.04em' }
  }, label);
}

function ModelPill({ mod, active, onClick }) {
  return s('button', { onClick, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 9px', borderRadius: 8, textAlign: 'left', width: '100%', transition: 'background .14s', background: active ? 'rgba(255,255,255,.07)' : 'transparent' } },
    s('div', { style: { width: 28, height: 28, borderRadius: 6, background: modelGrad(mod.seed), display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 800, color: '#fff', flex: 'none', letterSpacing: '-0.02em' } }, mod.tag),
    s('span', { style: { fontSize: 13.5, fontWeight: active ? 600 : 500, color: active ? 'var(--text)' : 'var(--text-dim)', flex: 1 } }, mod.name),
    s(Icon, { name: 'chevron', size: 14, style: { color: 'var(--text-faint)', flex: 'none' } }),
  );
}

// icon rail nav item
// ── Icon rail — with native tooltips ─────────────────────────────────────
function RailBtn({ icon, label, active, onClick }) {
  return s('button', { onClick, title: label,
    style: { width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', cursor: 'pointer',
      color: active ? 'var(--accent)' : 'var(--text-faint)', transition: 'color .14s, background .14s',
      background: active ? 'rgba(124,92,255,.12)' : 'transparent', borderRadius: 6, position: 'relative' },
  },
    active && s('span', { style: { position: 'absolute', left: 0, top: '22%', bottom: '22%', width: 3, borderRadius: '0 3px 3px 0', background: 'var(--accent)' } }),
    s(Icon, { name: icon, size: 18, stroke: active ? 2 : 1.5 }),
    s('span', { style: { fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: '-0.01em' } }, label),
  );
}

// ── Left params panel ────────────────────────────────────────────────────
function ParamsPanel({ lang, mediaType, setMediaType, vidMode, setVidMode, imgMode, setImgMode, model, setModel, prompt, setPrompt, ratio, setRatio, duration, setDuration, quality, setQuality, sound, setSound, phase, onGenerate }) {
  const isVideo = mediaType === 'video';
  const models = isVideo ? VID_MODELS : IMG_MODELS;
  const selMod = models.find(m => m.id === model) || models[0];
  const [modelOpen, setModelOpen] = sS(false);
  const [negPrompt, setNegPrompt] = sS('');
  const [negOpen, setNegOpen] = sS(false);
  const [advOpen, setAdvOpen] = sS(false);
  const [seed, setSeed] = sS('');
  const [count, setCount] = sS(2);
  const [stylePreset, setStylePreset] = sS('');
  const vidModes_cn = ['文本转视频', '图片转视频', '角色替换'];
  const vidModes_en = ['Text→Video', 'Image→Video', 'Role Swap'];
  const imgModes_cn = ['文本生图', '图片生图', '局部重绘'];
  const imgModes_en = ['Text→Image', 'Image→Image', 'Inpaint'];
  const subModes = isVideo ? (lang === 'cn' ? vidModes_cn : vidModes_en) : (lang === 'cn' ? imgModes_cn : imgModes_en);
  const curMode = isVideo ? vidMode : imgMode;
  const setCurMode = isVideo ? setVidMode : setImgMode;
  const costBase = isVideo ? { seedance2: 80, kling3: 100, sora2: 120, veo31: 110, wan27: 60, hailuo: 70 }[model] || 80 : { gpt2: 12, nano2: 8, flux1pro: 10, mj7: 14, imagen4: 11, ideogram: 9 }[model] || 10;
  const durMul = { '4s': 1, '8s': 2, '16s': 3 }[duration] || 1;
  const cost = isVideo ? costBase * durMul : costBase * count;
  const chips_cn = isVideo
    ? [
        { label: '赛博跑车', prompt: '赛博朋克都市深夜，超跑疾驰，霓虹倒影在湿润路面，慢动作，电影感，4K' },
        { label: '深海世界', prompt: '深海发光生物群落，蓝紫光晕，超写实，水下摄影，安静神秘，慢镜头' },
        { label: '火山喷发', prompt: '活火山剧烈喷发，熔岩冲天，火星四溅，大气磅礴，航拍视角，4K 慢动作' },
      ]
    : [
        { label: '霓虹女孩', prompt: '赛博朋克女孩，霓虹灯光映在脸上，雨中街道，浅景深，电影感，8K 超写实' },
        { label: '水墨山水', prompt: '中国传统工笔青绿山水，矿物质颜料，石青石绿设色，金线勾勒，云雾缭绕，宋代院体画风' },
        { label: '极简产品', prompt: '高端香水瓶悬浮于纯白背景，柔和阴影，产品摄影，商业级打光，超清细节' },
      ];
  const chips_en = isVideo
    ? [
        { label: 'Cyber car', prompt: 'Supercar racing through neon-drenched cyberpunk city at night, rain reflections, slow motion, cinematic, 4K' },
        { label: 'Deep ocean', prompt: 'Bioluminescent deep sea creatures drifting in darkness, blue-violet glow, hyperreal underwater macro, slow motion' },
        { label: 'Volcano', prompt: 'Active volcano erupting violently, lava fountains, embers raining, aerial drone shot, cinematic 4K slow motion' },
      ]
    : [
        { label: 'Cyber girl', prompt: 'Cyberpunk girl, neon light painting her face, wet street reflections, shallow depth of field, cinematic, 8K ultra-realistic' },
        { label: 'Ink landscape', prompt: 'Chinese gongbi landscape, mineral azurite pigments, gold outline, misty mountains, Song dynasty academy style' },
        { label: 'Minimal product', prompt: 'Luxury perfume bottle floating on pure white, soft diffused shadows, commercial product photography, ultra detail' },
      ];
  const chips = lang === 'cn' ? chips_cn : chips_en;
  const STYLES_CN = ['写实', '动漫', '电影感', '水彩', '3D', '素描'];
  const STYLES_EN = ['Realism', 'Anime', 'Cinematic', 'Watercolor', '3D', 'Sketch'];
  const STYLE_LIST = lang === 'cn' ? STYLES_CN : STYLES_EN;
  const phPh = isVideo
    ? (lang === 'cn' ? '输入文本并描述想要生成的内容' : 'Describe the video you want to create…')
    : (lang === 'cn' ? '描述你想要生成的图片，越详细越好…' : 'Describe the image you want — the more detail the better…');
  function LLabel({ txt }) { return s('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2 } }, txt); }
  function OptBtn({ val, cur, onClick, children }) { return s('button', { onClick, style: { height: 28, padding: '0 11px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, flex: 1, transition: 'all .14s', background: cur === val ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)', color: cur === val ? 'var(--text)' : 'var(--text-faint)', border: `1px solid ${cur === val ? 'rgba(255,255,255,.18)' : 'transparent'}` } }, children); }

  return s('div', { style: { width: 256, flex: 'none', background: '#0d0d10', borderRight: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 } },

    // ── main tab: 图片生成 | 视频创作
    s('div', { style: { padding: '12px 14px 0', borderBottom: '1px solid rgba(255,255,255,.07)', flexShrink: 0 } },
      s('div', { style: { display: 'flex', gap: 0, marginBottom: 8 } },
        [['image', lang === 'cn' ? '图片生成' : 'Image'], ['video', lang === 'cn' ? '视频创作' : 'Video']].map(([v, label]) =>
          s('button', { key: v, onClick: () => { setMediaType(v); setImgMode(0); setVidMode(0); setModel(v === 'video' ? VID_MODELS[0].id : IMG_MODELS[0].id); setRatio(v === 'video' ? '16:9' : '1:1'); setModelOpen(false); },
            style: { flex: 1, height: 30, fontSize: 13, fontWeight: mediaType === v ? 700 : 500,
              color: mediaType === v ? 'var(--text)' : 'var(--text-faint)',
              borderBottom: `2px solid ${mediaType === v ? 'var(--accent)' : 'transparent'}`, transition: 'all .15s', whiteSpace: 'nowrap' } }, label))),
      s('div', { style: { display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 8, paddingBottom: 2 } },
        subModes.map((m, i) => s('button', { key: i, onClick: () => setCurMode(i),
          style: { whiteSpace: 'nowrap', padding: '0 9px', height: 24, fontSize: 11.5, fontWeight: curMode === i ? 600 : 400,
            color: curMode === i ? 'var(--text)' : 'var(--text-faint)', borderRadius: 5,
            background: curMode === i ? 'rgba(255,255,255,.10)' : 'transparent', flex: 'none', transition: 'all .14s' } }, m)))),

    // ── scrollable body
    s('div', { className: 'scroll', style: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 12px 0', minWidth: 0 } },

      // model selector
      s('div', { style: { marginBottom: 10 } },
        s(LLabel, { txt: lang === 'cn' ? '模型' : 'Model' }),
        s('div', { style: { borderRadius: 8, background: 'rgba(255,255,255,.05)', border: `1px solid ${modelOpen ? 'var(--accent)' : 'rgba(255,255,255,.08)'}`, overflow: 'hidden', transition: 'border-color .15s' } },
          s('button', { onClick: () => setModelOpen(o => !o), style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', width: '100%', textAlign: 'left' } },
            s('div', { style: { width: 28, height: 28, borderRadius: 6, background: modelGrad(selMod.seed), display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 800, color: '#fff', flex: 'none' } }, selMod.tag),
            s('div', { style: { flex: 1, minWidth: 0 } },
              s('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selMod.name),
              s('div', { style: { fontSize: 10.5, color: 'var(--text-faint)', marginTop: 1 } }, isVideo ? (lang === 'cn' ? '视频生成' : 'Video gen') : (lang === 'cn' ? '图片生成' : 'Image gen'))),
            s(Icon, { name: modelOpen ? 'chevronDown' : 'chevron', size: 14, style: { color: 'var(--text-faint)', flex: 'none', transform: modelOpen ? 'none' : 'rotate(90deg)' } })),
          modelOpen && s('div', { style: { borderTop: '1px solid rgba(255,255,255,.07)', maxHeight: 220, overflowY: 'auto' } },
            models.filter(m => m.id !== selMod.id).map(m =>
              s('button', { key: m.id, onClick: () => { setModel(m.id); setModelOpen(false); },
                style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', width: '100%', textAlign: 'left', transition: 'background .12s' },
                onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,.06)',
                onMouseLeave: e => e.currentTarget.style.background = '' },
                s('div', { style: { width: 24, height: 24, borderRadius: 5, background: modelGrad(m.seed), display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800, color: '#fff', flex: 'none' } }, m.tag),
                s('span', { style: { fontSize: 12.5, color: 'var(--text-dim)' } }, m.name)))))),

      // image/video upload for i2i/i2v modes
      curMode === 1 && s('div', { onClick: () => {}, style: { aspectRatio: '16/9', borderRadius: 8, border: '1.5px dashed rgba(255,255,255,.15)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 12.5, gap: 5, textAlign: 'center', marginBottom: 10, cursor: 'pointer', transition: 'border-color .15s' },
        onMouseEnter: e => e.currentTarget.style.borderColor = 'var(--accent)',
        onMouseLeave: e => e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)' },
        s(Icon, { name: isVideo ? 'video' : 'image', size: 22 }),
        s('div', null, lang === 'cn' ? '点击或拖入参考图' : 'Click or drop a reference'),
        s('div', { style: { fontSize: 10.5, opacity: .7 } }, 'PNG, JPG, WebP')),

      // prompt
      s('div', { style: { marginBottom: 6 } },
        s('div', { style: { position: 'relative' } },
          s('textarea', { value: prompt, onChange: e => setPrompt(e.target.value), placeholder: phPh, rows: 5,
            style: { width: '100%', resize: 'none', padding: '10px 11px 30px', borderRadius: 8, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)',
              color: 'var(--text)', fontSize: 13, lineHeight: 1.55, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s' },
            onFocus: e => e.target.style.borderColor = 'rgba(124,92,255,.5)',
            onBlur: e => e.target.style.borderColor = 'rgba(255,255,255,.08)' }),
          s('div', { style: { position: 'absolute', bottom: 6, left: 9, right: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            s('button', { style: { height: 20, padding: '0 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, background: 'rgba(255,255,255,.08)', color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' } },
              s(Icon, { name: 'sparkle', size: 10 }), lang === 'cn' ? 'AI 优化' : 'AI'),
            s('span', { style: { fontSize: 10, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 } }, `${prompt.length}/6000`)))),

      // prompt chips
      s('div', { style: { display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' } },
        chips.map((chip, i) => s('button', { key: i, onClick: () => setPrompt(chip.prompt),
          style: { height: 23, padding: '0 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
            background: 'rgba(255,255,255,.06)', color: 'var(--text-faint)', border: '1px solid rgba(255,255,255,.09)', transition: 'all .13s' },
          onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,.12)'; e.currentTarget.style.color = 'var(--text)'; },
          onMouseLeave: e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'var(--text-faint)'; } }, chip.label))),

      // negative prompt collapsible
      s('div', { style: { marginBottom: 10 } },
        s('button', { onClick: () => setNegOpen(o => !o),
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)' } },
          s('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            s(Icon, { name: 'filter', size: 13 }), lang === 'cn' ? '反向提示词' : 'Negative prompt'),
          s(Icon, { name: 'chevronDown', size: 13, style: { transform: negOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' } })),
        negOpen && s('textarea', { value: negPrompt, onChange: e => setNegPrompt(e.target.value), rows: 3,
          placeholder: lang === 'cn' ? '不想要的元素，如：近看，模糊，山寨的...' : 'E.g. blurry, ugly, low quality...',
          style: { width: '100%', resize: 'none', marginTop: 7, padding: '8px 10px', borderRadius: 7, background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.08)', color: 'var(--text)', fontSize: 12, lineHeight: 1.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' } })),

      // style presets (image only)
      !isVideo && s('div', { style: { marginBottom: 10 } },
        s(LLabel, { txt: lang === 'cn' ? '风格' : 'Style' }),
        s('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
          STYLE_LIST.map((st, i) => s('button', { key: i, onClick: () => setStylePreset(stylePreset === st ? '' : st),
            style: { height: 26, padding: '0 10px', borderRadius: 20, fontSize: 11.5, fontWeight: stylePreset === st ? 700 : 500, whiteSpace: 'nowrap',
              background: stylePreset === st ? 'var(--accent)' : 'rgba(255,255,255,.06)',
              color: stylePreset === st ? '#fff' : 'var(--text-faint)', border: `1px solid ${stylePreset === st ? 'transparent' : 'rgba(255,255,255,.09)'}`, transition: 'all .13s' } }, st)))),

      // ratio — compact pills, no overflow
      s('div', { style: { marginBottom: 10 } },
        s(LLabel, { txt: lang === 'cn' ? '画面比例' : 'Ratio' }),
        s('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          (isVideo ? VID_RATIOS : IMG_RATIOS).map(r => s('button', { key: r, onClick: () => setRatio(r),
            style: { height: 26, padding: '0 9px', borderRadius: 6, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', transition: 'all .14s',
              background: ratio === r ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)',
              color: ratio === r ? 'var(--text)' : 'var(--text-faint)', border: `1px solid ${ratio === r ? 'rgba(255,255,255,.18)' : 'transparent'}` } }, r)))),

      // video: duration + quality
      isVideo && s('div', { style: { display: 'flex', gap: 8, marginBottom: 10 } },
        s('div', { style: { flex: 1 } },
          s(LLabel, { txt: lang === 'cn' ? '时长' : 'Duration' }),
          s('div', { style: { display: 'flex', gap: 4 } },
            VID_DURATIONS.map(d => s(OptBtn, { key: d, val: d, cur: duration, onClick: () => setDuration(d) }, d)))),
        s('div', { style: { flex: 1 } },
          s(LLabel, { txt: lang === 'cn' ? '画质' : 'Quality' }),
          s('div', { style: { display: 'flex', gap: 4 } },
            VID_QUALITY.map(q => s(OptBtn, { key: q, val: q, cur: quality, onClick: () => setQuality(q) }, q))))),

      // video: sound
      isVideo && s('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
        s('span', { style: { fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 500 } }, lang === 'cn' ? '音频' : 'Sound'),
        s('button', { onClick: () => setSound(v => !v),
          style: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: sound ? 'rgba(124,92,255,.25)' : 'rgba(255,255,255,.06)', color: sound ? 'var(--accent)' : 'var(--text-faint)', border: `1px solid ${sound ? 'rgba(124,92,255,.4)' : 'rgba(255,255,255,.09)'}`, transition: 'all .15s' } },
          s('span', { style: { width: 7, height: 7, borderRadius: '50%', background: sound ? 'var(--accent)' : 'rgba(255,255,255,.3)', transition: 'background .15s' } }),
          lang === 'cn' ? (sound ? '已开启' : '已关闭') : (sound ? 'On' : 'Off'))),

      // image: count
      !isVideo && s('div', { style: { marginBottom: 10 } },
        s(LLabel, { txt: lang === 'cn' ? '生成数量' : 'Count' }),
        s('div', { style: { display: 'flex', gap: 5 } },
          [1, 2, 4].map(n => s('button', { key: n, onClick: () => setCount(n),
            style: { height: 28, flex: 1, borderRadius: 6, fontSize: 13, fontWeight: 600, transition: 'all .14s',
              background: count === n ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)',
              color: count === n ? 'var(--text)' : 'var(--text-faint)', border: `1px solid ${count === n ? 'rgba(255,255,255,.18)' : 'transparent'}` } }, '×' + n)))),

      // advanced settings collapsible
      s('div', { style: { marginBottom: 10 } },
        s('button', { onClick: () => setAdvOpen(o => !o),
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)' } },
          s('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            s(Icon, { name: 'layers', size: 13 }), lang === 'cn' ? '高级设置' : 'Advanced'),
          s(Icon, { name: 'chevronDown', size: 13, style: { transform: advOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' } })),
        advOpen && s('div', { style: { paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 9 } },
          s('div', null,
            s('div', { style: { fontSize: 10.5, color: 'var(--text-faint)', fontWeight: 600, marginBottom: 5 } }, lang === 'cn' ? '随机种子' : 'Seed'),
            s('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              s('input', { type: 'number', value: seed, onChange: e => setSeed(e.target.value), placeholder: lang === 'cn' ? '随机' : 'Random',
                style: { flex: 1, height: 30, padding: '0 9px', borderRadius: 6, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', fontVariantNumeric: 'tabular-nums' } }),
              s('button', { onClick: () => setSeed(String(Math.floor(Math.random() * 9999999))), title: lang === 'cn' ? '随机种子' : 'Random seed',
                style: { width: 30, height: 30, borderRadius: 6, background: 'rgba(255,255,255,.06)', color: 'var(--text-faint)', display: 'grid', placeItems: 'center' } },
                s(Icon, { name: 'sparkle', size: 14 })))))),

      s('div', { style: { height: 14 } }),
    ),

    // ── generate button
    s('div', { style: { padding: '10px 12px 14px', borderTop: '1px solid rgba(255,255,255,.07)', flexShrink: 0 } },
      s('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11.5, color: 'var(--text-faint)' } },
        s('span', null, lang === 'cn' ? '预计消耗' : 'Est. cost'),
        s('span', { style: { color: 'var(--accent)', fontWeight: 700, fontSize: 13 } }, `+${cost} `, lang === 'cn' ? '积分' : 'credits')),
      s('button', { onClick: onGenerate, disabled: phase === 'gen',
        style: { width: '100%', height: 44, borderRadius: 8, fontWeight: 800, fontSize: 15, background: phase === 'gen' ? 'rgba(255,255,255,.08)' : 'var(--grad)', color: phase === 'gen' ? 'var(--text-faint)' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, transition: 'all .18s' } },
        phase === 'gen'
          ? s('div', { style: { width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,.2)', borderTopColor: 'rgba(255,255,255,.7)', animation: 'spin .8s linear infinite' } })
          : s(Icon, { name: isVideo ? 'video' : 'sparkle', size: 16 }),
        phase === 'gen' ? (lang === 'cn' ? '生成中…' : 'Generating…') : (lang === 'cn' ? '开始生成' : 'Generate')),
    ),
  );
}

// ── Right content area ───────────────────────────────────────────────────
function MainArea({ lang, mediaType, phase, result, ratio, onDiscover, isVideo, quality, duration, rightTab, setRightTab }) {
  const [insTag, setInsTag] = sS(0);
  const [history, setHistory] = sS([]); // {c, ratio, ts}
  const tools = (AI_TOOLS[lang] || AI_TOOLS.cn);
  const tags = (INSPIRE_TAGS[lang] || INSPIRE_TAGS.cn);
  const hotTitles = lang === 'cn' ? HOT_TITLES_CN : HOT_TITLES_EN;

  // track generation history
  sE(() => {
    if (phase === 'done' && result) {
      setHistory(h => [{ c: result.c, ratio, ts: Date.now() }, ...h].slice(0, 12));
    }
  }, [phase, result]);

  return s('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#111115', overflow: 'hidden' } },

      // ── internal top bar
    s('div', { style: { height: 48, borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', padding: '0 18px', flexShrink: 0, gap: 14 } },
      s('div', { style: { display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.07)' } },
        [['discover', lang === 'cn' ? '发现' : 'Discover'], ['create', lang === 'cn' ? '创建' : 'Create']].map(([v, label]) =>
          s('button', { key: v, onClick: () => setRightTab(v),
            style: { height: 30, padding: '0 16px', borderRadius: 6, fontSize: 13.5, fontWeight: rightTab === v ? 600 : 500,
              color: rightTab === v ? 'var(--text)' : 'var(--text-faint)', background: rightTab === v ? 'rgba(255,255,255,.1)' : 'transparent', transition: 'all .15s',
              position: 'relative' } },
            label,
            v === 'create' && phase === 'done' ? s('span', { style: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' } }) : null))),
      phase === 'done' && result && rightTab === 'create' && s('div', { style: { display: 'flex', gap: 8, marginLeft: 'auto' } },
        s('button', { className: 'btn btn-ghost', style: { height: 32, padding: '0 12px', fontSize: 13, gap: 6 } }, s(Icon, { name: 'download', size: 14 }), lang === 'cn' ? '下载' : 'Download'),
        s('button', { className: 'btn btn-ghost', style: { height: 32, padding: '0 12px', fontSize: 13, gap: 6 } }, s(Icon, { name: 'heart', size: 14 }), lang === 'cn' ? '收藏' : 'Save'),
      ),
    ),

    // ── DISCOVER tab ────────────────────────────────────────────────
    rightTab === 'discover' && s('div', { className: 'scroll', style: { flex: 1, overflowY: 'auto', padding: '20px 20px 40px' } },

      // AI 工具
      s('div', { style: { marginBottom: 26 } },
        s('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 } },
          s('div', { style: { width: 3, height: 16, borderRadius: 2, background: 'var(--grad)', flexShrink: 0 } }),
          s('h3', { style: { fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text)' } }, lang === 'cn' ? 'AI 工具' : 'AI Tools')),
        s('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 } },
          tools.map((t, i) => s('div', { key: i, style: { position: 'relative', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', aspectRatio: '16/7', background: mesh(t.seed, t.seed + 90, t.seed + 200), border: '1px solid rgba(255,255,255,.08)', transition: 'transform .2s, box-shadow .2s' },
            onMouseEnter: e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.4)'; },
            onMouseLeave: e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; } },
            s('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.72) 0%, transparent 55%)' } }),
            s('div', { style: { position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center' } },
              s(Icon, { name: ['layers', 'filter', 'image', 'sparkle'][i], size: 14, style: { color: '#fff' } })),
            s('div', { style: { position: 'absolute', left: 10, bottom: 8 } },
              s('div', { style: { fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.5)' } }, t.name),
              s('div', { style: { fontSize: 10.5, color: 'rgba(255,255,255,.65)', marginTop: 2 } }, t.desc)))))),

      // 热门
      s('div', { style: { marginBottom: 26 } },
        s('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
          s('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
            s('div', { style: { width: 3, height: 16, borderRadius: 2, background: 'var(--grad-warm)' } }),
            s('h3', { style: { fontSize: 15, fontWeight: 700, margin: 0 } }, lang === 'cn' ? '热门' : 'Hot')),
          s('button', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--accent)', fontWeight: 600 },
            onMouseEnter: e => e.currentTarget.style.opacity = '.7', onMouseLeave: e => e.currentTarget.style.opacity = '1' },
            lang === 'cn' ? '更多' : 'More', s(Icon, { name: 'chevron', size: 13 }))),
        s('div', { className: 'scroll', style: { display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 4 } },
          HOT_SEEDS.map((seed, i) => s('div', { key: i, style: { flex: 'none', width: 148, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1px solid rgba(255,255,255,.07)', transition: 'transform .2s, box-shadow .2s' },
            onMouseEnter: e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,.5)'; },
            onMouseLeave: e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; } },
            s('div', { style: { position: 'relative', aspectRatio: '4/5', background: mesh(seed, (seed + 90) % 360, (seed + 200) % 360) } },
              s('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.1) 55%, transparent 80%)' } }),
              s('div', { style: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 9px 9px' } },
                s('div', { style: { fontSize: 12.5, fontWeight: 700, color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hotTitles[i] || hotTitles[0]),
                s('div', { style: { fontSize: 10.5, color: 'rgba(255,255,255,.6)', display: 'flex', alignItems: 'center', gap: 4 } },
                  s(Icon, { name: 'heart', size: 10 }), Math.floor(seed * 137 / 10) + 'k'))))))),

      // 灵感
      s('div', null,
        s('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 } },
          s('div', { style: { width: 3, height: 16, borderRadius: 2, background: 'linear-gradient(to bottom, var(--accent-2), var(--accent))' } }),
          s('h3', { style: { fontSize: 15, fontWeight: 700, margin: 0 } }, lang === 'cn' ? '灵感' : 'Inspiration')),
        s('div', { className: 'scroll', style: { display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 14, paddingBottom: 2 } },
          tags.map((t, i) => s('button', { key: i, onClick: () => setInsTag(i),
            style: { whiteSpace: 'nowrap', height: 28, padding: '0 12px', borderRadius: 20, fontSize: 12.5, fontWeight: insTag === i ? 600 : 500,
              background: insTag === i ? 'var(--accent)' : 'rgba(255,255,255,.06)',
              color: insTag === i ? '#fff' : 'var(--text-faint)', border: `1px solid ${insTag === i ? 'transparent' : 'rgba(255,255,255,.08)'}`, transition: 'all .14s' } }, t))),
        s('div', { style: { position: 'relative' } },
          s('div', { style: { columns: '100px auto', columnGap: 8 } },
            INSPIRE_TILES.map((t, i) => s('div', { key: i, style: { breakInside: 'avoid', marginBottom: 8, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative', aspectRatio: `1/${t.h}`, transition: 'transform .2s' },
              onMouseEnter: e => e.currentTarget.style.transform = 'translateY(-2px)',
              onMouseLeave: e => e.currentTarget.style.transform = '' },
              s('div', { style: { position: 'absolute', inset: 0, background: mesh(t.s, (t.s + 80) % 360, (t.s + 200) % 360) } }),
              s('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.45) 0%, transparent 55%)' } })))),
          s('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90, background: 'linear-gradient(to top, #111115 0%, transparent 100%)', pointerEvents: 'none' } })))),

    // ── CREATE tab ───────────────────────────────────────────────────────
    rightTab === 'create' && s('div', { className: 'scroll', style: { flex: 1, overflowY: 'auto', padding: '24px 24px 40px', display: 'flex', flexDirection: 'column', gap: 28 } },
      s('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 280 } },
        phase === 'idle' && s('div', { style: { textAlign: 'center', color: 'var(--text-faint)', maxWidth: 300 } },
          s('div', { style: { width: 72, height: 72, margin: '0 auto 16px', borderRadius: 16, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.05)', color: 'var(--accent)' } },
            s(Icon, { name: isVideo ? 'video' : 'sparkle', size: 30 })),
          s('div', { style: { fontSize: 16, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8 } }, lang === 'cn' ? '输入提示词开始创作' : 'Enter a prompt to start'),
          s('div', { style: { fontSize: 13, lineHeight: 1.6, marginBottom: 14 } }, lang === 'cn' ? '将在这里显示你的作品和生成历史' : 'Your creations and history will appear here'),
          s('button', { onClick: () => setRightTab('discover'), style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: 'rgba(255,255,255,.07)', color: 'var(--text-dim)', border: '1px solid rgba(255,255,255,.09)' } },
            s(Icon, { name: 'sparkle', size: 14 }), lang === 'cn' ? '浏览灵感' : 'Browse inspiration')),

        phase === 'gen' && s('div', { style: { width: '100%', maxWidth: 560 } },
          s('div', { style: { position: 'relative', aspectRatio: ratio.replace(':', '/'), borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,.04)' } },
            s('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%)', backgroundSize: '200% 100%', animation: 'shimmer 1.3s linear infinite' } }),
            s('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 } },
              s('div', { style: { width: 40, height: 40, borderRadius: '50%', border: '3px solid rgba(255,255,255,.1)', borderTopColor: 'var(--accent)', animation: 'spin .9s linear infinite' } }),
              s('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--text-dim)' } }, lang === 'cn' ? (isVideo ? '视频生成中…' : '图片生成中…') : (isVideo ? 'Generating video…' : 'Generating image…')),
              s('div', { style: { fontSize: 12, color: 'var(--text-faint)' } }, lang === 'cn' ? (isVideo ? '预计 1–3 分钟' : '约 10–30 秒') : (isVideo ? 'Est. 1–3 min' : '~10–30 sec'))))),

        phase === 'done' && result && s('div', { style: { width: '100%', maxWidth: 560 } },
          s('div', { style: { position: 'relative', aspectRatio: ratio.replace(':', '/'), borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,.6)' } },
            s('div', { style: { position: 'absolute', inset: 0, background: result.c } }),
            isVideo && s('div', { className: 'play-orb', style: { width: 60, height: 60 } }, s(Icon, { name: 'play', size: 22 }))),
          s('div', { style: { marginTop: 14, display: 'flex', gap: 9, justifyContent: 'center', flexWrap: 'wrap' } },
            s('button', { className: 'btn btn-primary', style: { gap: 7 } }, s(Icon, { name: 'download', size: 15 }), lang === 'cn' ? '下载' : 'Download'),
            s('button', { className: 'btn btn-ghost', style: { gap: 7 } }, s(Icon, { name: 'heart', size: 15 }), lang === 'cn' ? '收藏' : 'Save'),
            s('button', { className: 'btn btn-ghost', style: { gap: 7 } }, s(Icon, { name: 'sparkle', size: 15 }), lang === 'cn' ? '重新生成' : 'Redo'))),
      ),

      history.length > 0 && s('div', null,
        s('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          s('div', { style: { width: 3, height: 14, borderRadius: 2, background: 'var(--grad)' } }),
          s('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--text-dim)' } }, lang === 'cn' ? '生成历史' : 'History'),
          s('span', { style: { fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 2 } }, `(${history.length})`)),
        s('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 } },
          history.map((h, i) => s('div', { key: h.ts, style: { position: 'relative', aspectRatio: h.ratio.replace(':', '/'), borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
            border: i === 0 ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,.08)', transition: 'transform .18s, box-shadow .18s' },
            onMouseEnter: e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.4)'; },
            onMouseLeave: e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; } },
            s('div', { style: { position: 'absolute', inset: 0, background: h.c } }),
            i === 0 && s('div', { style: { position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'var(--accent)', color: '#fff' } }, lang === 'cn' ? '最新' : 'NEW'))))),
    ),
  );
}

// ── Icon rail ────────────────────────────────────────────────────────────
function IconRail({ lang, onNav, page }) {
  const items_cn = [['explore','发现','search'],['studio','生成','image'],['inspire','灵感','sparkle'],['market','助手','bolt'],['pricing','资产','grid']];
  const items_en = [['explore','Find','search'],['studio','Create','image'],['inspire','Inspire','sparkle'],['market','Models','bolt'],['pricing','Assets','grid']];
  const items = lang === 'cn' ? items_cn : items_en;
  return s('div', { style: { width: 44, flex: 'none', background: '#0a0a0d', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 14px', gap: 2 } },
    // mini logo
    s('button', { onClick: () => onNav('home'), style: { width: 36, height: 36, borderRadius: 8, display: 'grid', placeItems: 'center', marginBottom: 8 } },
      s(Logo, { size: 22 })),
    items.map(([p, label, icon]) => s(RailBtn, { key: p, icon, label, active: page === p, onClick: () => onNav(p) })),
    s('div', { style: { flex: 1 } }),
    // upgrade pill
    s('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
      s('div', { style: { height: 28, padding: '0 6px', borderRadius: 6, background: 'linear-gradient(135deg,#f5c842,#f0a020)', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800, color: '#1a1000', letterSpacing: '.02em', whiteSpace: 'nowrap', writingMode: 'vertical-rl', transform: 'rotate(180deg)' } }, lang === 'cn' ? '最低¥4.33/月 升级' : 'Upgrade'),
      s('button', { style: { width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.08)' } }, s(Icon, { name: 'user', size: 16, style: { color: 'var(--text-faint)' } }))));
}

// ── Unified Studio ───────────────────────────────────────────────────────
function UnifiedStudio({ lang, initialMedia, onNav }) {
  const [mediaType, setMediaType] = sS(initialMedia || 'image');
  const [imgMode, setImgMode] = sS(0);
  const [vidMode, setVidMode] = sS(0);
  const [model, setModel] = sS(initialMedia === 'video' ? VID_MODELS[0].id : IMG_MODELS[0].id);
  const [prompt, setPrompt] = sS('');
  const [ratio, setRatio] = sS('1:1');
  const [duration, setDuration] = sS('4s');
  const [quality, setQuality] = sS('720P');
  const [sound, setSound] = sS(false);
  const [phase, setPhase] = sS('idle');
  const [result, setResult] = sS(null);
  const [page, setPage] = sS('studio');
  const [rightTab, setRightTab] = sS('discover'); // lifted: generate() auto-switches

  function generate() {
    const p = prompt.trim() || (mediaType === 'video'
      ? (lang === 'cn' ? '赛博朋克城市夜景中的跑车疾驰，霓虹倒影，慢动作' : 'Sports car racing through neon city, slow motion')
      : (lang === 'cn' ? '霓虹赛博女孩，电影感，8K' : 'Neon cyber girl, cinematic, 8K'));
    if (!prompt.trim()) setPrompt(p);
    setRightTab('create');   // ← auto-switch right panel to 创建
    setPhase('gen');
    const delay = mediaType === 'video' ? 2400 : 1600;
    setTimeout(() => {
      let seed = 0; for (const c of p) seed = (seed + c.charCodeAt(0)) % 360;
      setResult({ c: mesh((seed + 44) % 360, (seed + 160) % 360, (seed + 290) % 360) });
      setPhase('done');
    }, delay);
  }

  const handleNav = (p) => { setPage(p); if (p !== 'studio') onNav(p); };

  return s('div', { style: { display: 'flex', height: 'calc(100vh - 38px)', overflow: 'hidden' } },
    s(IconRail, { lang, onNav: handleNav, page: 'studio' }),
    s(ParamsPanel, { lang, mediaType, setMediaType, vidMode, setVidMode, imgMode, setImgMode,
      model, setModel, prompt, setPrompt, ratio, setRatio, duration, setDuration,
      quality, setQuality, sound, setSound, phase, onGenerate: generate }),
    s(MainArea, { lang, mediaType, phase, result, ratio,
      onDiscover: () => handleNav('explore'), isVideo: mediaType === 'video',
      quality, duration, rightTab, setRightTab }),
  );
}

window.UnifiedStudio = UnifiedStudio;
