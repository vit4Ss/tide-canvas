/* SCARECROWAI 流光首页 — page render (uses window.FX shared shell) */
(function () {
  const H = window.HOME, FX = window.FX;
  const { ARTWORKS, MODELS, CAPS, STEPS, CREATORS, TESTIMONIALS, FAQS, CATEGORIES, HERO_PROMPTS, PLANS, fmt } = H;
  const { $, $$ } = FX;

  /* ---- capabilities bento ---- */
  function renderCaps(mount) {
    mount.innerHTML = CAPS.map((c, i) => `
      <article class="cap reveal-scale ${c.size}" data-toast="${c.t} · 前往创作台" style="--rd:${(i % 4) * 0.05}s">
        <div class="cap-cover" style="background:${c.c}"></div>
        <div class="cap-scrim"></div>
        <span class="cap-ico">${c.ico}</span>
        <span class="cap-kick">${i < 2 ? 'CORE' : 'TOOL'}</span>
        <div class="cap-body">
          <h3>${c.t}</h3>
          <p>${c.d}</p>
          <span class="cap-go">试一下 →</span>
        </div>
      </article>`).join('');
  }

  /* ---- infinite canvas (node graph showcase) ---- */
  function renderInfiniteCanvas() {
    const stage = $('#ic-stage'); if (!stage) return;
    const mesh = H.mesh;
    const PROMPT_A = 'A stylized, low-angle studio shot from a mirror placed on the floor. The same short-haired model leans over the mirror, looking down with a slightly surprised, open-mouthed expression. The silver Y2K sunglasses are shown from below, emphasizing their reflective frame…';
    const PROMPT_B = 'An extreme studio close-up of the model\'s face looking directly at the camera. She uses thumb and index finger, with silver metallic nail polish, to delicately lift the nose bridge of the Y2K silver sunglasses. The background is a muted grey void with precise rim lighting…';
    // nodes: [class, x, y, w, innerHTML]
    const cover = (h, hgt) => '<div class="ic-img" style="height:' + hgt + 'px; background:' + mesh(h[0], h[1], h[2]) + '"></div>';
    const nodes = [
      ['<div class="ic-cap"><span class="dot"></span>Image</div>' + cover([210, 230, 245], 132), 40, 150, 196],
      ['<div class="ic-cap"><span class="dot"></span>Prompt</div><p class="ic-prompt-tx">' + PROMPT_A + '</p>', 40, 350, 196],
      ['<div class="ic-cap"><span class="dot"></span>Image</div><div class="ic-grid2">' +
        cover([300, 260, 18], 116) + cover([8, 350, 28], 116) + cover([110, 78, 150], 116) + cover([255, 230, 290], 116) +
        '</div>', 348, 62, 392],
      ['<div class="ic-cap"><span class="dot"></span>Prompt</div><p class="ic-prompt-tx">' + PROMPT_B + '</p>', 384, 452, 348],
      ['<div class="ic-cap video"><span class="dot"></span>Video</div>' + cover([20, 42, 8], 300), 846, 132, 226],
    ];
    let html = '<svg class="ic-wires" viewBox="0 0 1120 600" preserveAspectRatio="none"></svg>';
    nodes.forEach((n, i) => {
      html += '<div class="ic-node" style="left:' + n[1] + 'px; top:' + n[2] + 'px; width:' + n[3] + 'px; --nd:' + (0.15 + i * 0.12).toFixed(2) + 's">' + n[0] + '</div>';
    });
    stage.innerHTML = html;

    // wires between node ports (stage coords)
    const wires = [
      [236, 232, 348, 240], // A → grid (left)
      [236, 430, 348, 300], // B → grid (left lower)
      [740, 240, 846, 290], // grid (right) → video
      [732, 512, 846, 340], // D → video
    ];
    const svg = stage.querySelector('.ic-wires');
    const NS = 'http://www.w3.org/2000/svg';
    wires.forEach(([x1, y1, x2, y2], i) => {
      const dx = Math.max(40, (x2 - x1) * 0.6);
      const d = 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'ic-wire');
      const len = Math.hypot(x2 - x1, y2 - y1) + dx;
      p.style.setProperty('--len', Math.round(len * 1.3));
      p.style.setProperty('--wd', (0.5 + i * 0.18).toFixed(2) + 's');
      svg.appendChild(p);
      [[x1, y1], [x2, y2]].forEach(([cx, cy]) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 4); c.setAttribute('class', 'ic-port');
        svg.appendChild(c);
      });
    });

    // scale the fixed 1120-wide stage to fit the frame
    const frame = stage.parentElement;
    function fit() {
      const w = frame.clientWidth;
      if (!w) { requestAnimationFrame(fit); return; }   // wait for layout; never scale(0)
      const s = Math.min(1, w / 1120);
      stage.style.transform = 'scale(' + s + ')';
      frame.style.height = (600 * s) + 'px';
    }
    requestAnimationFrame(fit);
    fit();
    new ResizeObserver(fit).observe(frame);
    window.addEventListener('load', fit);

    // trigger draw/reveal when scrolled in
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (e.isIntersecting) { frame.classList.add('in'); io.disconnect(); }
      }), { threshold: 0.25 });
      io.observe(frame);
    } else { frame.classList.add('in'); }
  }

  /* ---- 3-step ---- */
  function renderSteps(mount) {
    mount.innerHTML = STEPS.map((s, i) => `
      <article class="step reveal" style="--rd:${i * 0.08}s">
        <div class="step-ico">${s.ico}</div>
        <h3>${s.t}</h3>
        <p>${s.d}</p>
        <span class="step-line"></span>
      </article>`).join('');
  }

  /* ---- home feed (filterable preview) ---- */
  const FILTERS = ['全部', '插画', '动漫', '摄影', '3D', '人像', '科幻', '国风', '视频'];
  function renderHomeFilters(mount, onPick) {
    mount.innerHTML = FILTERS.map((f, i) => `<button class="f${i === 0 ? ' on' : ''}" data-f="${f}">${f}</button>`).join('');
    mount.addEventListener('click', e => {
      const b = e.target.closest('.f'); if (!b) return;
      $$('.f', mount).forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      onPick(b.dataset.f);
    });
  }
  function feedFor(cat) {
    let pool = ARTWORKS;
    if (cat && cat !== '全部') pool = ARTWORKS.filter(a => cat === '视频' ? a.type === 'video' : a.cat === cat);
    if (!pool.length) pool = ARTWORKS;
    return pool;
  }
  let livePool = ARTWORKS, cfRaf = null;
  function renderFeed(mount, cat) {
    const pool = feedFor(cat);
    livePool = pool;
    // need a decent run of cards; repeat short pools, then duplicate once so
    // the marquee loops seamlessly (translateX -50% == one full set).
    let base = pool.slice();
    while (base.length < 8) base = base.concat(pool);
    const seq = base.concat(base);
    mount.className = 'coverflow';
    mount.innerHTML =
      '<div class="cf-viewport"><div class="cf-track">' +
      seq.map((a) => FX.tileHTML(a, ARTWORKS.indexOf(a), 0)).join('') +
      '</div></div>';
    $$('.tile', mount).forEach((t) => t.classList.add('in'));
    FX.bindTiles(mount, ARTWORKS);
    // duration scales with how many cards so speed stays steady
    const track = mount.querySelector('.cf-track');
    track.style.setProperty('--dur', Math.round(seq.length * 2.6) + 's');
    startCoverflow(mount);
  }
  function startCoverflow(mount) {
    if (cfRaf) { cancelAnimationFrame(cfRaf); cfRaf = null; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const vp = mount.querySelector('.cf-viewport');
    const tiles = $$('.tile', mount);
    function frame() {
      const vr = vp.getBoundingClientRect();
      const cx = vr.left + vr.width / 2;
      const reach = vr.width * 0.78;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const r = t.getBoundingClientRect();
        if (r.right < vr.left - 160 || r.left > vr.right + 160) { t.style.opacity = '0.12'; t.classList.remove('cf-focus'); continue; }
        const tc = r.left + r.width / 2;
        const off = Math.max(-2, Math.min(2, (tc - cx) / reach));     // signed distance
        const k = Math.max(0, 1 - Math.abs(off));
        const e = k * k * (3 - 2 * k);                                // smoothstep, 1 at center
        const rot = -off * 52;                                        // strong coverflow tilt
        const tz = (e * 240 - 200).toFixed(1);                        // deep tunnel: far recedes, center leaps forward
        const ty = ((1 - e) * 14).toFixed(1);                         // sides sink slightly
        const scale = (0.6 + 0.62 * e).toFixed(3);                    // dramatic center dominance
        t.style.transform = 'perspective(1500px) translateY(' + ty + 'px) translateZ(' + tz + 'px) rotateY(' + rot.toFixed(1) + 'deg) scale(' + scale + ')';
        t.style.opacity = (0.3 + 0.7 * e).toFixed(3);
        t.style.filter = e < 0.5 ? 'brightness(' + (0.5 + e).toFixed(2) + ')' : 'none';
        t.style.zIndex = String(Math.round(e * 100));
        t.classList.toggle('cf-focus', e > 0.9);
      }
      cfRaf = requestAnimationFrame(frame);
    }
    cfRaf = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (cfRaf) { cancelAnimationFrame(cfRaf); cfRaf = null; } }
      else if (!cfRaf) cfRaf = requestAnimationFrame(frame);
    });
  }

  /* ---- creators leaderboard ---- */
  function renderCreators(mount) {
    mount.innerHTML = CREATORS.map((c, i) => `
      <div class="lb-row reveal" style="--rd:${(i % 3) * 0.05}s">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-av" style="background:${c.c}"></span>
        <div class="lb-main"><div class="lb-name">${c.name}</div><div class="lb-sub">${c.tag} · ${c.works} 作品</div></div>
        <button class="lb-foll" type="button">+ 关注</button>
      </div>`).join('');
    $$('.lb-foll', mount).forEach(b => b.addEventListener('click', () => {
      const on = b.classList.toggle('on');
      b.textContent = on ? '✓ 已关注' : '+ 关注';
    }));
  }

  /* ---- models preview ---- */
  function renderModels(mount) {
    mount.innerHTML = MODELS.map((m, i) => `
      <article class="mcard reveal" style="--rd:${(i % 4) * 0.05}s">
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
  }

  /* ---- testimonials ---- */
  function renderQuotes(mount) {
    mount.innerHTML = TESTIMONIALS.map((t, i) => `
      <figure class="quote reveal" style="--rd:${(i % 3) * 0.05}s">
        <div class="quote-stars">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)}</div>
        <p>${t.q}</p>
        <figcaption class="quote-by">
          <span class="quote-av" style="background:${t.c}"></span>
          <div><div class="quote-n">${t.name}</div><div class="quote-r">${t.role}</div></div>
        </figcaption>
      </figure>`).join('');
  }

  /* ---- pricing (home) ---- */
  function renderPricing() {
    const mount = $('#home-plans'); if (!mount) return;
    let cycle = 'yr';
    function draw() {
      mount.innerHTML = PLANS.map((p, i) => {
        const price = cycle === 'yr' ? p.yr : p.mo;
        const per = p.mo === 0 ? '永久免费' : (cycle === 'yr' ? '/ 月（年付）' : '/ 月');
        const num = p.mo === 0 ? '¥0' : '¥' + price;
        const href = p.mo === 0 ? '创作台.html' : '定价.html';
        return `<div class="plan ${p.feat ? 'feat' : ''} reveal" style="--rd:${i * 0.06}s">
          ${p.feat ? '<span class="plan-tag">最受欢迎</span>' : ''}
          <div class="plan-name">${p.name}</div>
          <div class="plan-desc">${p.desc}</div>
          <div class="plan-price"><span class="num">${num}</span><span class="per">${per}</span></div>
          <a class="plan-cta ${p.feat ? 'solid' : 'ghost'}" href="${href}">${p.cta}</a>
          <ul class="plan-feats">${p.items.map((it) => `<li><span class="ck">✓</span><span>${it}</span></li>`).join('')}</ul>
        </div>`;
      }).join('');
      FX.reveal(mount);
    }
    draw();
    const bill = $('#home-bill');
    if (bill) bill.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      cycle = b.dataset.b;
      $$('#home-bill button').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    });
  }

  /* ---- faq ---- */
  function renderFaq(mount) {
    mount.innerHTML = FAQS.map((f, i) => `
      <div class="faq-item reveal${i === 0 ? ' open' : ''}" style="--rd:${(i % 4) * 0.04}s">
        <button class="faq-q" type="button"><span>${f.q}</span><span class="faq-ic">+</span></button>
        <div class="faq-a"><div class="faq-a-in">${f.a}</div></div>
      </div>`).join('');
    const items = $$('.faq-item', mount);
    function setH(it) {
      const a = $('.faq-a', it);
      a.style.maxHeight = it.classList.contains('open') ? a.scrollHeight + 'px' : '0px';
    }
    items.forEach(it => {
      $('.faq-q', it).addEventListener('click', () => {
        const wasOpen = it.classList.contains('open');
        items.forEach(o => { o.classList.remove('open'); setH(o); });
        if (!wasOpen) { it.classList.add('open'); setH(it); }
      });
      setH(it);
    });
  }

  /* ---- continuous background presets (user-selectable) ----
     One fixed shader field for the whole page. A "preset" sets the colour
     family (base hue + how far it sweeps as you scroll) plus motion feel.
     Switching presets retargets the field, which eases over smoothly. */
  const SECTIONS = [
    { sel: '.hero',       n: 0.00, flow: [0.03, 0.02] },
    { sel: '#caps-sec',   n: 0.16, flow: [0.05, 0.00] },
    { sel: '#studio-sec', n: 0.34, flow: [0.04, 0.02] },
    { sel: '#feed-sec',   n: 0.55, flow: [0.00, -0.04] },
    { sel: '#faq-sec',    n: 0.82, flow: [0.03, 0.00] },
    { sel: '#cta-sec',    n: 1.00, flow: [0.05, 0.04] },
  ];
  const PRESETS = {
    aurora:  { label: '极光', sub: '蓝 · 紫 · 品红', base: 6.15, spread: 1.95, speed: 1.0,  scale: 1.05, intensity: 1.0,  sw: 'linear-gradient(120deg,#3b53d6,#9b3ad0,#d8367f)' },
    nebula:  { label: '星云', sub: '深紫 · 洋红', base: 0.55, spread: 1.15, speed: 0.7,  scale: 1.38, intensity: 1.05, sw: 'linear-gradient(120deg,#7a2bd0,#b51e9c,#e0357a)' },
    ocean:   { label: '深海', sub: '青 · 蓝绿', base: 4.85, spread: 1.25, speed: 0.9,  scale: 1.12, intensity: 0.98, sw: 'linear-gradient(120deg,#1c8f9c,#1aa6c0,#2f7fd0)' },
    ember:   { label: '熔岩', sub: '玫红 · 琥珀', base: 1.75, spread: 1.10, speed: 1.1,  scale: 1.0,  intensity: 1.05, sw: 'linear-gradient(120deg,#d8367f,#d66a3c,#d59a1f)' },
    verdant: { label: '苔原', sub: '黄绿 · 翠', base: 3.25, spread: 1.25, speed: 0.8,  scale: 1.18, intensity: 1.0,  sw: 'linear-gradient(120deg,#8fa11a,#5aa83c,#1f9c7a)' },
    ink:     { label: '水墨', sub: '极简 · 幽蓝', base: 6.05, spread: 0.45, speed: 0.42, scale: 0.92, intensity: 0.62, sw: 'linear-gradient(120deg,#3a4170,#5a4a86,#6d6f9c)' },
  };
  const PRESET_ORDER = ['aurora', 'nebula', 'ocean', 'ember', 'verdant', 'ink'];
  const PRESET_KEY = 'flux_bg_preset';
  let curPreset = (() => { try { return PRESETS[localStorage.getItem(PRESET_KEY)] ? localStorage.getItem(PRESET_KEY) : 'aurora'; } catch (e) { return 'aurora'; } })();

  function moodAt(t) {
    // t = 0..1 down the page; interpolate flow between adjacent sections
    const p = PRESETS[curPreset];
    let i = 0; while (i < SECTIONS.length - 1 && t > SECTIONS[i + 1].n) i++;
    const a = SECTIONS[i], b = SECTIONS[Math.min(i + 1, SECTIONS.length - 1)];
    const span = Math.max(0.0001, b.n - a.n);
    const k = Math.max(0, Math.min(1, (t - a.n) / span));
    const fx = a.flow[0] + (b.flow[0] - a.flow[0]) * k;
    const fy = a.flow[1] + (b.flow[1] - a.flow[1]) * k;
    return { hue: p.base + t * p.spread, speed: p.speed, scale: p.scale, intensity: p.intensity * 0.78, flow: [fx, fy] };
  }
  function bindScrollMood(handle) {
    const nodes = SECTIONS.map((s) => ({ s, el: document.querySelector(s.sel) })).filter((x) => x.el);
    let ticking = false;
    function update() {
      ticking = false;
      const mid = window.scrollY + window.innerHeight * 0.42;
      const centers = nodes.map(({ s, el }) => {
        const r = el.getBoundingClientRect();
        return { n: s.n, c: window.scrollY + r.top + r.height / 2 };
      });
      let i = 0; while (i < centers.length - 1 && mid > centers[i + 1].c) i++;
      const a = centers[i], b = centers[Math.min(i + 1, centers.length - 1)];
      const span = Math.max(1, b.c - a.c);
      const k = Math.max(0, Math.min(1, (mid - a.c) / span));
      handle.setMood(moodAt(a.n + (b.n - a.n) * k));
    }
    window.__fluxUpdate = update;
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function buildBgSwitcher() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;
    const holder = document.createElement('div');
    holder.className = 'bg-nav';
    holder.innerHTML =
      '<button class="icbtn bg-nav-btn" title="背景流光" aria-label="切换背景"><span class="bg-orb"></span></button>' +
      '<div class="bg-nav-pop"><div class="bg-switch-head">流光背景</div><div class="bg-switch-grid"></div></div>';
    const anchor = navRight.querySelector('.vip');
    navRight.insertBefore(holder, anchor || navRight.firstChild);
    const grid = holder.querySelector('.bg-switch-grid');
    PRESET_ORDER.forEach((key) => {
      const p = PRESETS[key];
      const b = document.createElement('button');
      b.className = 'bg-opt'; b.dataset.key = key;
      b.innerHTML = '<span class="bg-opt-sw" style="background:' + p.sw + '"></span><span class="bg-opt-tx"><b>' + p.label + '</b><i>' + p.sub + '</i></span>';
      b.addEventListener('click', () => applyPreset(key));
      grid.appendChild(b);
    });
    const toggle = holder.querySelector('.bg-nav-btn');
    toggle.addEventListener('click', (e) => { e.stopPropagation(); holder.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!holder.contains(e.target)) holder.classList.remove('open'); });
    syncSwitcher();
    return holder;
  }
  function syncSwitcher() {
    const orb = document.querySelector('.bg-orb');
    if (orb) orb.style.background = PRESETS[curPreset].sw;
    document.querySelectorAll('.bg-opt').forEach((b) => b.setAttribute('aria-current', b.dataset.key === curPreset));
  }
  function applyPreset(key) {
    if (!PRESETS[key]) return;
    curPreset = key;
    try { localStorage.setItem(PRESET_KEY, key); } catch (e) {}
    syncSwitcher();
    if (window.__fluxUpdate) window.__fluxUpdate();
  }

  /* ---- boot ---- */
  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('home');
    renderCaps($('#caps'));
    renderInfiniteCanvas();
    renderHomeFilters($('#home-filters'), (cat) => renderFeed($('#feed'), cat));
    renderFeed($('#feed'), '全部');
    FX.renderMarquee($('#marquee'));
    renderFaq($('#faq'));
    renderPricing();
    FX.typeLoop($('#typed'), HERO_PROMPTS);
    FX.liveCounter($('#liveNum'), 1240);
    FX.reveal();
    if (window.FluxField) {
      const init = moodAt(0);
      const bg = window.FluxField.mount($('#flux-bg'), { hue: init.hue, speed: init.speed, scale: init.scale, intensity: init.intensity, flow: init.flow, variant: 0, mouse: true, res: 0.7 });
      if (bg && bg.setMood) { bindScrollMood(bg); buildBgSwitcher(); }
    }

    // hero parallax
    const hero = $('#heroInner');
    if (hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      addEventListener('scroll', () => {
        const y = Math.min(window.scrollY, 700);
        hero.style.transform = `translateY(${y * 0.16}px)`;
        hero.style.opacity = String(Math.max(0, 1 - y / 620));
      }, { passive: true });
    }
  });
})();
