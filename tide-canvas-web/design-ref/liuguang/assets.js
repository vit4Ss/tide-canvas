/* SCARECROWAI 流光 — 资产 Assets page */
(function () {
  const H = window.HOME, FX = window.FX;
  const { ARTWORKS } = H;
  const { $, $$ } = FX;

  let filter = 'image';
  // build date-grouped buckets from artworks (repeat to fill)
  const pool = ARTWORKS.concat(ARTWORKS).concat(ARTWORKS);
  const GROUPS = [
    { date: '2 月 12 日', items: pool.slice(0, 4) },
    { date: '2 月 11 日', items: pool.slice(4, 22) },
    { date: '2 月 4 日', items: pool.slice(22, 34) },
    { date: '10 月 5 日', items: pool.slice(8, 18) },
  ];

  function cardHTML(a, i, star) {
    const isVid = a.type === 'video';
    return `<button class="as-card" type="button" data-idx="${ARTWORKS.indexOf(a)}" style="--rd:${(i % 8) * 0.02}s">
      <span class="cov" style="background:${a.c}"></span>
      <span class="pick"></span>
      ${star ? '<span class="star">★</span>' : ''}
      ${isVid ? '<span class="vbadge">▶</span>' : ''}
    </button>`;
  }

  function render() {
    const body = $('#assetBody');
    body.innerHTML = GROUPS.map(g => {
      const items = filter === 'video' ? g.items.filter(a => a.type === 'video')
        : filter === 'image' ? g.items.filter(a => a.type !== 'video')
        : [];
      if (!items.length) return '';
      const cards = items.map((a, i) => cardHTML(a, i, i === 1 || i === 9)).join('');
      return `<div class="asset-group"><div class="asset-date">${g.date}</div><div class="asset-grid">${cards}</div></div>`;
    }).join('');
    const empty = (filter === 'audio' || filter === 'doc');
    if (empty) body.innerHTML = `<div class="empty" style="padding:80px 0">该类型暂无资产 —— 生成后会归档到这里 ✦</div>`;
    body.querySelectorAll('.as-card').forEach(c => c.addEventListener('click', () => {
      const a = ARTWORKS[+c.dataset.idx]; if (a) FX.openWork(a);
    }));
    FX.reveal(body);
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('assets');
    render();
    $('#asset-filter').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.f;
      $$('#asset-filter button').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    $('#asset-tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#asset-tabs button').forEach(x => x.classList.toggle('on', x === b));
      if (b.dataset.t !== 'hist') { $('#assetBody').innerHTML = `<div class="empty" style="padding:80px 0">「${b.textContent.trim()}」面板 · 高保真原型</div>`; }
      else render();
    });
    $$('.asset-actions button').forEach(b => b.addEventListener('click', () => FX.toast(b.textContent.trim() + ' · 原型')));
  });
})();
