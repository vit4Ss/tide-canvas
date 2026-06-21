/* global React, Icon, Avatar, Cover, tr, ARTWORKS */
// SCARECROWAI — overlays: artwork detail lightbox
const { createElement: o, useState: oS, useEffect: oE, useRef: oR } = React;

function Backdrop({ onClose, children, pad }) {
  oE(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, []);
  return o('div', {
    onClick: onClose,
    style: { position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center',
      padding: pad || 'clamp(12px, 4vw, 48px)', background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)', animation: 'fadeUp .26s var(--ease)' },
  }, children);
}

function CopyBtn({ text, lang }) {
  const [done, setDone] = oS(false);
  return o('button', { className: 'tag', style: { cursor: 'pointer', height: 26 },
    onClick: () => { try { navigator.clipboard?.writeText(text); } catch (e) {} setDone(true); setTimeout(() => setDone(false), 1400); } },
    o(Icon, { name: done ? 'check' : 'copy', size: 12 }), done ? tr(lang, 'detail.copied') : tr(lang, 'detail.copy'));
}

// ── artwork detail ──────────────────────────────────────────────────────
function DetailModal({ art, lang, onClose, onRemix }) {
  const isVideo = art.type === 'video';
  const related = ARTWORKS.filter((a) => a.id !== art.id && a.cat === art.cat).slice(0, 6);
  const relList = related.length ? related : ARTWORKS.filter((a) => a.id !== art.id).slice(0, 6);
  const stop = (e) => e.stopPropagation();
  return o(Backdrop, { onClose },
    o('div', { onClick: stop, className: 'scroll', style: { display: 'flex', width: 'min(1060px, 96vw)', maxHeight: '88vh',
      background: 'var(--panel-solid)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-pop)' } },
      // media
      o('div', { style: { flex: '1.25', minWidth: 0, position: 'relative', background: '#000', display: 'grid', placeItems: 'center', minHeight: 420 } },
        o('div', { style: { position: 'relative', width: '100%', aspectRatio: `1 / ${Math.min(art.h, 1.3)}`, maxHeight: '88vh' } },
          o(Cover, { art }),
          isVideo ? o('div', { className: 'play-orb', style: { width: 66, height: 66 } }, o(Icon, { name: 'play', size: 26 })) : null),
      ),
      // info
      o('div', { className: 'scroll', style: { width: 'min(380px, 42vw)', flex: 'none', display: 'flex', flexDirection: 'column', overflowY: 'auto' } },
        o('div', { style: { padding: '20px 22px', borderBottom: '1px solid var(--border)' } },
          o('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            o(Avatar, { name: art.author, size: 38 }),
            o('div', { style: { minWidth: 0, flex: 1 } },
              o('div', { style: { fontSize: 14, fontWeight: 700 } }, art.author),
              o('div', { style: { fontSize: 12, color: 'var(--text-faint)' } }, lang === 'cn' ? '创作者' : 'Creator')),
            o('button', { className: 'btn btn-ghost', style: { height: 34, padding: '0 14px', fontSize: 13 } },
              o(Icon, { name: 'plus', size: 14 }), tr(lang, 'detail.follow')),
            o('button', { className: 'iconbtn', style: { width: 34, height: 34 }, onClick: onClose, 'aria-label': lang === 'cn' ? '关闭' : 'Close' }, o(Icon, { name: 'close', size: 16 })),
          ),
        ),
        o('div', { style: { padding: '18px 22px', flex: 1 } },
          o('h2', { className: 'font-display', style: { fontSize: 21, fontWeight: 800, margin: '0 0 14px' } }, lang === 'cn' ? art.titleCn : art.titleEn),
          // actions
          o('div', { style: { display: 'flex', gap: 9, marginBottom: 20 } },
            o('button', { className: 'btn btn-primary', style: { flex: 1 }, onClick: () => onRemix(art) }, o(Icon, { name: 'sparkle', size: 16 }), tr(lang, 'detail.same')),
            o('button', { className: 'iconbtn', 'aria-label': lang === 'cn' ? '收藏' : 'Like' }, o(Icon, { name: 'heart', size: 17 })),
            o('button', { className: 'iconbtn', 'aria-label': tr(lang, 'detail.download') }, o(Icon, { name: 'download', size: 17 })),
          ),
          // prompt
          o('div', { style: { marginBottom: 14 } },
            o('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
              o('span', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-faint)', textTransform: 'uppercase' } }, tr(lang, 'detail.prompt')),
              o(CopyBtn, { text: art.prompt, lang })),
            o('div', { className: 'mono', style: { fontSize: 12, lineHeight: 1.65, color: 'var(--text-dim)', padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              background: 'var(--panel)', border: '1px solid var(--border)' } }, art.prompt)),
          // negative prompt (if present)
          art.negPrompt ? o('div', { style: { marginBottom: 14 } },
            o('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
              o('span', { style: { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-faint)', textTransform: 'uppercase' } }, tr(lang, 'detail.neg')),
              o(CopyBtn, { text: art.negPrompt, lang })),
            o('div', { className: 'mono', style: { fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-faint)', padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              background: 'var(--panel)', border: '1px solid var(--border)', fontStyle: 'italic' } }, art.negPrompt)) : null,
          // params grid — 3×2
          o('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 } },
            [
              [tr(lang, 'detail.model'),   art.model],
              [tr(lang, 'detail.steps'),   art.steps ? art.steps + ' steps' : '—'],
              [tr(lang, 'detail.cfg'),     art.cfgScale != null ? String(art.cfgScale) : '7.5'],
              [tr(lang, 'detail.sampler'), art.sampler || '—'],
              [tr(lang, 'detail.size'),    art.size || (isVideo ? '1920×1080' : '1024×1024')],
              [tr(lang, 'detail.seed'),    String(1000000 + art.likes * 7)],
            ].map(([k, v], i) => o('div', { key: i, style: { padding: '9px 11px', borderRadius: 'var(--radius-sm)', background: 'var(--panel)', border: '1px solid var(--border)' } },
              o('div', { style: { fontSize: 10, color: 'var(--text-faint)', marginBottom: 4, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' } }, k),
              o('div', { className: 'mono tnum', style: { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' } }, v)))),
          // video duration tag
          isVideo ? o('div', { style: { marginBottom: 18 } },
            o('span', { className: 'tag' }, o(Icon, { name: 'video', size: 11 }), '6 s · 24 fps · 1920×1080')) : null,
          // related
          o('div', null,
            o('div', { style: { fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 10 } }, tr(lang, 'detail.related')),
            o('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
              relList.map((a) => o('div', { key: a.id, onClick: () => onRemix(a, 'open'), style: { position: 'relative', aspectRatio: '1', borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer' } },
                o(Cover, { art: a }))))),
        ),
      ),
    ),
  );
}

window.DetailModal = DetailModal;
