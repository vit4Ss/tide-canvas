/* global React, Icon, Avatar, Cover, tr, MODELS, BASE_FILTERS, fmt */
// SCARECROWAI — Model market / 模型市场
const { createElement: m, useState: useMS, useMemo: useMM } = React;

const TYPE_LABEL = { ckpt: 'market.ckpt', lora: 'market.lora', flow: 'market.flow' };
const TYPE_ICON = { ckpt: 'layers', lora: 'bolt', flow: 'filter' };

function ModelCard({ mod, lang, onUse }) {
  const art = { c: mod.c, type: 'image' };
  return m('div', { className: 'mcard', onClick: () => onUse(mod) },
    m('div', { className: 'mcard-cover' },
      m(Cover, { art }),
      mod.badge ? m('span', { className: 'badge-corner ' + (mod.badge === 'hot' ? 'badge-hot' : 'badge-new') },
        mod.badge === 'hot' ? m(Icon, { name: 'fire', size: 12 }) : null,
        tr(lang, 'badge.' + mod.badge)) : null,
      m('span', { style: { position: 'absolute', top: 11, right: 11, display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 24, padding: '0 9px', borderRadius: 'var(--radius-xs)', fontSize: 11, fontWeight: 700,
        background: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(6px)' } },
        m(Icon, { name: TYPE_ICON[mod.type], size: 12 }), tr(lang, TYPE_LABEL[mod.type])),
      m('button', { className: 'mcard-use', onClick: (e) => { e.stopPropagation(); onUse(mod); } },
        m(Icon, { name: 'sparkle', size: 15 }), tr(lang, 'market.use')),
    ),
    m('div', { style: { padding: '13px 14px 14px' } },
      m('div', { style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 } },
        m('span', { className: 'tag', style: { color: 'var(--accent)', borderColor: 'var(--accent-soft)', background: 'var(--accent-soft)', fontWeight: 600 } }, mod.base),
        m('span', { style: { fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, whiteSpace: 'nowrap' } }, tr(lang, 'market.ver') + ' ' + mod.ver),
      ),
      m('h3', { style: { fontSize: 15.5, fontWeight: 700, margin: '0 0 10px', lineHeight: 1.25 } }, lang === 'cn' ? mod.nameCn : mod.nameEn),
      m('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 } },
        mod.tags.slice(0, 3).map((t) => m('span', { key: t, className: 'tag' }, t))),
      m('div', { style: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 11, borderTop: '1px solid var(--border)' } },
        m(Avatar, { name: mod.author, size: 22 }),
        m('span', { style: { fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mod.author),
        m('span', { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 } },
          m(Icon, { name: 'bolt', size: 13 }), m('span', { className: 'tnum' }, fmt(mod.runs))),
        m('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 } },
          m(Icon, { name: 'heart', size: 13 }), m('span', { className: 'tnum' }, fmt(mod.likes))),
      ),
    ),
  );
}

function MarketPage({ lang, onUse }) {
  const [type, setType] = useMS('all');
  const [base, setBase] = useMS('all');
  const [sort, setSort] = useMS('dl');

  const list = useMM(() => {
    let xs = MODELS.slice();
    if (type !== 'all') xs = xs.filter((x) => x.type === type);
    if (base !== 'all') xs = xs.filter((x) => x.base === base);
    if (sort === 'dl') xs.sort((a, b) => b.runs - a.runs);
    else if (sort === 'like') xs.sort((a, b) => b.likes - a.likes);
    else xs.reverse();
    return xs;
  }, [type, base, sort]);

  const types = [['all', 'market.all', 'grid'], ['ckpt', 'market.ckpt', 'layers'], ['lora', 'market.lora', 'bolt'], ['flow', 'market.flow', 'filter']];
  const sorts = [['dl', 'market.sort.dl'], ['like', 'market.sort.like'], ['new', 'market.sort.new']];

  return m('div', { style: { maxWidth: 1320, margin: '0 auto', padding: '30px 22px 80px' } },
    // header
    m('div', { style: { marginBottom: 24 } },
      m('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 } },
        m('div', { style: { width: 3, height: 20, borderRadius: 2, background: 'var(--grad)', flex: 'none' } }),
        m('h1', { className: 'font-display', style: { fontSize: 28, fontWeight: 800, margin: 0 } }, tr(lang, 'nav.market'))),
  m('p', { style: { fontSize: 14.5, color: 'var(--text-dim)', margin: '4px 0 0' } },
              lang === 'cn' ? '海量社区模型，一键调用你的中转站算力生成' : 'Community models — generate instantly through your relay'),
    ),

    // type tabs
    m('div', { style: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' } },
      types.map(([v, k, ic]) => m('button', { key: v, className: 'chip', 'data-active': type === v, onClick: () => setType(v), style: { height: 38, padding: '0 16px' } },
        m(Icon, { name: ic, size: 15 }), tr(lang, k)))),

    // base filter + sort
    m('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' } },
      m('span', { style: { fontSize: 12.5, color: 'var(--text-faint)', fontWeight: 600 } }, tr(lang, 'market.base')),
      m('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        [['all', tr(lang, 'market.all')]].concat(BASE_FILTERS.map((b) => [b, b])).map(([v, label]) =>
          m('button', { key: v, onClick: () => setBase(v),
            style: { height: 30, padding: '0 12px', borderRadius: 'var(--radius-pill)', fontSize: 12.5, fontWeight: 600,
              color: base === v ? 'var(--text)' : 'var(--text-faint)', background: base === v ? 'var(--panel)' : 'transparent',
              border: '1px solid ' + (base === v ? 'var(--border-strong)' : 'transparent') } }, label))),
      m('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
        sorts.map(([v, k]) => m('button', { key: v, onClick: () => setSort(v),
          style: { height: 30, padding: '0 12px', borderRadius: 'var(--radius-pill)', fontSize: 12.5, fontWeight: 600,
            color: sort === v ? 'var(--accent)' : 'var(--text-faint)', background: sort === v ? 'var(--accent-soft)' : 'transparent' } },
          tr(lang, k)))),
    ),

    // grid
    m('div', { className: 'fade-up', key: type + base + sort,
      style: { display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' } },
      list.map((mod) => m(ModelCard, { key: mod.id, mod, lang, onUse }))),
  );
}

window.MarketPage = MarketPage;
