/* SCARECROWAI 流光 — 作品广场 Explore */
(function () {
  const H = window.HOME, FX = window.FX;
  const { ARTWORKS, CATEGORIES } = H;
  const { $, $$ } = FX;

  let state = { cat: '全部', type: 'all', q: '', sort: 'hot' };

  function renderFilters() {
    $('#cat-filters').innerHTML = CATEGORIES.map((c, i) =>
      `<button class="f${c === state.cat ? ' on' : ''}" data-c="${c}">${c}</button>`).join('');
  }

  function apply() {
    let list = ARTWORKS.slice();
    if (state.type !== 'all') list = list.filter(a => a.type === state.type);
    if (state.cat !== '全部') list = list.filter(a => state.cat === '视频' ? a.type === 'video' : a.cat === state.cat);
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter(a => (a.title + a.author + a.model + a.cat).toLowerCase().includes(q));
    }
    if (state.sort === 'like' || state.sort === 'hot') list.sort((a, b) => b.likes - a.likes);
    if (state.sort === 'new') list = list.slice().reverse();
    return list;
  }

  function render() {
    const list = apply();
    const feed = $('#feed');
    // a fuller wall by repeating when few
    const items = list.length && list.length < 10 ? list.concat(list) : list;
    feed.innerHTML = items.map((a, i) => FX.tileHTML(a, ARTWORKS.indexOf(a), (i % 5) * 0.03)).join('');
    FX.bindTiles(feed, ARTWORKS);
    $('#empty').style.display = list.length ? 'none' : 'block';
    FX.reveal(feed);
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('explore');
    renderFilters();
    render();
    FX.liveCounter($('#liveNum'), 8902);
    FX.reveal();
    if (window.FluxField) window.FluxField.mount($('#flux'), { hue: 2.4, speed: 0.8, scale: 1.1, variant: 0 });

    $('#cat-filters').addEventListener('click', e => {
      const b = e.target.closest('.f'); if (!b) return;
      state.cat = b.dataset.c;
      $$('#cat-filters .f').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    $('#type-seg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.type = b.dataset.t;
      $$('#type-seg button').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    let t;
    $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 180); });
  });
})();
