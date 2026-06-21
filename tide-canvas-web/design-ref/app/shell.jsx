/* global React, Logo, Wordmark, Icon, Avatar, Seg, tr, ExplorePage, MarketPage, DetailModal, AuthModal, HomePage, PricingPage, InspirationPage, UnifiedStudio */
// SCARECROWAI — app shell
const { createElement: c, useState: uS, useEffect: uE, useRef: uRf } = React;

const STYLE_SWATCH = {
  neon: 'linear-gradient(115deg,#8b6bff,#5ad7ff)',
  candy: 'linear-gradient(115deg,#ff5d9e,#ffb43c)',
  mono: 'linear-gradient(115deg,#5a7bff,#9fb2ff)',
};
const STYLES = ['neon', 'candy', 'mono'];

function useLocal(key, init) {
  const [v, setV] = uS(() => { try { return localStorage.getItem(key) || init; } catch (e) { return init; } });
  uE(() => { try { localStorage.setItem(key, v); } catch (e) {} }, [v]);
  return [v, setV];
}

function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = uS(false);
  const ref = uRf(null);
  uE(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return c('div', { ref, style: { position: 'relative' } },
    c('div', { onClick: () => setOpen((o) => !o) }, trigger),
    open ? c('div', { className: 'menu', style: { top: 'calc(100% + 8px)', [align]: 0 }, onClick: () => setOpen(false) }, children) : null);
}

// ── Wide Mega Menu data ────────────────────────────────────────────────
const NAV_MENUS = {
  image: {
    tools_cn: [
      { name: '文本转图片', desc: '从文本生成图像', grad: 'linear-gradient(135deg,#7c5cff,#5ad7ff)' },
      { name: '图像生图像', desc: '转换一张图像', grad: 'linear-gradient(135deg,#f5a623,#ff5d9e)' },
      { name: '局部重绘', desc: '精准修改画面局部', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: '智能扩图', desc: '无限延伸画面边界', grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)' },
      { name: '移除背景', desc: '一键抠图，边缘精准', grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: '高清放大', desc: '最高 4× 无损放大', grad: 'linear-gradient(135deg,#0ea5e9,#10b981)' },
    ],
    tools_en: [
      { name: 'Text to Image', desc: 'Generate from text', grad: 'linear-gradient(135deg,#7c5cff,#5ad7ff)' },
      { name: 'Image to Image', desc: 'Transform any image', grad: 'linear-gradient(135deg,#f5a623,#ff5d9e)' },
      { name: 'Inpaint', desc: 'Local repaint control', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Outpaint', desc: 'Extend canvas freely', grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)' },
      { name: 'Remove BG', desc: 'One-click precise cutout', grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Upscale', desc: 'Up to 4× lossless', grad: 'linear-gradient(135deg,#0ea5e9,#10b981)' },
    ],
    models_cn: [
      { name: 'GPT Image 2',       tag: 'GP', desc: '用ChatGPT创作你想到的所有图…', badge: 'NEW', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Wan 2.7',           tag: 'WN', desc: '增强的视觉效果，提升的创造力', badge: 'NEW', grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: 'Nano Banana 2',     tag: 'NB', desc: 'Gemini 3.1 Flash Image',       badge: null, grad: 'linear-gradient(135deg,#f5a623,#ff5d9e)' },
      { name: 'Midjourney V7',     tag: 'MJ', desc: '将文字转化为艺术视觉效果',     badge: null, grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)' },
      { name: 'Nano Banana Pro',   tag: 'NP', desc: 'Gemini 3 Pro Image',            badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
      { name: 'Seedream 4.0',      tag: 'S4', desc: '字节跳动的高级图像编辑模型',   badge: null, grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Qwen Image Edit',   tag: 'QE', desc: '支持精确的图像编辑',           badge: null, grad: 'linear-gradient(135deg,#7c5cff,#5ad7ff)' },
      { name: 'Nano Banana',       tag: 'NA', desc: 'Gemini 2.5 Flash',              badge: null, grad: 'linear-gradient(135deg,#10b981,#f59e0b)' },
      { name: 'Seedream 4.5',      tag: 'S5', desc: '字节跳动最新的图像生成模型',   badge: 'HOT', grad: 'linear-gradient(135deg,#ef4444,#f5a623)' },
      { name: 'Qwen Image Plus',   tag: 'QP', desc: '支持多种艺术风格',             badge: null, grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: 'Imagen 4.0 Fast',   tag: 'GF', desc: 'Google最先进的图像模型',       badge: null, grad: 'linear-gradient(135deg,#3b82f6,#10b981)' },
      { name: 'Z Image Turbo',     tag: 'ZT', desc: '即时写实人像',                 badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#ec4899)' },
      { name: 'GPT Image 1',       tag: 'G1', desc: 'OpenAI 的新型高级图像生成模型', badge: null, grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Imagen 4.0 Ultra',  tag: 'GU', desc: 'Google最先进的图像模型',       badge: 'NEW', grad: 'linear-gradient(135deg,#3b82f6,#7c5cff)' },
      { name: 'Imagen 4.0',        tag: 'G4', desc: 'Google最先进的图像模型',       badge: null, grad: 'linear-gradient(135deg,#3b82f6,#0ea5e9)' },
      { name: 'Flux.1 Pro',        tag: 'FX', desc: '超高细节写实，专业首选',       badge: 'HOT', grad: 'linear-gradient(135deg,#7c5cff,#10b981)' },
    ],
    models_en: [
      { name: 'GPT Image 2',       tag: 'GP', desc: 'Create anything you imagine…',  badge: 'NEW', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Wan 2.7',           tag: 'WN', desc: 'Enhanced visuals, elevated creativity', badge: 'NEW', grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: 'Nano Banana 2',     tag: 'NB', desc: 'Gemini 3.1 Flash Image',        badge: null, grad: 'linear-gradient(135deg,#f5a623,#ff5d9e)' },
      { name: 'Midjourney V7',     tag: 'MJ', desc: 'Text into artistic visuals',    badge: null, grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)' },
      { name: 'Nano Banana Pro',   tag: 'NP', desc: 'Gemini 3 Pro Image',            badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
      { name: 'Seedream 4.0',      tag: 'S4', desc: 'Advanced image editing model',  badge: null, grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Qwen Image Edit',   tag: 'QE', desc: 'Precise image editing',         badge: null, grad: 'linear-gradient(135deg,#7c5cff,#5ad7ff)' },
      { name: 'Nano Banana',       tag: 'NA', desc: 'Gemini 2.5 Flash',              badge: null, grad: 'linear-gradient(135deg,#10b981,#f59e0b)' },
      { name: 'Seedream 4.5',      tag: 'S5', desc: 'Latest image generation model', badge: 'HOT', grad: 'linear-gradient(135deg,#ef4444,#f5a623)' },
      { name: 'Qwen Image Plus',   tag: 'QP', desc: 'Multiple artistic styles',      badge: null, grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: 'Imagen 4.0 Fast',   tag: 'GF', desc: "Google's fastest image model",  badge: null, grad: 'linear-gradient(135deg,#3b82f6,#10b981)' },
      { name: 'Z Image Turbo',     tag: 'ZT', desc: 'Instant realistic portraits',   badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#ec4899)' },
      { name: 'GPT Image 1',       tag: 'G1', desc: "OpenAI's new image model",      badge: null, grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Imagen 4.0 Ultra',  tag: 'GU', desc: "Google's most advanced model",  badge: 'NEW', grad: 'linear-gradient(135deg,#3b82f6,#7c5cff)' },
      { name: 'Imagen 4.0',        tag: 'G4', desc: "Google's advanced model",       badge: null, grad: 'linear-gradient(135deg,#3b82f6,#0ea5e9)' },
      { name: 'Flux.1 Pro',        tag: 'FX', desc: 'Ultra-detail realism, pro',     badge: 'HOT', grad: 'linear-gradient(135deg,#7c5cff,#10b981)' },
    ],
  },
  video: {
    tools_cn: [
      { name: '文本转视频', desc: '一句话生成影片',         grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: '图像转视频', desc: '静图变动态，一键起飞',   grad: 'linear-gradient(135deg,#ec4899,#f59e0b)' },
      { name: '视频延长',   desc: '自动续写下一幕',         grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: '运镜控制',   desc: '推拉摇移，精准调度',     grad: 'linear-gradient(135deg,#10b981,#0ea5e9)' },
      { name: '视频配音',   desc: '自动生成同期音效',       grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: '角色替换',   desc: '换脸换装，一键完成',     grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
    ],
    tools_en: [
      { name: 'Text to Video',   desc: 'Generate video from text',    grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: 'Image to Video',  desc: 'Animate any still image',     grad: 'linear-gradient(135deg,#ec4899,#f59e0b)' },
      { name: 'Video Extend',    desc: 'Continue the next scene',     grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: 'Camera Control',  desc: 'Pan, tilt, zoom precisely',   grad: 'linear-gradient(135deg,#10b981,#0ea5e9)' },
      { name: 'AI Sound',        desc: 'Auto sound effects sync',     grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Role Swap',       desc: 'Face/outfit swap, one tap',   grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
    ],
    models_cn: [
      { name: 'Seedance 2.0',    tag: 'S2', desc: '音画同步，多模态旗舰',       badge: 'HOT', grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: 'Kling 3.0',       tag: 'KL', desc: '原生 4K 60fps，AI 分镜',     badge: 'HOT', grad: 'linear-gradient(135deg,#ec4899,#f59e0b)' },
      { name: 'Sora 2',          tag: 'SO', desc: 'OpenAI 长视频，物理一致性', badge: null, grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: 'Google Veo 3',    tag: 'VE', desc: '音频原生，超逼真场景',       badge: 'NEW', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Wan Video',       tag: 'WV', desc: '开源视频生成旗舰',           badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
      { name: 'Hailuo 2.0',      tag: 'HL', desc: '中文音频+超写实视频',       badge: 'HOT', grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Pika 2.2',        tag: 'PK', desc: '创意动画风格，快速出图',     badge: null, grad: 'linear-gradient(135deg,#ec4899,#7c5cff)' },
      { name: 'Runway Gen-4',    tag: 'RW', desc: '专业级影视创作工具',         badge: null, grad: 'linear-gradient(135deg,#3b82f6,#10b981)' },
    ],
    models_en: [
      { name: 'Seedance 2.0',    tag: 'S2', desc: 'Audio-visual sync, multimodal', badge: 'HOT', grad: 'linear-gradient(135deg,#7c5cff,#ec4899)' },
      { name: 'Kling 3.0',       tag: 'KL', desc: 'Native 4K 60fps, AI multi-shot', badge: 'HOT', grad: 'linear-gradient(135deg,#ec4899,#f59e0b)' },
      { name: 'Sora 2',          tag: 'SO', desc: 'OpenAI long video, physics',    badge: null, grad: 'linear-gradient(135deg,#0ea5e9,#7c5cff)' },
      { name: 'Google Veo 3',    tag: 'VE', desc: 'Native audio, hyper-real',      badge: 'NEW', grad: 'linear-gradient(135deg,#10b981,#3b82f6)' },
      { name: 'Wan Video',       tag: 'WV', desc: 'Open-source video flagship',    badge: null, grad: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' },
      { name: 'Hailuo 2.0',      tag: 'HL', desc: 'Chinese audio + ultra-real',   badge: 'HOT', grad: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
      { name: 'Pika 2.2',        tag: 'PK', desc: 'Creative animation, fast',      badge: null, grad: 'linear-gradient(135deg,#ec4899,#7c5cff)' },
      { name: 'Runway Gen-4',    tag: 'RW', desc: 'Professional film creation',    badge: null, grad: 'linear-gradient(135deg,#3b82f6,#10b981)' },
    ],
  },
};

// ── Wide mega-menu: LEFT = tools, RIGHT = all models 4-col ─────────────
function NavDropdown({ label, menuKey, lang, onCreate, onNav }) {
  const [open, setOpen] = uS(false);
  const ref = uRf(null);
  uE(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const menu = NAV_MENUS[menuKey];
  const models = menu['models_' + lang] || menu.models_cn;
  const tools = menu['tools_' + lang] || menu.tools_cn;
  const isCn = lang === 'cn';

  return c('div', { ref, style: { position: 'relative' } },
    c('button', {
      onMouseEnter: () => setOpen(true),
      onClick: () => setOpen((o) => !o),
      style: { display: 'inline-flex', alignItems: 'center', gap: 4, height: 38, padding: '0 10px',
        borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 500,
        color: open ? 'var(--text)' : 'var(--text-dim)', transition: 'color .14s',
        background: open ? 'var(--panel)' : 'none', whiteSpace: 'nowrap' },
    },
      label,
      c('span', { style: { display: 'inline-flex', alignItems: 'center', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' } },
        c(Icon, { name: 'chevronDown', size: 13 }))),

    open ? c('div', {
      onMouseLeave: () => setOpen(false),
      style: { position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-28%)',
        zIndex: 80, width: 860, borderRadius: 'var(--radius-lg)',
        background: 'var(--panel-solid)', border: '1px solid var(--border)',
        boxShadow: '0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.1)',
        overflow: 'hidden', animation: 'modalIn .22s var(--ease)' },
    },
      c('div', { style: { height: 3, background: 'var(--grad)' } }),
      c('div', { style: { display: 'flex' } },

        // LEFT ── 功能列
        c('div', { style: { width: 180, flexShrink: 0, padding: '16px 12px 14px',
          borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' } },
          c('div', { style: { fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--text-faint)', marginBottom: 8, paddingLeft: 4 } },
            isCn ? '功能' : 'Tools'),
          c('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            tools.map((t, i) => c('button', { key: i, onClick: () => { setOpen(false); onCreate(); },
              style: { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 8px 8px 6px',
                borderRadius: 8, textAlign: 'left', transition: 'background .12s', cursor: 'pointer', width: '100%' },
              onMouseEnter: e => e.currentTarget.style.background = 'var(--panel)',
              onMouseLeave: e => e.currentTarget.style.background = 'transparent',
            },
              c('div', { style: { width: 32, height: 32, borderRadius: 8, background: t.grad,
                flex: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.16)' } }),
              c('div', { style: { flex: 1, minWidth: 0 } },
                c('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
                c('div', { style: { fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 } }, t.desc))))),
          // all tools footer
          // inline footer
            c('button', { onClick: () => { setOpen(false); onCreate(); },
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 6px',
                borderRadius: 8, width: '100%', transition: 'background .12s', cursor: 'pointer',
                borderTop: '1px solid var(--border)', marginTop: 8 },
              onMouseEnter: e => e.currentTarget.style.background = 'var(--panel)',
              onMouseLeave: e => e.currentTarget.style.background = 'transparent',
            },
              c('div', { style: { width: 32, height: 32, borderRadius: 8, background: 'var(--panel)',
                border: '1px solid var(--border)', flex: 'none', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' } },
                c(Icon, { name: 'grid', size: 14 })),
              c('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' } },
                isCn ? '所有灵感' : 'All tools'))),

        // RIGHT ── 全部模型
        c('div', { style: { flex: 1, minWidth: 0, padding: '16px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
          // header
          c('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            c('span', { style: { fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)' } },
              isCn ? '模型' : 'Models'),
            c('span', { style: { fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
              background: 'var(--accent-soft)', color: 'var(--accent)' } }, models.length),
            c('span', { style: { flex: 1, height: 1, background: 'var(--border)' } }),
            c('button', { onClick: () => { setOpen(false); onNav('market'); },
              style: { fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 } },
              isCn ? '查看市场' : 'Browse market', c(Icon, { name: 'chevron', size: 12 }))),

          // 3-col grid, all models
          c('div', { className: 'scroll',
            style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2,
              paddingRight: 2 } },
            models.map((m, i) => c('button', { key: i, onClick: () => { setOpen(false); onCreate(); },
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                borderRadius: 8, textAlign: 'left', transition: 'background .12s', cursor: 'pointer', width: '100%' },
              onMouseEnter: e => e.currentTarget.style.background = 'var(--panel)',
              onMouseLeave: e => e.currentTarget.style.background = 'transparent',
            },
              c('div', { style: { width: 30, height: 30, borderRadius: 8, background: m.grad, flex: 'none',
                display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800, color: '#fff',
                letterSpacing: '-0.01em', boxShadow: '0 2px 6px rgba(0,0,0,.16)', flexShrink: 0 } }, m.tag),
              c('div', { style: { flex: 1, minWidth: 0 } },
                c('div', { style: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 } },
                  c('span', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.name),
                  m.badge ? c('span', { style: { fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
                    background: m.badge === 'HOT' ? 'var(--grad-warm)' : 'var(--accent)', color: '#fff', lineHeight: 1.5 } }, m.badge) : null),
                c('div', { style: { fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.desc),
              )))),
        ),
      ),
    ) : null);
}

// ── Announcement bar ──────────────────────────────────────────────────
function AnnoBar({ lang, onClose, onPricing }) {
  return c('div', {
    style: {
      position: 'relative', zIndex: 62, height: 42,
      display: 'grid', gridTemplateColumns: '32px 1fr 32px', alignItems: 'center',
      padding: '0 10px',
      background: 'linear-gradient(90deg, #0e0529 0%, #130b3a 30%, #0c1e42 60%, #0e0529 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      overflow: 'hidden',
    },
  },
    // ambient glow blobs
    c('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', gridColumn: '1/-1', gridRow: 1 } },
      c('div', { style: { position: 'absolute', left: '20%', top: '-60%', width: 260, height: 120,
        background: 'radial-gradient(ellipse, rgba(124,92,255,0.35) 0%, transparent 70%)', filter: 'blur(18px)' } }),
      c('div', { style: { position: 'absolute', right: '22%', top: '-60%', width: 200, height: 120,
        background: 'radial-gradient(ellipse, rgba(34,211,238,0.22) 0%, transparent 70%)', filter: 'blur(18px)' } }),
    ),
    // left spacer (balances close button on right)
    c('div', null),
    // center content
    c('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 } },
    // NEW badge
    c('span', { style: {
      fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em',
      padding: '2px 7px', borderRadius: 4,
      background: 'linear-gradient(115deg,#f5c842,#f0a020)',
      color: '#1a1000', flex: 'none',
    } }, lang === 'cn' ? '限时' : 'DEAL'),
    // copy
    c('span', { style: { fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap' } },
      lang === 'cn' ? 'SCARECROWAI 2.0 不限速 · 年费低至 ' : 'SCARECROWAI 2.0 unlimited · annual plan from ',
      c('span', { style: { fontWeight: 800, color: '#fff', background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
        lang === 'cn' ? '5.5 折' : '45% off'),
    ),
    // CTA
    c('button', { onClick: onPricing, style: {
      height: 26, padding: '0 14px', borderRadius: 20, flex: 'none', whiteSpace: 'nowrap',
      fontSize: 12, fontWeight: 700, color: '#fff',
      background: 'rgba(255,255,255,0.12)',
      border: '1px solid rgba(255,255,255,0.22)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      transition: 'background .15s, border-color .15s',
    },
    onMouseEnter: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.20)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.38)'; },
    onMouseLeave: e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; },
    },
      lang === 'cn' ? '立即升级' : 'Upgrade now',
      c(Icon, { name: 'chevron', size: 12 }),
    ),
    ), // end center content div
    // close — right cell
    c('button', { onClick: onClose, 'aria-label': lang === 'cn' ? '关闭' : 'Close',
      style: { justifySelf: 'end',
        width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center',
        color: 'rgba(255,255,255,0.35)', transition: 'color .14s' },
      onMouseEnter: e => e.currentTarget.style.color = 'rgba(255,255,255,0.75)',
      onMouseLeave: e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)',
    }, c(Icon, { name: 'close', size: 13 })),
  );
}

// ── Studio sub-nav ────────────────────────────────────────────────────
function StudioSubNav({ lang, page, setPage }) {
  const tabs_cn = [['studio','创作间','image'],['inspire','灵感','sparkle'],['market','助手','bolt'],['explore','资产','grid']];
  const tabs_en = [['studio','Studio','image'],['inspire','Inspire','sparkle'],['market','Models','bolt'],['explore','Assets','grid']];
  const tabs = lang === 'cn' ? tabs_cn : tabs_en;
  return c('div', { style: { display: 'flex', alignItems: 'center', gap: 2, borderRight: '1px solid var(--border)', paddingRight: 14, marginRight: 6 } },
    tabs.map(([p, label, icon]) => c('button', { key: p, onClick: () => setPage(p),
      style: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 11px', borderRadius: 'var(--radius-sm)', fontSize: 13.5, fontWeight: page === p ? 600 : 500,
        color: page === p ? 'var(--text)' : 'var(--text-faint)', background: page === p ? 'var(--panel)' : 'transparent', border: page === p ? '1px solid var(--border)' : '1px solid transparent', transition: 'all .15s', whiteSpace: 'nowrap' } },
      c(Icon, { name: icon, size: 13 }), label)));
}

function TopBar({ lang, setLang, theme, setTheme, style, setStyle, page, setPage, onCreate, authed, onAuthOpen }) {
  return c('header', {
    style: { position: 'sticky', top: 0, zIndex: 60, display: 'flex', alignItems: 'center', gap: 0,
      padding: '0 18px', height: 52, borderBottom: '1px solid var(--border)',
      background: 'color-mix(in oklab, var(--bg) 82%, transparent)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' },
  },
    c('button', { onClick: () => setPage('home'), style: { flex: 'none', marginRight: 20 } },
      c(Wordmark, { size: 15, lang, markSize: 22 })),
    ['studio','video','inspire'].includes(page)
      ? c(StudioSubNav, { lang, page, setPage })
      : c('nav', { className: 'hide-sm', style: { display: 'flex', alignItems: 'center', gap: 2 } },
          c('button', { className: 'navlink', 'data-active': page === 'explore', onClick: () => setPage('explore'), style: { fontSize: 14, fontWeight: 500 } }, lang === 'cn' ? '发现' : 'Discover'),
          c(NavDropdown, { label: lang === 'cn' ? '图片生成' : 'Image', menuKey: 'image', lang, onCreate, onNav: setPage }),
          c(NavDropdown, { label: lang === 'cn' ? '视频创作' : 'Video', menuKey: 'video', lang, onCreate: () => setPage('video'), onNav: setPage }),
          c('button', { className: 'navlink', 'data-active': page === 'playbook', onClick: () => setPage('playbook'), style: { fontSize: 14, fontWeight: 500 } }, lang === 'cn' ? '玩法' : 'Playbook'),
          c('button', { className: 'navlink', onClick: () => setPage('pricing'), style: { fontSize: 14, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' } },
            lang === 'cn' ? '价格方案' : 'Pricing',
            c('span', { style: { fontSize: 9.5, fontWeight: 800, letterSpacing: '.02em', padding: '2px 6px', borderRadius: 5,
              background: 'var(--grad-warm)', color: '#fff', flex: 'none', lineHeight: 1.3, boxShadow: '0 2px 6px var(--accent-soft)' } },
              lang === 'cn' ? '限时' : 'SALE'))),
    c('div', { style: { flex: 1 } }),
    c('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      c('button', { onClick: onCreate,
        style: { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
          background: 'linear-gradient(115deg,#f5c842,#f0a020)', color: '#1a1000', flex: 'none', whiteSpace: 'nowrap' } },
        c('span', { style: { fontSize: 15 } }, '🍌'),
        'Nano Banana 2',
        c(Icon, { name: 'chevron', size: 13 })),
      c(Dropdown, {
        align: 'right',
        trigger: c('button', { className: 'btn btn-ghost', style: { height: 34, padding: '0 10px', fontSize: 13, gap: 5 } },
          c(Icon, { name: 'globe', size: 15 }), lang === 'cn' ? '简体中文' : 'English', c(Icon, { name: 'chevronDown', size: 13 })),
      },
        ['cn', 'en'].map((l) => c('button', { key: l, className: 'menu-item', 'data-active': lang === l, onClick: () => setLang(l) },
          l === 'cn' ? '简体中文' : 'English', lang === l ? c(Icon, { name: 'check', size: 14, style: { color: 'var(--accent)', marginLeft: 'auto' } }) : null))),
      c(Dropdown, { align: 'right',
        trigger: c('button', { className: 'iconbtn', style: { width: 34, height: 34, position: 'relative' }, 'aria-label': lang === 'cn' ? '通知' : 'Notifications' },
          c(Icon, { name: 'sparkle', size: 17 }),
          c('span', { style: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%',
            background: 'var(--accent)', border: '2px solid var(--surface)', boxSizing: 'content-box' } })),
      },
        c('div', { style: { width: 280, padding: '4px 0' } },
          c('div', { style: { padding: '10px 14px 8px', fontSize: 12, fontWeight: 700, letterSpacing: '.04em',
            color: 'var(--text-faint)', textTransform: 'uppercase' } },
            lang === 'cn' ? '最新动态' : "What's new"),
          [
            { icon: '🎉', title: lang === 'cn' ? 'Seedance 2.0 正式上线' : 'Seedance 2.0 is live',
              sub: lang === 'cn' ? '视频生成速度提升 3×，支持 4K 输出' : '3× faster video generation, 4K output', time: lang === 'cn' ? '刚刚' : 'Just now', dot: true },
            { icon: '⚡', title: lang === 'cn' ? 'Flux.1 Pro 限时 5 折' : 'Flux.1 Pro — 50% off today',
              sub: lang === 'cn' ? '今日 24:00 截止，仅限年费用户' : 'Ends midnight, annual plans only', time: lang === 'cn' ? '2小时前' : '2h ago', dot: true },
            { icon: '🛠', title: lang === 'cn' ? '创作间支持批量生图' : 'Studio: batch generation',
              sub: lang === 'cn' ? '一次最多生成 8 张，任务并行执行' : 'Up to 8 images at once, parallel tasks', time: lang === 'cn' ? '昨天' : 'Yesterday', dot: false },
          ].map((n, i) => c('div', { key: i, className: 'menu-item', style: { height: 'auto', padding: '10px 14px', gap: 10, alignItems: 'flex-start', cursor: 'default' } },
            c('span', { style: { fontSize: 20, flex: 'none', marginTop: 1 } }, n.icon),
            c('div', { style: { flex: 1, minWidth: 0 } },
              c('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } },
                c('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.title),
                n.dot ? c('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flex: 'none' } }) : null),
              c('div', { style: { fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 4, textWrap: 'pretty' } }, n.sub),
              c('div', { style: { fontSize: 11, color: 'var(--text-faint)' } }, n.time)))),
          c('div', { style: { borderTop: '1px solid var(--border)', margin: '4px 0 0', padding: '6px 8px 4px' } },
            c('button', { className: 'menu-item', style: { width: '100%', justifyContent: 'center', color: 'var(--accent)', fontSize: 13 } },
              lang === 'cn' ? '查看全部动态' : 'View all updates')))),
      c(Dropdown, {
        align: 'right',
        trigger: c('button', { className: 'iconbtn', style: { width: 34, height: 34 }, title: tr(lang, 'sw.style') },
          c('span', { style: { width: 15, height: 15, borderRadius: 4, background: STYLE_SWATCH[style] } })),
      },
        STYLES.map((s) => c('button', { key: s, className: 'menu-item', 'data-active': style === s, onClick: () => setStyle(s) },
          c('span', { style: { width: 20, height: 20, borderRadius: 5, background: STYLE_SWATCH[s], flex: 'none' } }),
          c('span', { style: { flex: 1 } }, tr(lang, 'style.' + s)),
          style === s ? c(Icon, { name: 'check', size: 14, style: { color: 'var(--accent)' } }) : null))),
      c('button', { className: 'iconbtn', style: { width: 34, height: 34 }, 'aria-label': tr(lang, 'sw.theme'), onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
        c(Icon, { name: theme === 'dark' ? 'sun' : 'moon', size: 17 })),
      c('button', { onClick: () => setPage('pricing'),
        style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 700,
          background: 'var(--grad)', color: 'var(--on-accent)', flex: 'none', whiteSpace: 'nowrap' } },
        c('span', { style: { position: 'absolute', top: -8, right: -4, fontSize: 9.5, fontWeight: 800, background: '#f5a623', color: '#fff', padding: '2px 5px', borderRadius: 4 } }, '62% OFF'),
        lang === 'cn' ? '会员特惠' : 'Pro Deal'),
      authed
        ? c('button', { onClick: () => setPage('explore'),
            style: { display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderRadius: 'var(--radius-pill)', background: 'var(--panel)', border: '1px solid var(--border)', fontSize: 13.5, fontWeight: 600 } },
            c(Avatar, { name: '你', size: 24 }), lang === 'cn' ? '我的创作' : 'My Work')
        : c('button', { onClick: onAuthOpen, className: 'btn btn-ghost', style: { height: 34, padding: '0 14px', fontSize: 13.5, fontWeight: 600 } },
            lang === 'cn' ? '登录' : 'Sign in'),
    ),
  );
}

function Footer({ lang }) {
  return c('footer', { style: { borderTop: '1px solid var(--border)', padding: '26px 22px', textAlign: 'center', position: 'relative', zIndex: 1 } },
    c('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: 8, color: 'var(--text-dim)' } },
      c(Logo, { size: 20 }), c('span', { className: 'font-display', style: { fontWeight: 800, fontSize: 14 } }, 'SCARECROW', c('span', { style: { color: 'var(--accent)' } }, 'AI'))),
    c('div', { style: { fontSize: 12, color: 'var(--text-faint)', maxWidth: 540, margin: '0 auto', lineHeight: 1.5 } }, tr(lang, 'foot.tip')));
}

function App() {
  const [theme, setTheme] = useLocal('scarecrowai_theme', 'dark');
  const [style, setStyle] = useLocal('scarecrowai_style', 'neon');
  const [lang, setLang] = useLocal('scarecrowai_lang', 'cn');
  const [page, setPage] = useLocal('scarecrowai_page', 'home');
  const [detail, setDetail] = uS(null);
  const [authOpen, setAuthOpen] = uS(false);
  const [authed, setAuthed] = uS(false);
  const [annoVisible, setAnnoVisible] = uS(() => { try { return !localStorage.getItem('scarecrowai_anno_closed'); } catch(e) { return true; } });

  uE(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  uE(() => { document.documentElement.dataset.style = style; }, [style]);
  uE(() => { document.documentElement.lang = lang === 'cn' ? 'zh' : 'en'; }, [lang]);

  const closeAnno = () => { setAnnoVisible(false); try { localStorage.setItem('scarecrowai_anno_closed','1'); } catch(e) {} };
  const openStudio = () => { setDetail(null); setPage('studio'); };
  const onOpenArt = (art, remix) => { if (remix === true) openStudio(); else setDetail(art); };
  const onRemixFromDetail = (art, open) => { if (open === 'open') { setDetail(art); } else openStudio(); };
  const onUseModel = () => { setPage('studio'); };

  return c('div', { style: { position: 'relative', minHeight: '100%' } },
    c('div', { className: 'ambient' }),
    c('div', { style: { position: 'relative', zIndex: 1 } },
      annoVisible ? c(AnnoBar, { lang, onClose: closeAnno, onPricing: () => setPage('pricing') }) : null,
      (page === 'studio' || page === 'video') ? null : c(TopBar, { lang, setLang, theme, setTheme, style, setStyle, page, setPage, onCreate: openStudio, authed, onAuthOpen: () => setAuthOpen(true) }),
      page === 'home'    ? c('div', { key: 'home',    className: 'page-enter' }, c(HomePage,        { lang, onCreate: openStudio, onNav: setPage }))
      : (page === 'studio' || page === 'video')
                         ? c(UnifiedStudio,                                       { lang, initialMedia: page === 'video' ? 'video' : 'image', onNav: setPage })
      : page === 'inspire' ? c('div', { key: 'inspire', className: 'page-enter' }, c(InspirationPage,  { lang, onCreate: openStudio }))
      : page === 'playbook' ? c('div', { key: 'playbook', className: 'page-enter' }, c(InspirationPage, { lang, onCreate: openStudio }))
      : page === 'explore' ? c('div', { key: 'explore', className: 'page-enter' }, c(ExplorePage,      { lang, onOpen: onOpenArt, onCreate: openStudio }))
      : page === 'pricing' ? c('div', { key: 'pricing', className: 'page-enter' }, c(PricingPage,      { lang, onCreate: openStudio }))
      :                      c('div', { key: 'market',  className: 'page-enter' }, c(MarketPage,       { lang, onUse: onUseModel })),
      ['home','studio','video'].includes(page) ? null : c(Footer, { lang }),
    ),
    detail    ? c(DetailModal, { art: detail, lang, onClose: () => setDetail(null), onRemix: onRemixFromDetail }) : null,
    authOpen  ? c(AuthModal,   { lang, onClose: () => setAuthOpen(false), onSuccess: () => setAuthed(true) }) : null,
  );
}

window.App = App;
