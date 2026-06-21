/* SCARECROWAI 流光 — 模型市场 Models */
(function () {
  const H = window.HOME, FX = window.FX;
  const { MODELS, fmt } = H;
  const { $, $$ } = FX;

  let state = { base: '全部', q: '', sort: 'runs' };
  const BASES = ['全部', 'SDXL', 'Flux', '可灵 Kling', 'ComfyUI'];
  const baseOf = m => m.base;

  function renderFilters() {
    $('#base-filters').innerHTML = BASES.map(b =>
      `<button class="f${b === state.base ? ' on' : ''}" data-b="${b}">${b}</button>`).join('');
  }

  function apply() {
    let list = MODELS.slice();
    if (state.base !== '全部') list = list.filter(m => baseOf(m) === state.base || (state.base === '可灵 Kling' && /Kling/.test(m.base)));
    if (state.q) {
      const q = state.q.toLowerCase();
      list = list.filter(m => (m.name + m.base + m.tags.join('')).toLowerCase().includes(q));
    }
    if (state.sort === 'runs') list.sort((a, b) => b.runs - a.runs);
    if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    if (state.sort === 'new') list = list.slice().reverse();
    return list;
  }

  function render() {
    const list = apply();
    $('#models').innerHTML = list.map((m, i) => `
      <article class="mcard reveal" style="--rd:${(i % 4) * 0.04}s">
        <div class="mcard-cover" style="background:${m.c}">
          ${m.badge === 'hot' ? '<span class="mbadge hot">HOT</span>' : ''}
          ${m.badge === 'new' ? '<span class="mbadge new">NEW</span>' : ''}
          <span class="mcard-use">立即生成 →</span>
        </div>
        <div class="mcard-body">
          <div class="mrow"><span class="mname">${m.name}</span><span class="mver mono">${m.ver}</span></div>
          <div class="mtags">${m.tags.map(t => `<span>${t}</span>`).join('')}</div>
          <div class="mfoot"><span class="mbase mono">${m.base}</span><span class="mruns">${fmt(m.runs)} 次运行</span></div>
        </div>
      </article>`).join('');
    $('#empty').style.display = list.length ? 'none' : 'block';
    FX.reveal($('#models'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('models');
    renderFilters();
    render();
    FX.reveal();
    if (window.FluxField) window.FluxField.mount($('#flux'), { hue: 0.8, speed: 0.9, scale: 1.2, variant: 2 });

    $('#base-filters').addEventListener('click', e => {
      const b = e.target.closest('.f'); if (!b) return;
      state.base = b.dataset.b;
      $$('#base-filters .f').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    let t;
    $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 180); });
  });
})();
