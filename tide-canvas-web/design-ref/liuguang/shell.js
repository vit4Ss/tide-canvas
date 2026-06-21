/* ============================================================================
   SCARECROWAI · 流光 — shared shell
   nav · footer · work modal · toast · reveal · tile builders · helpers
   Exposes window.FX  (loaded after home-data.js, before each page script)
   ========================================================================== */
(function () {
  const { ARTWORKS, MODELS, MODEL_NAMES, fmt } = window.HOME;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---- auth state (prototype, localStorage) ---------------------------- */
  const AUTH_KEY = 'flux_user';
  function authUser() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { return null; }
  }
  function setAuthUser(u) {
    try { u ? localStorage.setItem(AUTH_KEY, JSON.stringify(u)) : localStorage.removeItem(AUTH_KEY); } catch (_) {}
  }
  function initials(name) {
    const s = (name || '').trim();
    return (s.slice(0, 2) || 'U').toUpperCase();
  }
  function avatarGrad(seed) {
    let h = 0; for (let i = 0; i < (seed || 'u').length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${(h + 48) % 360} 72% 56%))`;
  }

  /* ---- nav links (page = active key) ---------------------------------- */
  const NAV = [
    { k: 'home', label: '发现', href: '首页-流光.html' },
    { k: 'explore', label: '作品广场', href: '作品广场.html' },
    { k: 'create', label: '创作台', href: '创作台.html' },
    { k: 'pricing', label: '价格方案', href: '定价.html', tag: '限时' },
  ];

  function navHTML(active) {
    const links = NAV.map(n =>
      `<a class="nlink${n.k === active ? ' on' : ''}" href="${n.href}">${n.label}${n.tag ? ` <span class="tag">${n.tag}</span>` : ''}</a>`
    ).join('');
    return `<nav class="nav" id="nav"><div class="wrap nav-in">
      <a class="brand" href="首页-流光.html"><span class="glyph"></span>SCARECROW<b>AI</b></a>
      <div class="nav-links">${links}</div>
      <div class="nav-right">
        <button class="icbtn" title="语言" data-toast="Language · 中 / EN">文</button>
        <a class="vip" href="定价.html">会员特惠</a>
        ${accountHTML()}
      </div>
    </div></nav>`;
  }

  function accountHTML() {
    const u = authUser();
    if (!u) return `<a class="signin" href="登录注册.html">登录</a>`;
    const isAdmin = u.role === 'admin';
    const planLabel = ({ free: '免费版', pro: '专业版', team: '团队版' })[u.plan] || '免费版';
    return `<div class="acct" id="acct">
      <button class="acct-trigger" id="acctTrigger" aria-haspopup="true" aria-expanded="false">
        <span class="acct-av" style="background:${avatarGrad(u.email || u.name)}">${initials(u.name)}</span>
      </button>
      <div class="acct-menu" id="acctMenu" role="menu">
        <div class="acct-head">
          <span class="acct-av lg" style="background:${avatarGrad(u.email || u.name)}">${initials(u.name)}</span>
          <div class="acct-id">
            <div class="acct-nm">${u.name}${isAdmin ? '<span class="acct-role">管理员</span>' : ''}</div>
            <div class="acct-em">${u.email}</div>
          </div>
        </div>
        <a class="acct-credits" href="定价.html">
          <div><span class="plan">${planLabel}</span><span class="cr">${fmt(u.credits || 0)} 积分</span></div>
          <span class="up">升级 →</span>
        </a>
        <div class="acct-list">
          <a href="个人中心.html" role="menuitem"><span class="mi">👤</span>个人信息</a>
          <a href="资产.html" role="menuitem"><span class="mi">🖼</span>我的作品</a>
          <a href="创作台.html" role="menuitem"><span class="mi">✦</span>创作台</a>
          ${isAdmin ? `<a href="后台管理.html" role="menuitem" class="admin"><span class="mi">⚙</span>管理后台</a>` : ''}
        </div>
        <div class="acct-list bord">
          <button type="button" id="acctLogout" role="menuitem" class="danger"><span class="mi">⏻</span>退出登录</button>
        </div>
      </div>
    </div>`;
  }

  function footerHTML() {
    return `<footer><div class="wrap">
      <div class="foot-grid">
        <div class="foot-brand">
          <div class="brand"><span class="glyph"></span>SCARECROW<b>AI</b></div>
          <p>智绘社区 · 超级 AI 创作智能体。一句话生成图片与视频，海量模型一键调用。</p>
        </div>
        <div class="foot-col"><h4>产品</h4>
          <a href="创作台.html">图片生成</a><a href="创作台.html">视频创作</a><a href="作品广场.html">作品广场</a></div>
        <div class="foot-col"><h4>社区</h4>
          <a href="作品广场.html">作品广场</a><a href="首页-流光.html#creators">创作者</a><a href="#" data-toast="玩法教程 · 即将上线">玩法教程</a><a href="#" data-toast="灵感周报 · 即将上线">灵感周报</a></div>
        <div class="foot-col"><h4>关于</h4>
          <a href="定价.html">价格方案</a><a href="定价.html">企业版</a><a href="#" data-toast="服务条款">服务条款</a><a href="#" data-toast="联系我们 · hi@scarecrow.ai">联系我们</a></div>
      </div>
      <div class="foot-bottom">
        <span>© 2026 SCARECROWAI · 高保真交互原型 · 占位封面为生成式渐变，可替换为真实作品</span>
        <span class="mono">流光 · FLUX FIELD v2</span>
      </div></div></footer>`;
  }

  function mountChrome(active) {
    const navSlot = $('#nav-slot'); if (navSlot) navSlot.innerHTML = navHTML(active);
    const footSlot = $('#footer-slot'); if (footSlot) footSlot.innerHTML = footerHTML();
    const nav = $('#nav');
    if (nav) {
      const solid = () => nav.classList.toggle('solid', window.scrollY > 40);
      addEventListener('scroll', solid, { passive: true }); solid();
    }
    bindAccount();
  }

  /* ---- account dropdown ----------------------------------------------- */
  function bindAccount() {
    const acct = $('#acct'); if (!acct) return;
    const trigger = $('#acctTrigger', acct);
    const close = () => { acct.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = acct.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => { if (!acct.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const out = $('#acctLogout', acct);
    if (out) out.addEventListener('click', () => {
      setAuthUser(null);
      toast('已退出登录');
      setTimeout(() => { location.href = '首页-流光.html'; }, 700);
    });
  }

  /* ---- toast ---------------------------------------------------------- */
  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = `<span class="ic">✦</span>${msg}`;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  // global delegation for any [data-toast]
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toast]');
    if (t) { e.preventDefault(); toast(t.dataset.toast); }
  });

  /* ---- tile builder + binding ----------------------------------------- */
  function tileHTML(a, i, delay) {
    const liked = a.likes > 8000;
    return `<article class="tile reveal" data-idx="${i}" style="--rd:${delay || 0}s">
      <div class="tile-cover" style="aspect-ratio:${(1 / a.h).toFixed(3)};background:${a.c}">
        ${a.type === 'video' ? '<span class="play-orb">▶</span>' : ''}
        <span class="tile-badge">${a.type === 'video' ? 'VIDEO' : a.cat}</span>
        <button class="like" data-liked="${liked}" type="button">♥ ${fmt(a.likes)}</button>
        <div class="tile-shade"></div>
        <div class="tile-meta">
          <div class="tt">${a.title}</div>
          <div class="tb"><span>${a.author}</span><span class="dot">·</span><span class="mono">${a.model}</span></div>
          <span class="remix">↻ 生成同款</span>
        </div>
      </div></article>`;
  }

  function bindTiles(container, pool) {
    pool = pool || ARTWORKS;
    $$('.like', container).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const on = b.dataset.liked === 'true';
      b.dataset.liked = on ? 'false' : 'true';
    }));
    $$('.tile', container).forEach(t => {
      t.addEventListener('click', () => {
        const idx = +t.dataset.idx;
        const art = pool[idx] || ARTWORKS[idx];
        if (art) openWork(art);
      });
    });
    $$('.remix', container).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const t = b.closest('.tile'); const art = t && (pool[+t.dataset.idx] || ARTWORKS[+t.dataset.idx]);
      try { if (art) sessionStorage.setItem('flux_prompt', art.prompt || art.title); } catch (_) {}
      toast('已带入提示词 · 正在前往创作台');
      setTimeout(() => location.href = '创作台.html', 650);
    }));
  }

  // model cards → create (delegated, works on any page)
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.mcard');
    if (card) { toast('已选择模型 · 前往创作台'); setTimeout(() => location.href = '创作台.html', 600); }
  });

  /* ---- work modal ----------------------------------------------------- */
  let maskEl;
  function ensureModal() {
    if (maskEl) return;
    maskEl = document.createElement('div');
    maskEl.className = 'mask';
    maskEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(maskEl);
    maskEl.addEventListener('click', e => { if (e.target === maskEl) closeWork(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWork(); });
  }
  function openWork(a) {
    ensureModal();
    const isVid = a.type === 'video';
    const neg = a.neg || '低质量, 模糊, 多余肢体, 水印, 畸变, 文字';
    const steps = a.steps || 30, sampler = a.sampler || 'DPM++ 2M Karras', cfg = a.cfg || 7.5, size = a.size || '1024×1536', seed = a.seed || '2837461920';
    $('.modal', maskEl).innerHTML = `
      <div class="modal-media">
        <div class="cov" style="background:${a.c}"></div>
        ${isVid ? '<span class="play-orb">▶</span>' : ''}
        <button class="modal-x" aria-label="关闭">✕</button>
      </div>
      <div class="modal-side">
        <h3 class="mt">${a.title}</h3>
        <div class="modal-author">
          <span class="av" style="background:${a.c}"></span>
          <div><div class="an">${a.author}</div><div class="as">${fmt(a.likes)} 喜欢 · ${a.cat}</div></div>
          <button class="foll" data-toast="已关注 ${a.author}">+ 关注</button>
        </div>
        <div class="pblock">
          <div class="pl">提示词 <button data-toast="提示词已复制">复制</button></div>
          <div class="pv">${a.prompt || a.title + '，' + a.model + ' 生成，高清细节，电影级布光，超写实质感'}</div>
        </div>
        <div class="pblock">
          <div class="pl">反向提示词</div>
          <div class="pv">${neg}</div>
        </div>
        <div class="pgrid">
          <div class="pcell"><div class="k">模型</div><div class="v">${a.model.split(' ')[0]}</div></div>
          <div class="pcell"><div class="k">采样器</div><div class="v">${sampler.split(' ')[0]}</div></div>
          <div class="pcell"><div class="k">步数</div><div class="v">${steps}</div></div>
          <div class="pcell"><div class="k">CFG</div><div class="v">${cfg}</div></div>
          <div class="pcell"><div class="k">尺寸</div><div class="v">${size}</div></div>
          <div class="pcell"><div class="k">种子</div><div class="v">${String(seed).slice(0, 7)}</div></div>
        </div>
        <div class="modal-actions">
          <button class="pri" data-go-create>✦ 生成同款</button>
          <button class="sec" data-toast="已加入收藏">♥</button>
          <button class="sec" data-toast="已下载到本地">⤓</button>
        </div>
      </div>`;
    $('.modal-x', maskEl).addEventListener('click', closeWork);
    $('[data-go-create]', maskEl).addEventListener('click', () => {
      try { sessionStorage.setItem('flux_prompt', a.prompt || a.title); } catch (_) {}
      toast('已带入参数 · 前往创作台'); setTimeout(() => location.href = '创作台.html', 650);
    });
    void maskEl.offsetWidth;            // force reflow so the transition runs
    maskEl.classList.add('show');
    document.body.classList.add('scroll-lock');
  }
  function closeWork() {
    if (!maskEl) return;
    maskEl.classList.remove('show');
    document.body.classList.remove('scroll-lock');
  }

  /* ---- reveal (scroll-based, reliable in captures) -------------------- */
  function reveal(root) {
    const els = $$('.reveal, .reveal-scale', root || document);
    function tick() {
      const vh = window.innerHeight;
      for (let i = els.length - 1; i >= 0; i--) {
        const r = els[i].getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) { els[i].classList.add('in'); els.splice(i, 1); }
      }
      if (!els.length) window.removeEventListener('scroll', tick);
    }
    addEventListener('scroll', tick, { passive: true });
    addEventListener('resize', tick, { passive: true });
    tick();
    setTimeout(() => $$('.reveal:not(.in), .reveal-scale:not(.in)').forEach(el => el.classList.add('in')), 1600);
  }

  /* ---- typewriter + live counter (hero console) ----------------------- */
  function typeLoop(el, prompts) {
    let pi = 0, ci = 0, dir = 1;
    (function tick() {
      const full = prompts[pi];
      ci += dir; el.textContent = full.slice(0, ci);
      if (dir > 0 && ci >= full.length) { dir = -1; return setTimeout(tick, 2200); }
      if (dir < 0 && ci <= 0) { dir = 1; pi = (pi + 1) % prompts.length; return setTimeout(tick, 320); }
      setTimeout(tick, dir > 0 ? 46 + Math.random() * 40 : 24);
    })();
  }
  function liveCounter(el, base) {
    let v = base;
    setInterval(() => {
      v += Math.round((Math.random() - 0.42) * 14);
      v = Math.max(base - 60, Math.min(base + 220, v));
      el.textContent = v.toLocaleString('en-US');
    }, 2000);
  }

  /* ---- marquee -------------------------------------------------------- */
  function renderMarquee(row) {
    const half = Math.ceil(MODEL_NAMES.length / 2);
    const chip = (n) => `<span class="mq-chip"><i></i>${n}</span>`;
    // duplicate each line's chips so translateX(-50%) loops seamlessly
    const line = (arr) => '<div class="mq-line"><div class="mq-track">' +
      arr.concat(arr).map(chip).join('') + '</div></div>';
    row.innerHTML = line(MODEL_NAMES.slice(0, half)) + line(MODEL_NAMES.slice(half));
  }

  window.FX = {
    $, $$, fmt, mountChrome, toast, tileHTML, bindTiles, openWork, closeWork,
    reveal, typeLoop, liveCounter, renderMarquee,
    authUser, setAuthUser, initials, avatarGrad,
  };
})();
