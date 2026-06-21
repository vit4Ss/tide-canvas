/* SCARECROWAI 流光 — 灵感 Inspiration page */
(function () {
  const H = window.HOME, FX = window.FX;
  const { ARTWORKS } = H;
  const { $, $$ } = FX;

  let tab = 'insp', q = '';

  function apply() {
    let list = ARTWORKS.slice();
    // 主题 = sort by likes (themed/curated), 提示词 keeps order; 灵感 = mixed (reverse for freshness)
    if (tab === 'theme') list.sort((a, b) => b.likes - a.likes);
    else if (tab === 'insp') list = list.concat(list.slice(0, 6));
    if (q) {
      const k = q.toLowerCase();
      list = list.filter(a => ((a.title || '') + (a.titleEn || '') + a.author + a.model + a.cat).toLowerCase().includes(k));
    }
    return list;
  }

  function render() {
    const list = apply();
    const feed = $('#feed');
    feed.innerHTML = list.map((a, i) => FX.tileHTML(a, ARTWORKS.indexOf(a), (i % 5) * 0.03)).join('');
    FX.bindTiles(feed, ARTWORKS);
    FX.reveal(feed);
    $('#inspEmpty').style.display = list.length ? 'none' : 'block';
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('insp');
    render();

    $('#insp-tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      tab = b.dataset.t;
      $$('#insp-tabs button').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    let t;
    $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); render(); }, 180); });
  });
})();
