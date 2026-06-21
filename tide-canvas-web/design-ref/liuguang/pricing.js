/* SCARECROWAI 流光 — 定价 Pricing */
(function () {
  const H = window.HOME, FX = window.FX;
  const { PLANS, CMP, FAQS } = H;
  const { $, $$ } = FX;
  let cycle = 'yr';

  function renderPlans() {
    $('#plans').innerHTML = PLANS.map((p, i) => {
      const price = cycle === 'yr' ? p.yr : p.mo;
      const per = p.mo === 0 ? '永久免费' : (cycle === 'yr' ? '/ 月（年付）' : '/ 月');
      const num = p.mo === 0 ? '¥0' : '¥' + price;
      return `<div class="plan ${p.feat ? 'feat' : ''} reveal" style="--rd:${i * 0.06}s">
        ${p.feat ? '<span class="plan-tag">最受欢迎</span>' : ''}
        <div class="plan-name">${p.name}</div>
        <div class="plan-desc">${p.desc}</div>
        <div class="plan-price"><span class="num">${num}</span><span class="per">${per}</span></div>
        <button class="plan-cta ${p.feat ? 'solid' : 'ghost'}" data-toast="${p.cta} · 高保真原型">${p.cta}</button>
        <ul class="plan-feats">${p.items.map(it => `<li><span class="ck">✓</span><span>${it}</span></li>`).join('')}</ul>
      </div>`;
    }).join('');
    FX.reveal($('#plans'));
  }

  function renderCmp() {
    const head = `<tr><th>能力</th><th>体验版</th><th>创作者 Pro</th><th>企业版</th></tr>`;
    const rows = CMP.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map(c =>
      `<td class="${c === '✓' ? 'yes' : c === '—' ? 'no' : ''}">${c}</td>`).join('')}</tr>`).join('');
    $('#cmp').innerHTML = head + rows;
  }

  function renderFaq() {
    const faqs = H.FAQS.filter((_, i) => i >= 2).concat(H.FAQS.slice(0, 2));
    $('#faq').innerHTML = faqs.map((f, i) => `
      <div class="faq-item reveal${i === 0 ? ' open' : ''}" style="--rd:${(i % 4) * 0.04}s">
        <button class="faq-q" type="button"><span>${f.q}</span><span class="faq-ic">+</span></button>
        <div class="faq-a"><div class="faq-a-in">${f.a}</div></div>
      </div>`).join('');
    const items = $$('#faq .faq-item');
    const setH = it => { const a = $('.faq-a', it); a.style.maxHeight = it.classList.contains('open') ? a.scrollHeight + 'px' : '0px'; };
    items.forEach(it => {
      $('.faq-q', it).addEventListener('click', () => {
        const open = it.classList.contains('open');
        items.forEach(o => { o.classList.remove('open'); setH(o); });
        if (!open) { it.classList.add('open'); setH(it); }
      });
      setH(it);
    });
    FX.reveal($('#faq'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('pricing');
    renderPlans(); renderCmp(); renderFaq();
    FX.reveal();
    $('#bill').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      cycle = b.dataset.b;
      $$('#bill button').forEach(x => x.classList.toggle('on', x === b));
      renderPlans();
    });
  });
})();
