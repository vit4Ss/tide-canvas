/* global React */
// SCARECROWAI brand mark — a geometric scarecrow: straw-hat + head + cross-post.
// Built from primitives only (rects / circle / triangle) so it stays crisp at any size.
const { createElement: h } = React;

function Logo({ size = 28, tone = 'duo', style }) {
  // tone: 'duo' = head+hat in accent, frame in currentColor; 'solid' = all currentColor
  const accent = tone === 'duo' ? 'var(--accent)' : 'currentColor';
  return h('svg', {
    width: size, height: size, viewBox: '0 0 32 32', fill: 'none',
    style: { display: 'block', flex: 'none', ...style }, 'aria-hidden': true,
  },
    // cross-arms
    h('rect', { x: 4.5, y: 13.6, width: 23, height: 3.2, rx: 1.6, fill: 'currentColor' }),
    // body post
    h('rect', { x: 14.4, y: 11, width: 3.2, height: 17.2, rx: 1.6, fill: 'currentColor' }),
    // head
    h('circle', { cx: 16, cy: 8.3, r: 3.6, fill: accent }),
    // hat brim
    h('rect', { x: 9.4, y: 4.5, width: 13.2, height: 2.2, rx: 1.1, fill: 'currentColor' }),
    // hat cone
    h('path', { d: 'M16 0.4 L20.4 5 L11.6 5 Z', fill: accent }),
    // stitch spark on the arm — tiny AI patch
    h('rect', { x: 23.4, y: 18.4, width: 2.6, height: 2.6, rx: 0.7, fill: accent, transform: 'rotate(45 24.7 19.7)' }),
  );
}

// Wordmark — "SCARECROW" + accented "AI". cn adds the 稻草人 tagline.
function Wordmark({ size = 18, lang = 'cn', mark = true, markSize }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: size * 0.5 } },
    mark && h(Logo, { size: markSize || size * 1.5 }),
    h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1 } },
      h('div', { className: 'font-display', style: { fontWeight: 800, fontSize: size, letterSpacing: '-0.01em' } },
        'SCARECROW',
        h('span', { style: { color: 'var(--accent)' } }, 'AI'),
      ),
      lang === 'cn' && h('div', {
        style: { fontSize: size * 0.42, letterSpacing: '0.34em', color: 'var(--text-faint)', marginTop: size * 0.18, fontWeight: 500, paddingLeft: 1 },
      }, '稻 草 人 智 绘'),
    ),
  );
}

window.Logo = Logo;
window.Wordmark = Wordmark;
