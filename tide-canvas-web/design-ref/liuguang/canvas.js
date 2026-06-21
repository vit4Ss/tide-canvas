/* ============================================================================
   SCARECROWAI · 流光 — 画布 (Canvas) page logic
   project library  ·  new project  ·  infinite-canvas editor
   ========================================================================== */
(function () {
  const H = window.HOME, FX = window.FX;
  const mesh = H.mesh, fmt = H.fmt;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LS = 'flux_canvas_v1';

  /* ── seed projects ─────────────────────────────────────────────── */
  const cover = (h1, h2, h3) => mesh(h1, h2, h3);
  const PROJECTS = [
    { id:'p_huatuo', name:'华佗之女', kind:'image', edited:'20 小时前', star:true,
      cells:[cover(20,42,8), cover(330,286,350), cover(38,16,52), cover(8,350,28)] },
    { id:'p_war',    name:'未命名项目', kind:'video', edited:'02月12日',
      cells:[cover(210,248,196), cover(225,265,245), cover(195,175,230), cover(255,230,290)] },
    { id:'p_palace', name:'未命名项目', kind:'image', edited:'02月11日',
      cells:[cover(110,78,150), cover(95,140,70), cover(150,110,180), cover(30,60,20)] },
    { id:'p_e1',     name:'未命名项目', kind:'image', edited:'02月11日', cells:[] },
    { id:'p_e2',     name:'未命名项目', kind:'image', edited:'01月29日', cells:[] },
    { id:'p_e3',     name:'未命名项目', kind:'image', edited:'01月29日', cells:[] },
    { id:'p_space',  name:'我可以为您提供相关的视频制作…', kind:'video', edited:'01月24日',
      cells:[cover(225,265,245), cover(282,318,200), cover(195,175,230), cover(190,250,210)] },
  ];
  // per-editor seeded node graphs (world coords)
  function seedNodes(p) {
    if (!p || !p.cells || !p.cells.length) return [];
    const c = p.cells, vid = p.kind === 'video';
    return [
      { id:'n1', t:'prompt', x:120, y:160, prompt:'一位身着青衣的医女立于药庐之中，柔光，胶片质感，宋代工笔风，8K 超写实细节', model:'Flux.1 Pro' },
      { id:'n2', t:'image', x:520, y:90,  cells:[c[0], c[1]], cap:'文生图 · 4 张', model:'Flux.1 Pro' },
      { id:'n3', t:'image', x:520, y:430, cells:[c[2], c[3]], cap:vid ? '图生视频' : '局部重绘', model:vid ? 'Seedance 2.0' : 'Flux.1 Dev', video:vid },
      { id:'n4', t:'image', x:930, y:250, cells:[c[1]], single:true, cap:vid ? '视频成片' : '高清放大 4×', model:vid ? 'Seedance 2.0' : 'Real-ESRGAN', video:vid },
    ];
  }
  const WIRES = [['n1','n2'],['n1','n3'],['n2','n4'],['n3','n4']];

  /* ── render library ────────────────────────────────────────────── */
  function libCardHTML(p) {
    const cells = p.cells || [];
    let thumb;
    if (!cells.length) {
      thumb = `<div class="cv-thumb empty"><div class="ph"><span class="gl"></span><span>空白画布</span></div></div>`;
    } else {
      const g = cells.length >= 4 ? 'g4' : 'g1';
      const shown = cells.length >= 4 ? cells.slice(0, 4) : [cells[0]];
      const inner = shown.map(c => `<div class="cv-cell" style="background:${c}"></div>`).join('');
      thumb = `<div class="cv-thumb">
        ${p.kind === 'video' ? '<span class="cv-vtag"><span class="pdot"></span>VIDEO</span>' : ''}
        <div class="cv-cells ${g}">${inner}</div>
        <div class="cv-open"><span class="go">打开 →</span></div>
      </div>`;
    }
    return `<div class="cv-card" data-id="${p.id}">
      ${thumb}
      <div class="cv-meta">
        <div class="cv-name">${p.star ? '<span class="star">★</span>' : ''}${p.name}</div>
        <div class="cv-subtle">
          <span class="chip"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 3v18"/></svg>画布</span>
          <span>·</span><span>${p.edited}修改</span>
        </div>
      </div>
    </div>`;
  }

  function renderLib() {
    const grid = $('#cvGrid');
    const newCard = `<div class="cv-card cv-new" data-new="1">
      <div class="cv-thumb"><div class="np"><span class="plus">+</span><b>新建项目</b><small>从空白画布开始</small></div></div>
      <div class="cv-meta"><div class="cv-name">新建项目</div><div class="cv-subtle"><span>开启一段全新创作</span></div></div>
    </div>`;
    grid.innerHTML = newCard + PROJECTS.map(libCardHTML).join('');
    $('#cvCount').textContent = PROJECTS.length;
    grid.addEventListener('click', e => {
      const card = e.target.closest('.cv-card'); if (!card) return;
      if (card.dataset.new) return openEditor(null);
      const p = PROJECTS.find(x => x.id === card.dataset.id);
      openEditor(p);
    });
  }

  /* ── editor state ──────────────────────────────────────────────── */
  const ed = { pan:{x:0,y:0}, zoom:1, nodes:[], sel:null, wires:[], project:null };
  const view = $('#cvViewport'), world = $('#cvWorld'), wiresSvg = $('#cvWires');

  function applyTransform() {
    world.style.transform = `translate(${ed.pan.x}px,${ed.pan.y}px) scale(${ed.zoom})`;
    const gs = 26 * ed.zoom;
    view.style.setProperty('--gs', gs + 'px');
    view.style.setProperty('--gx', (ed.pan.x % gs) + 'px');
    view.style.setProperty('--gy', (ed.pan.y % gs) + 'px');
    $('#cvZoomPct').textContent = Math.round(ed.zoom * 100) + '%';
    persist();
  }

  function nodeHTML(n) {
    if (n.t === 'prompt') {
      return `<div class="cv-node cv-node-prompt" data-id="${n.id}" style="left:${n.x}px; top:${n.y}px">
        <div class="cv-node-head"><span class="dot"></span>提示词 · PROMPT<span class="mono">T2I</span></div>
        <div class="cv-node-body"><div class="pt">${n.prompt}</div>
          <div class="pf"><span class="mdl"><span class="sw"></span>${n.model || 'Flux.1 Pro'}</span></div>
        </div>
      </div>`;
    }
    const vid = n.video;
    let media;
    if (n.single) {
      media = `<div class="cv-node-img r1" style="background:${n.cells[0]}"></div>`;
    } else {
      media = `<div class="cv-node-grid">${(n.cells || []).map(c => `<div class="c" style="background:${c}"></div>`).join('')}</div>`;
    }
    return `<div class="cv-node ${n.gen ? 'gen' : ''}" data-id="${n.id}" style="left:${n.x}px; top:${n.y}px; width:${n.single ? 240 : 280}px">
      <div class="cv-node-head"><span class="dot ${vid ? 'video' : ''}"></span>${n.cap || '生成结果'}<span class="mono">${vid ? 'VIDEO' : 'IMG'}</span></div>
      <div class="cv-node-body">${media}${n.gen ? '<div class="glabel">生成中…</div>' : ''}</div>
      <div class="cv-node-foot">
        <button data-act="remix">↻ 同款</button>
        <button data-act="up">⤢ 放大</button>
        <button class="pri" data-act="add">+ 衍生</button>
      </div>
    </div>`;
  }

  function renderNodes() {
    $$('.cv-node', world).forEach(el => el.remove());
    ed.nodes.forEach(n => world.insertAdjacentHTML('beforeend', nodeHTML(n)));
    renderWires();
    bindNodes();
  }

  function nodeRect(n) {
    const w = n.t === 'prompt' ? 300 + 24 : (n.single ? 240 : 280);
    const h = n.t === 'prompt' ? 132 : (n.single ? 300 : 220);
    return { x:n.x, y:n.y, w, h };
  }
  function renderWires() {
    const off = 4000;
    let s = '';
    ed.wires.forEach(([a, b]) => {
      const na = ed.nodes.find(x => x.id === a), nb = ed.nodes.find(x => x.id === b);
      if (!na || !nb) return;
      const ra = nodeRect(na), rb = nodeRect(nb);
      const x1 = ra.x + ra.w + off, y1 = ra.y + ra.h / 2 + off;
      const x2 = rb.x + off, y2 = rb.y + rb.h / 2 + off;
      const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
      s += `<path class="cv-wire" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
      s += `<circle class="cv-port" cx="${x1}" cy="${y1}" r="4"/><circle class="cv-port" cx="${x2}" cy="${y2}" r="4"/>`;
    });
    wiresSvg.innerHTML = s;
  }

  /* ── node dragging + actions ───────────────────────────────────── */
  function bindNodes() {
    $$('.cv-node', world).forEach(el => {
      el.addEventListener('pointerdown', e => {
        if (e.target.closest('.cv-node-foot')) return;
        e.stopPropagation();
        const id = el.dataset.id; const n = ed.nodes.find(x => x.id === id);
        selectNode(id);
        const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
        el.classList.add('dragging'); el.setPointerCapture(e.pointerId);
        const move = ev => {
          n.x = ox + (ev.clientX - sx) / ed.zoom;
          n.y = oy + (ev.clientY - sy) / ed.zoom;
          el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
          renderWires();
        };
        const up = () => { el.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); persist(); };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      });
      $$('.cv-node-foot button', el).forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const act = b.dataset.act, n = ed.nodes.find(x => x.id === el.dataset.id);
        if (act === 'add') spawnFrom(n);
        else if (act === 'remix') FX.toast('已复制提示词，可继续衍生');
        else if (act === 'up') FX.toast('高清放大 · 任务已提交');
      }));
    });
  }
  function selectNode(id) {
    ed.sel = id;
    $$('.cv-node', world).forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  }

  let nid = 100;
  function spawnFrom(src) {
    const id = 'n' + (nid++);
    const cells = [mesh(Math.random()*360, Math.random()*360, Math.random()*360),
                   mesh(Math.random()*360, Math.random()*360, Math.random()*360)];
    const node = { id, t:'image', x:(src ? src.x + 360 : worldCenter().x), y:(src ? src.y + 70 : worldCenter().y),
                   cells, cap:'衍生 · 生成中', model:'Flux.1 Pro', gen:true };
    ed.nodes.push(node);
    if (src) ed.wires.push([src.id, id]);
    renderNodes(); selectNode(id); hideHint();
    setTimeout(() => { node.gen = false; node.cap = '衍生结果 · 4 张'; renderNodes(); selectNode(id); }, 1700);
    persist();
  }

  function worldCenter() {
    const r = view.getBoundingClientRect();
    return { x:(r.width/2 - ed.pan.x)/ed.zoom - 140, y:(r.height/2 - ed.pan.y)/ed.zoom - 110 };
  }

  /* generate from the prompt bar */
  function generate() {
    const inp = $('#cvPrompt');
    const txt = (inp.value || '').trim();
    const id = 'n' + (nid++);
    const c = worldCenter();
    const cells = [mesh(Math.random()*360,Math.random()*360,Math.random()*360),
                   mesh(Math.random()*360,Math.random()*360,Math.random()*360)];
    const node = { id, t:'image', x:c.x, y:c.y, cells, cap:'文生图 · 生成中', model:'Flux.1 Pro', gen:true, prompt:txt };
    ed.nodes.push(node);
    // attach a prompt node too on first generate if canvas empty
    renderNodes(); selectNode(id); hideHint();
    // center camera roughly on the new node
    FX.toast(txt ? '正在生成 · ' + (txt.length > 14 ? txt.slice(0,14) + '…' : txt) : '正在生成新作品');
    inp.value = '';
    setTimeout(() => { node.gen = false; node.cap = '文生图 · 4 张'; renderNodes(); selectNode(id); }, 1800);
    persist();
  }

  /* ── pan + zoom ────────────────────────────────────────────────── */
  function bindViewport() {
    view.addEventListener('pointerdown', e => {
      if (e.target.closest('.cv-node, .cv-dock, .cv-promptbar')) return;
      view.classList.add('panning');
      const sx = e.clientX, sy = e.clientY, ox = ed.pan.x, oy = ed.pan.y;
      view.setPointerCapture(e.pointerId);
      $$('.cv-node.sel', world).forEach(el => el.classList.remove('sel')); ed.sel = null;
      const move = ev => { ed.pan.x = ox + (ev.clientX - sx); ed.pan.y = oy + (ev.clientY - sy); applyTransform(); };
      const up = () => { view.classList.remove('panning'); view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); };
      view.addEventListener('pointermove', move); view.addEventListener('pointerup', up);
    });
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(mx, my, e.deltaY < 0 ? 1.08 : 0.92);
      } else {
        ed.pan.x -= e.deltaX; ed.pan.y -= e.deltaY; applyTransform();
      }
    }, { passive:false });
  }
  function zoomAt(mx, my, f) {
    const z0 = ed.zoom, z1 = Math.min(2.2, Math.max(0.3, z0 * f));
    const wx = (mx - ed.pan.x) / z0, wy = (my - ed.pan.y) / z0;
    ed.zoom = z1;
    ed.pan.x = mx - wx * z1; ed.pan.y = my - wy * z1;
    applyTransform();
  }
  function zoomCenter(f) {
    const r = view.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, f);
  }
  function resetView() {
    ed.zoom = 0.82;
    const r = view.getBoundingClientRect();
    // center the seed graph (~ spans x 120..1170, y 90..650)
    ed.pan.x = r.width / 2 - 640 * ed.zoom;
    ed.pan.y = r.height / 2 - 370 * ed.zoom;
    applyTransform();
  }

  /* ── open / close editor ───────────────────────────────────────── */
  const editor = $('#cvEditor');
  function openEditor(p) {
    ed.project = p; ed.sel = null;
    $('#cvEdName').value = p ? p.name : '未命名项目';
    sizeName();
    ed.nodes = seedNodes(p);
    ed.wires = p && p.cells && p.cells.length ? WIRES.map(w => w.slice()) : [];
    nid = 100;
    renderNodes();
    resetView();
    editor.classList.add('show');
    $('#cvHint').classList.toggle('show', !(p && p.cells && p.cells.length));
    persist();
    history.replaceState(null, '', '#' + (p ? p.id : 'new'));
  }
  function closeEditor() {
    editor.classList.remove('show');
    ed.project = null;
    try { localStorage.removeItem(LS); } catch (_) {}
    history.replaceState(null, '', location.pathname);
  }
  function hideHint() { $('#cvHint').classList.remove('show'); }
  function sizeName() {
    const el = $('#cvEdName'); const v = el.value || '';
    let n = 0; for (const c of v) n += c.charCodeAt(0) > 255 ? 2 : 1;
    el.size = Math.max(6, n + 2);
  }

  /* ── tool dock ─────────────────────────────────────────────────── */
  function bindDock() {
    $$('.cv-dock button[data-tool]').forEach(b => b.addEventListener('click', () => {
      $$('.cv-dock button[data-tool]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const t = b.dataset.tool;
      if (t === 'image' || t === 'text' || t === 'frame') {
        spawnFrom(null);
        FX.toast(({image:'已添加图像节点', text:'已添加文本节点', frame:'已添加画框'})[t]);
        setTimeout(() => { $$('.cv-dock button[data-tool]').forEach(x => x.classList.remove('on')); $('.cv-dock button[data-tool="select"]').classList.add('on'); }, 300);
      }
    }));
  }

  /* ── persist ───────────────────────────────────────────────────── */
  function persist() {
    if (!ed.project && !editor.classList.contains('show')) return;
    try {
      localStorage.setItem(LS, JSON.stringify({
        open: editor.classList.contains('show'), pid: ed.project ? ed.project.id : null,
        pan: ed.pan, zoom: ed.zoom, nodes: ed.nodes, wires: ed.wires, name: $('#cvEdName').value, nid
      }));
    } catch (_) {}
  }
  function restore() {
    let st; try { st = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) {}
    if (!st || !st.open) return false;
    ed.project = st.pid ? PROJECTS.find(p => p.id === st.pid) || { id:st.pid } : null;
    ed.nodes = st.nodes || []; ed.wires = st.wires || []; ed.pan = st.pan || {x:0,y:0}; ed.zoom = st.zoom || 1;
    nid = st.nid || 100;
    $('#cvEdName').value = st.name || '未命名项目';
    sizeName();
    renderNodes(); applyTransform();
    editor.classList.add('show');
    $('#cvHint').classList.toggle('show', !ed.nodes.length);
    return true;
  }

  /* ── boot ──────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    renderLib();
    bindViewport(); bindDock();
    $('#cvBack').addEventListener('click', closeEditor);
    $('#cvZoomIn').addEventListener('click', () => zoomCenter(1.12));
    $('#cvZoomOut').addEventListener('click', () => zoomCenter(0.9));
    $('#cvZoomReset').addEventListener('click', resetView);
    $('#cvPgen').addEventListener('click', generate);
    $('#cvPrompt').addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
    $('#cvEdName').addEventListener('input', () => { sizeName(); persist(); });
    document.addEventListener('keydown', e => {
      if (!editor.classList.contains('show')) return;
      if (e.key === 'Escape' && document.activeElement.tagName !== 'INPUT') closeEditor();
    });
    if (!restore() && location.hash) {
      const h = location.hash.slice(1);
      if (h === 'new') openEditor(null);
      else { const p = PROJECTS.find(x => x.id === h); if (p) openEditor(p); }
    }
  });
})();
