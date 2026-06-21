/* global React, Icon, Avatar, Cover, tr, CATEGORIES, ARTWORKS, fmt */
// SCARECROWAI — Explore / 作品广场
const { createElement: el, useState: useS, useMemo: useM, useRef: useR, useEffect: useE } = React;

// Column-balanced masonry (flex columns, not CSS multi-column) — renders
// reliably everywhere and lets us balance by each tile's relative height.
function Masonry({ items, lang, onOpen, minCol = 248, gap = 16 }) {
  const ref = useR(null);
  const [cols, setCols] = useS(4);
  useE(() => {
    const node = ref.current; if (!node) return;
    const measure = () => { const w = node.clientWidth; setCols(Math.max(1, Math.floor((w + gap) / (minCol + gap)))); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const buckets = useM(() => {
    const cs = Array.from({ length: cols }, () => []); const hs = Array(cols).fill(0);
    for (const it of items) { let mi = 0; for (let i = 1; i < cols; i++) if (hs[i] < hs[mi]) mi = i; cs[mi].push(it); hs[mi] += it.h + 0.32; }
    return cs;
  }, [items, cols]);
  return el('div', { ref, style: { display: 'flex', gap, alignItems: 'flex-start' } },
    buckets.map((col, ci) => el('div', { key: ci, style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap } },
      col.map((a) => el(ArtTile, { key: a.id, art: a, lang, onOpen })))));
}

function ArtTile({ art, lang, onOpen }) {
  const [liked, setLiked] = useS(false);
  const isVideo = art.type === 'video';
  return el('div', { className: 'tile', style: { aspectRatio: `1 / ${art.h}` }, onClick: () => onOpen(art) },
    el(Cover, { art }),
    el('div', { className: 'tile-top' },
      el('span', { className: 'media-badge' },
        el(Icon, { name: isVideo ? 'video' : 'image', size: 12 }),
        isVideo ? tr(lang, 'badge.video') : null),
      el('button', { className: 'like-pill', 'data-liked': liked ? 'true' : 'false',
        onClick: (ev) => { ev.stopPropagation(); setLiked(l => !l); } },
        el(Icon, { name: 'heart', size: 13, fill: liked }), el('span', { className: 'tnum' }, fmt(liked ? art.likes + 1 : art.likes))),
    ),
    isVideo ? el('div', { className: 'play-orb' }, el(Icon, { name: 'play', size: 22 })) : null,
    el('div', { className: 'tile-overlay' },
      el('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 7, textShadow: '0 1px 8px rgba(0,0,0,.5)' } },
        lang === 'cn' ? art.titleCn : art.titleEn),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        el(Avatar, { name: art.author, size: 22 }),
        el('span', { style: { fontSize: 12.5, fontWeight: 500, opacity: .92 } }, art.author),
        el('span', { className: 'tag', style: { marginLeft: 'auto', background: 'rgba(255,255,255,0.16)', border: 'none', color: '#fff' } }, art.model),
      ),
      el('button', { className: 'remix-btn', onClick: (ev) => { ev.stopPropagation(); onOpen(art, true); } },
        el(Icon, { name: 'sparkle', size: 13 }), tr(lang, 'feed.same')),
    ),
  );
}

function Hero({ lang, onCreate }) {
  return el('div', {
    style: { position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
      padding: '44px 400px 44px 44px', marginBottom: 28, background: 'var(--panel-solid)', minHeight: 200 },
  },
    // background glow
    el('div', { style: { position: 'absolute', inset: 0,
      background: 'radial-gradient(70% 130% at 85% -10%, var(--accent-soft), transparent 60%), radial-gradient(60% 120% at 0% 120%, var(--accent-soft), transparent 60%)' } }),
    // right side decoration: 3 preview tiles
    el('div', { style: { position: 'absolute', right: 28, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 10, alignItems: 'center' } },
      [{ s: 44, h: 1.45, r: '-4deg' }, { s: 128, h: 1.1, r: '2deg' }, { s: 88, h: 1.32, r: '-2deg' }].map((item, i) =>
        el('div', { key: i, style: { width: 88, aspectRatio: `1 / ${item.h}`, borderRadius: 10, overflow: 'hidden', position: 'relative', flexShrink: 0,
          transform: `rotate(${item.r})`, boxShadow: '0 8px 28px rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.12)' } },
          el('div', { style: { position: 'absolute', inset: 0, background: `radial-gradient(120% 120% at 20% 20%, hsl(${(item.s * 97 + 23) % 360} 92% 64%), transparent 50%), radial-gradient(120% 120% at 85% 80%, hsl(${(item.s * 61 + 170) % 360} 88% 56%), transparent 50%), linear-gradient(155deg, hsl(${(item.s * 43 + 290) % 360} 72% 18%), hsl(${(item.s * 61 + 200) % 360} 68% 10%))` } })))),
    el('div', { style: { position: 'relative', maxWidth: 600 } },
      el('div', { className: 'tag', style: { marginBottom: 14, background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent)', height: 26, whiteSpace: 'nowrap' } },
        el(Icon, { name: 'sparkle', size: 13 }), 'SCARECROWAI · ', lang === 'cn' ? '智能绘图与视频' : 'AI image & video'),
      el('h1', { className: 'font-display', style: { fontSize: 'clamp(26px, 3.6vw, 44px)', fontWeight: 800, lineHeight: 1.06, margin: '0 0 12px' } },
        el('span', { className: 'gtext' }, tr(lang, 'hero.tagline'))),
      el('p', { style: { fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.55, margin: '0 0 22px', maxWidth: 480 } }, tr(lang, 'hero.sub')),
      el('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } },
        el('button', { className: 'btn btn-primary', style: { height: 44, padding: '0 22px', fontSize: 14.5 }, onClick: onCreate },
          el(Icon, { name: 'sparkle', size: 16 }), tr(lang, 'nav.create')),
        el('button', { className: 'btn btn-ghost', style: { height: 44, padding: '0 18px', fontSize: 14.5 } },
          el(Icon, { name: 'fire', size: 15 }), tr(lang, 'sort.top')),
      ),
    ),
  );
}

function ExplorePage({ lang, onOpen, onCreate }) {
  const [cat, setCat] = useS('all');
  const [sort, setSort] = useS('hot');
  const [media, setMedia] = useS('all'); // all | image | video

  const list = useM(() => {
    let xs = ARTWORKS.slice();
    if (cat === 'video') xs = xs.filter((a) => a.type === 'video');
    else if (cat !== 'all') xs = xs.filter((a) => a.cat === cat);
    if (media !== 'all') xs = xs.filter((a) => a.type === media);
    if (sort === 'hot' || sort === 'top') xs.sort((a, b) => b.likes - a.likes);
    else xs.reverse();
    return xs;
  }, [cat, sort, media]);

  const sorts = [['hot', 'sort.hot'], ['new', 'sort.new'], ['top', 'sort.top']];

  return el('div', { style: { maxWidth: 1320, margin: '0 auto', padding: '26px 22px 80px' } },
    el(Hero, { lang, onCreate }),

    // category chips
    el('div', { className: 'scroll', style: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 16, scrollbarWidth: 'none' } },
      CATEGORIES.map((c) => el('button', { key: c, className: 'chip', 'data-active': cat === c, onClick: () => setCat(c) },
        c === 'all' ? el(Icon, { name: 'grid', size: 13 }) : null,
        c === 'video' ? el(Icon, { name: 'video', size: 13 }) : null,
        tr(lang, 'cat.' + c)))),

    // sort + filter row
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' } },
      // sort pills
      el('div', { style: { display: 'flex', gap: 3, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: 3 } },
        sorts.map(([v, k]) => el('button', { key: v, onClick: () => setSort(v),
          style: { height: 30, padding: '0 14px', borderRadius: 'var(--radius-pill)', fontSize: 13.5, fontWeight: 600, transition: 'all .15s',
            color: sort === v ? 'var(--on-accent)' : 'var(--text-faint)',
            background: sort === v ? 'var(--accent)' : 'transparent' } },
          tr(lang, k)))),
      // stats
      el('span', { style: { fontSize: 12.5, color: 'var(--text-faint)', marginLeft: 4 } }, `${list.length}${lang === 'cn' ? ' 件作品' : ' works'}`),
      // media filter
      el('div', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--radius-sm)', background: 'var(--panel)', border: '1px solid var(--border)' } },
        [['all', 'grid', lang === 'cn' ? '全部' : 'All'], ['image', 'image', tr(lang, 'tab.image')], ['video', 'video', tr(lang, 'tab.video')]].map(([v, ic, label]) =>
          el('button', { key: v, onClick: () => setMedia(v),
            style: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', borderRadius: 'calc(var(--radius-sm) - 3px)', fontSize: 12.5, fontWeight: 600,
              color: media === v ? 'var(--on-accent)' : 'var(--text-dim)', background: media === v ? 'var(--accent)' : 'transparent', transition: 'all .15s' } },
            el(Icon, { name: ic, size: 13 }), label)))),

    // masonry
    el('div', { className: 'fade-up', key: cat + sort + media },
      el(Masonry, { items: list, lang, onOpen })),
  );
}

window.ExplorePage = ExplorePage;
