/* SCARECROWAI 流光 — 创作台 workstation (prototype generate flow) */
(function () {
  const H = window.HOME, FX = window.FX;
  const { CREATE_MODELS, ARTWORKS, mesh } = H;
  const { $, $$ } = FX;

  const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16'];
  const VIDEO_RES = ['720p', '1080p', '4K'];
  const IMG_RES = ['1K', '2K', '4K'];
  const IMG_RES_COST = { '1K': 8, '2K': 14, '4K': 30 };
  const VIDEO_DUR = ['5s', '10s', '15s'];
  const RES_COST = { '720p': 30, '1080p': 50, '4K': 90 };
  const DUR_SEC = { '5s': 5, '10s': 10, '15s': 15 };
  const IDEAS = [
    '赛博朋克城市夜景，霓虹倒影，电影感，8K',
    '青绿山水工笔，石青石绿设色，宋代院体',
    '液态金属机器人，纯白工作室布光，C4D 渲染',
    '黄昏侧颜人像，85mm f/1.4，柯达胶片颗粒',
    '深海发光水母，慢镜头，4K 微距，蓝紫光束',
  ];
  const TOOLS = {
    t2i:  { mode: 't2i', label: '文生图', head: '生成图片', drop: false, ph: '描述你想要的画面，越具体越好…\n例：赛博朋克城市夜景，霓虹倒影，电影感，8K 超写实' },
    i2i:  { mode: 'i2i', label: '图生图', head: '图生图',   drop: true,  ph: '上传参考图，再描述想要的改动…\n例：保留构图，改成赛博朋克霓虹风格' },
    edit: { mode: 'i2i', label: '改图',   head: '改图 · 扩图', drop: true, ph: '上传图片，描述要修改或扩展的部分…\n例：把背景扩展为开阔的雪山草原' },
    t2v:  { mode: 't2v', label: '文生视频', head: '生成视频', drop: false, ph: '描述镜头与运动…\n例：金色麦田，强风掠过，慢镜头航拍，电影调色' },
    i2v:  { mode: 't2v', label: '图生视频', head: '图生视频', drop: true,  ph: '上传首帧图片，再描述运动…\n例：人物缓缓回头，发丝随风飘动，电影质感' },
    flf:  { mode: 't2v', label: '首尾帧', head: '首尾帧生成', drop: true, ph: '上传首帧与尾帧，描述过渡…\n例：从清晨到日落的平滑时间流逝' },
    ref:  { mode: 't2v', label: '全能参考', head: '全能参考', drop: true, ph: '上传参考图（人物 / 风格 / 动作），描述想要的视频…\n例：参考人物形象，生成其在雪山奔跑的镜头' },
  };
  const MODES_BY_TYPE = { image: ['t2i', 'i2i'], video: ['t2v', 'i2v', 'flf', 'ref'] };

  let count = 4, busy = false, tool = 't2i', curType = 'image';
  let curRes = '1080p', curDur = '5s', curImgRes = '2K', slotData = {};

  const MODEL_META = {
    'GPT Image 2':     { tag: 'HD',  by: 'OpenAI',    desc: '万能画风 · 超清细节' },
    'Flux.1 Pro':      { tag: 'PRO', by: 'Black Forest', desc: '写实质感 · 精准构图' },
    'Midjourney v6':   { tag: 'ART', by: 'Midjourney', desc: '艺术氛围 · 电影光影' },
    'Nano Banana 2':   { tag: 'NEW', by: 'Google',    desc: '极速出图 · 风格百变' },
    'SDXL Lightning':  { tag: '4×',  by: 'Stability', desc: '秒级生成 · 开源高效' },
    '即梦 3.0':        { tag: 'CN',  by: '字节跳动',  desc: '中文语义 · 国风擅长' },
    'Seedance 2.0':    { tag: 'VID', by: '字节跳动',  desc: '视听双绝 · 镜头流畅' },
    '可灵 Kling 1.6':  { tag: 'VID', by: '快手',      desc: '长镜头 · 物理真实' },
  };
  function modelSwatch(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 50) % 360} 80% 52%))`;
  }
  function syncModel() {
    const v = $('#model').value;
    const meta = MODEL_META[v] || { tag: 'AI', by: '模型', desc: '高质量生成' };
    const nm = $('#modelName'); if (nm) nm.textContent = v;
    const sw = $('#modelSw'); if (sw) { sw.style.background = modelSwatch(v); sw.textContent = v.replace(/[^A-Za-z一-龥]/g, '').charAt(0) || 'A'; }
    const tg = $('#modelTag'); if (tg) tg.textContent = meta.tag;
    const ds = $('#modelDesc'); if (ds) ds.textContent = meta.by + ' · ' + meta.desc;
    updateCost();
  }
  function modelInitial(name){ return name.replace(/[^A-Za-z一-龥]/g, '').charAt(0) || 'A'; }
  function fillModelMenu() {
    const cur = $('#model').value;
    $('#modelMenu').innerHTML = CREATE_MODELS.map(m => {
      const meta = MODEL_META[m] || { tag: 'AI', by: '模型', desc: '高质量生成' };
      return `<button class="ws-mopt${m === cur ? ' on' : ''}" type="button" role="option" data-m="${m}">
        <span class="ws-mopt-sw" style="background:${modelSwatch(m)}">${modelInitial(m)}</span>
        <span class="ws-mopt-info">
          <span class="ws-mopt-row"><span class="ws-mopt-name">${m}</span><span class="ws-model-tag">${meta.tag}</span></span>
          <span class="ws-mopt-desc">${meta.by} · ${meta.desc}</span>
        </span>
        <span class="ws-mopt-ck">✓</span>
      </button>`;
    }).join('');
  }
  function openModelMenu(open) {
    const wrap = $('#modelCard').parentElement;
    wrap.classList.toggle('open', open);
    $('#modelCard').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function fillRatios() {
    $('#ratios').innerHTML = RATIOS.map((r, i) => `<button class="ratio${i === 0 ? ' on' : ''}" data-r="${r}">${r}</button>`).join('');
    $('#ratios').addEventListener('click', e => {
      const b = e.target.closest('.ratio'); if (!b) return;
      $$('#ratios .ratio').forEach(x => x.classList.toggle('on', x === b));
      syncProps();
    });
  }
  function fillResDur() {
    $('#resPills').innerHTML = VIDEO_RES.map(r => `<button class="ratio${r === curRes ? ' on' : ''}" data-res="${r}">${r}</button>`).join('');
    $('#durPills').innerHTML = VIDEO_DUR.map(d => `<button class="ratio${d === curDur ? ' on' : ''}" data-dur="${d}">${d}</button>`).join('');
    $('#resPills').addEventListener('click', e => {
      const b = e.target.closest('.ratio'); if (!b) return;
      curRes = b.dataset.res; $$('#resPills .ratio').forEach(x => x.classList.toggle('on', x === b)); updateCost();
    });
    $('#durPills').addEventListener('click', e => {
      const b = e.target.closest('.ratio'); if (!b) return;
      curDur = b.dataset.dur; $$('#durPills .ratio').forEach(x => x.classList.toggle('on', x === b)); updateCost();
    });
  }
  function fillImgRes() {
    $('#imgResPills').innerHTML = IMG_RES.map(r => `<button class="ratio${r === curImgRes ? ' on' : ''}" data-ir="${r}">${r}</button>`).join('');
    $('#imgResPills').addEventListener('click', e => {
      const b = e.target.closest('.ratio'); if (!b) return;
      curImgRes = b.dataset.ir; $$('#imgResPills .ratio').forEach(x => x.classList.toggle('on', x === b)); updateCost();
    });
  }
  function applyTypeFields() {
    const vid = curType === 'video';
    const set = (id, show) => { const el = $('#' + id); if (el) el.style.display = show ? '' : 'none'; };
    set('fieldRatio', !vid); set('fieldImgRes', !vid); set('fieldCount', !vid);
    set('fieldRes', vid); set('fieldDur', vid);
  }

  /* typed reference uploads per tool (image / video / audio slots) */
  const UPLOADS = {
    i2i:  [{ k: 'img',   label: '参考图片', type: 'image', max: 4, hint: '上传图片，作为生成参考' }],
    edit: [{ k: 'img',   label: '原图',     type: 'image', max: 1, hint: '上传需要修改 / 扩展的图片' }],
    i2v:  [{ k: 'first', label: '首帧图片', type: 'image', max: 1, hint: '上传作为视频首帧的图片' }],
    flf:  [{ k: 'first', label: '首帧', type: 'image', max: 1, hint: '上传起始画面' }, { k: 'last', label: '尾帧', type: 'image', max: 1, hint: '上传结束画面' }],
    ref:  [
      { k: 'img',   label: '参考图片', type: 'image', max: 4, hint: '上传图片（人物 / 风格 / 场景）' },
      { k: 'video', label: '参考视频', type: 'video', max: 3, hint: '最多 3 段，总时长 ≤ 15 秒。支持 mp4 / mov。' },
      { k: 'audio', label: '参考音频', type: 'audio', max: 3, hint: '最多 3 段，总时长 ≤ 15 秒。支持 wav / mp3。' },
    ],
  };
  function refGrad(seed) { const h = (seed * 61 + 30) % 360; return `linear-gradient(135deg, hsl(${h} 58% 52%), hsl(${(h + 44) % 360} 62% 36%))`; }
  function makeFile(type, i) {
    if (type === 'image') return { g: refGrad(i * 7 + Date.now() % 11), n: '参考图_' + String(i + 1).padStart(2, '0'), s: (Math.random() * 3 + 0.6).toFixed(1) + ' MB' };
    if (type === 'video') return { n: 'clip_' + String(i + 1).padStart(2, '0') + '.mp4', d: '00:0' + (4 + i % 5) };
    return { n: 'audio_' + String(i + 1).padStart(2, '0') + '.mp3', d: '00:0' + (5 + i % 4) };
  }
  function slotsFor() { return UPLOADS[tool] || null; }
  function addFile(k) {
    const slot = (slotsFor() || []).find(s => s.k === k); if (!slot) return;
    const arr = slotData[k] || (slotData[k] = []);
    if (arr.length >= slot.max) { FX.toast(slot.label + '最多 ' + slot.max + ' 个'); return; }
    arr.push(makeFile(slot.type, arr.length));
    renderUploads(); FX.toast('已添加' + slot.label + ' · 原型');
  }
  function removeFile(k, i) { if (slotData[k]) { slotData[k].splice(i, 1); renderUploads(); } }
  const SLOT_ICON = {
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>',
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="13" height="14" rx="2.5"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  };
  function uploadSlotHTML(s) {
    const files = slotData[s.k] || [];
    if (files.length === 0) {
      return `<div class="ws-up"><button class="ws-up-slot" data-add="${s.k}" type="button">
        <span class="ws-up-slot-ic">${SLOT_ICON[s.type] || SLOT_ICON.image}</span>
        <span class="ws-up-slot-tx"><span class="t">${s.label}</span><span class="h">${s.hint}</span></span>
        <span class="ws-up-slot-go">上传 ↗</span>
      </button></div>`;
    }
    let body;
    if (s.type === 'image') {
      const cards = files.map((f, i) => `
        <div class="ws-ref" data-prev="${s.k}:${i}" title="点击预览">
          <span class="ws-ref-img" style="background:${f.g}"></span>
          <span class="ws-ref-zoom">⚲</span>
          <button class="ws-ref-x" data-rem="${s.k}:${i}" title="移除" type="button">✕</button>
          <span class="ws-ref-meta"><span class="nm">${f.n}</span><span class="sz">${f.s}</span></span>
        </div>`).join('');
      const add = files.length < s.max ? `<button class="ws-ref-add" data-add="${s.k}" type="button"><span class="p">＋</span>添加</button>` : '';
      body = `<div class="ws-up-grid">${cards}${add}</div>`;
    } else {
      const ic = s.type === 'video' ? '▶' : '♪';
      const rows = files.map((f, i) => `
        <div class="ws-file" data-prev="${s.k}:${i}" title="点击预览">
          <span class="ic ${s.type}">${ic}</span>
          <span class="fn">${f.n}</span><span class="fd">${f.d}</span>
          <button class="ws-file-x" data-rem="${s.k}:${i}" title="移除" type="button">✕</button>
        </div>`).join('');
      const add = files.length < s.max ? `<button class="ws-up-more" data-add="${s.k}" type="button">＋ 继续添加</button>` : '';
      body = `<div class="ws-up-list">${rows}${add}</div>`;
    }
    return `<div class="ws-up">
      <div class="ws-up-head"><label>${s.label}<span class="ws-up-n">${files.length}/${s.max}</span></label><button class="ws-up-act" data-add="${s.k}" type="button">⤓ 上传</button></div>
      ${body}
    </div>`;
  }
  function fileType(k) { const s = (slotsFor() || []).find(x => x.k === k); return s ? s.type : 'image'; }
  function openPreview(k, i) {
    const arr = slotData[k] || []; const f = arr[i]; if (!f) return;
    const type = fileType(k);
    let media;
    if (type === 'image') media = `<div class="ws-prev-media" style="background:${f.g}"></div>`;
    else if (type === 'video') media = `<div class="ws-prev-media dark" style="background:${refGrad(i * 9 + 40)}"><span class="ws-prev-play">▶</span><span class="ws-prev-badge">${f.d}</span></div>`;
    else media = `<div class="ws-prev-media dark"><div class="ws-prev-wave">${Array.from({ length: 42 }, () => `<i style="height:${18 + Math.random() * 64}%"></i>`).join('')}</div><span class="ws-prev-play sm">▶</span><span class="ws-prev-badge">${f.d}</span></div>`;
    const mask = document.createElement('div');
    mask.className = 'ws-prev-mask';
    mask.innerHTML = `<div class="ws-prev" role="dialog" aria-modal="true">
      <button class="ws-prev-x" type="button" aria-label="关闭">✕</button>
      ${media}
      <div class="ws-prev-meta"><span class="nm">${f.n}</span><span class="sz">${f.s || (type === 'video' ? '视频 · ' : '音频 · ') + f.d}</span></div>
    </div>`;
    document.body.appendChild(mask);
    requestAnimationFrame(() => mask.classList.add('show'));
    const close = () => { mask.classList.remove('show'); setTimeout(() => mask.remove(), 200); document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', e => { if (e.target === mask || e.target.closest('.ws-prev-x')) close(); });
    document.addEventListener('keydown', esc);
  }
  function flfBoxHTML(s) {
    const f = (slotData[s.k] || [])[0];
    if (!f) return `<button class="ws-flf-box" data-add="${s.k}" type="button"><span class="plus">＋</span><span class="lb">${s.label}</span></button>`;
    return `<div class="ws-flf-box filled" data-prev="${s.k}:0" title="点击预览">
      <span class="ws-flf-img" style="background:${f.g}"></span>
      <button class="ws-flf-x" data-rem="${s.k}:0" title="移除" type="button">✕</button>
      <span class="ws-flf-lb">${s.label}</span>
    </div>`;
  }
  function renderUploads() {
    const wrap = $('#dropFiles'), drop = $('#drop'); if (!wrap) return;
    if (drop) drop.classList.remove('show');
    const slots = slotsFor();
    if (!slots) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = 'block';
    // 首尾帧 → side-by-side 首帧 ⇌ 尾帧, boxes follow the chosen video ratio
    if (tool === 'flf') {
      const [rw, rh] = currentRatio().split(':');
      wrap.innerHTML = `<div class="ws-up ws-up--flf"><div class="ws-up-head"><label>首尾帧</label><span class="ws-up-tip">上传起止画面，生成平滑过渡</span></div>
        <div class="ws-flf" style="--flf-ar:${rw}/${rh}">${flfBoxHTML(slots[0])}<button class="ws-flf-arrow" data-swap="1" type="button" title="交换首尾帧">⇌</button>${flfBoxHTML(slots[1])}</div></div>`;
      return;
    }
    wrap.innerHTML = slots.map(uploadSlotHTML).join('');
  }
  function fillIdeas() {
    $('#ideas').innerHTML = IDEAS.map(t => `<button data-i="${t}">${t.slice(0, 10)}…</button>`).join('');
    $('#ideas').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $('#prompt').value = b.dataset.i; updateLen(); $('#prompt').focus();
    });
  }

  function updateLen() { const el = $('#pLen'); if (el) el.textContent = ($('#prompt').value || '').length; }
  function aiOptimize() {
    const ta = $('#prompt'); let v = ta.value.trim();
    if (!v) { v = '一幅富有想象力的画面'; }
    const boost = '，超清细节，电影级布光，景深层次，8K 高分辨率';
    if (!/超清细节/.test(v)) v += boost;
    ta.value = v; updateLen(); FX.toast('✦ 已用 AI 优化提示词'); ta.focus();
  }

  function renderModes(type) {
    curType = type;
    const keys = MODES_BY_TYPE[type];
    $('#mode-tabs').innerHTML = keys.map((k, i) =>
      `<button class="${i === 0 ? 'on' : ''}" data-tool="${k}">${TOOLS[k].label}</button>`).join('');
    applyTypeFields();
    setTool(keys[0]);
  }

  function setTool(t) {
    if (!TOOLS[t]) return;
    tool = t;
    const cfg = TOOLS[t];
    $$('#mode-tabs button').forEach(x => x.classList.toggle('on', x.dataset.tool === t));
    const head = $('.ws-phead'); if (head) head.innerHTML = '<span class="spark">✦</span> ' + cfg.head;
    $('#prompt').placeholder = cfg.ph;
    slotData = {};
    renderUploads();
    updateCost();
  }

  function currentRatio() { const b = $('#ratios .ratio.on'); return b ? b.dataset.r : '1:1'; }
  function updateCost() {
    let c;
    if (curType === 'video') c = Math.round((RES_COST[curRes] || 50) * (DUR_SEC[curDur] || 5) / 5);
    else c = (IMG_RES_COST[curImgRes] || 14) * count;
    $('#cost').textContent = c;
    syncProps();
  }
  function syncProps() {
    const pm = $('#pModel'); if (pm) pm.textContent = $('#model').value;
    const pr = $('#pRatio'); if (pr) pr.textContent = currentRatio();
    const pc = $('#pCount'); if (pc) pc.textContent = count;
    if (tool === 'flf') {
      const flf = $('.ws-flf'); // live-update box aspect to the chosen ratio (no re-render → keeps uploads)
      if (flf) { const [rw, rh] = currentRatio().split(':'); flf.style.setProperty('--flf-ar', `${rw}/${rh}`); }
    }
  }

  let genHist = [], stripItems = [], histFilterVal = 'all', histPage = 1;
  const PAGE_SIZE = 24; // items per page in the workspace history
  function histCardHTML(it, i) {
    return `<button class="ws-hcard" data-i="${i}" type="button"><span class="cov" style="background:${it.cover}"></span>${it.vid ? '<span class="vbadge">▶</span>' : ''}</button>`;
  }
  function renderStrip() {
    const strip = $('#histStrip'); if (!strip) return;
    stripItems = genHist.filter(x => histFilterVal === 'all' ? true : (histFilterVal === 'video' ? x.vid : !x.vid));
    const countEl = $('#histCount');
    if (countEl) countEl.textContent = stripItems.length || '';
    const pager = $('#histPager');
    if (!stripItems.length) {
      const what = histFilterVal === 'video' ? '视频' : histFilterVal === 'image' ? '图片' : '';
      strip.innerHTML = `<div class="ws-hempty">还没有${what}生成记录</div>`;
      if (pager) pager.innerHTML = '';
      return;
    }
    const pages = Math.ceil(stripItems.length / PAGE_SIZE);
    if (histPage > pages) histPage = pages;
    if (histPage < 1) histPage = 1;
    const start = (histPage - 1) * PAGE_SIZE;
    const pageItems = stripItems.slice(start, start + PAGE_SIZE);
    // data-i is the absolute index into stripItems so click handler stays correct
    strip.innerHTML = pageItems.map((it, k) => histCardHTML(it, start + k)).join('');
    strip.scrollTop = 0;
    if (pager) {
      pager.innerHTML = pages > 1
        ? `<button class="ws-pprev" type="button"${histPage <= 1 ? ' disabled' : ''}>‹</button>`
          + `<span class="ws-pcur">${histPage} / ${pages}</span>`
          + `<button class="ws-pnext" type="button"${histPage >= pages ? ' disabled' : ''}>›</button>`
        : '';
    }
  }
  function pushHistory(cover, isVid, prompt) {
    genHist.unshift({ cover, vid: isVid, prompt });
    histPage = 1; // jump to first page so the newest item is visible
    renderStrip();
  }
  function seedHistory() {
    const A = ARTWORKS || [];
    // seed enough to span multiple pages so pagination is visible
    for (let i = 0; i < 31; i++) {
      const a = A[i % A.length] || {};
      genHist.push({ cover: a.c, vid: a.type === 'video', prompt: a.titleCn || a.title || '示例作品' });
    }
    renderStrip();
  }

  function rhRefThumbs(seed) {
    let imgs = [];
    Object.keys(slotData).forEach(k => (slotData[k] || []).forEach(f => { if (f.g) imgs.push(f.g); }));
    if (!imgs.length) imgs = Array.from({ length: 4 }, (_, i) => { const h = (seed * 7 + i * 53) % 360; return `linear-gradient(135deg, hsl(${h} 50% 46%), hsl(${(h + 38) % 360} 55% 30%))`; });
    return imgs.slice(0, 4).map(g => `<span class="ws-rh-ref" style="background:${g}"></span>`).join('');
  }
  function generate() {
    if (busy) return;
    const prompt = $('#prompt').value.trim();
    if (!prompt) { FX.toast('先写一句提示词吧 ✦'); $('#prompt').focus(); return; }
    busy = true;
    const gen = $('#gen'); gen.classList.add('busy');
    $('#empty').style.display = 'none';
    const grid = $('#grid'); grid.style.display = 'grid';
    const clearBtn = $('#clearBtn'); if (clearBtn) clearBtn.disabled = false;
    const [rw, rh] = currentRatio().split(':').map(Number);
    let hsh = 0; for (let i = 0; i < prompt.length; i++) hsh = (hsh * 31 + prompt.charCodeAt(i)) % 360;
    const covers = Array.from({ length: count }, (_, i) => mesh(hsh + i * 36, hsh + i * 36 + 80, hsh + i * 36 + 200));
    const isVid = TOOLS[tool].mode === 't2v';
    const model = $('#model').value;
    const spec = isVid ? `${currentRatio()} · ${curRes} · ${curDur}` : `${currentRatio()} · ${curImgRes}`;
    const safePrompt = prompt.replace(/</g, '&lt;');
    const headHTML = `<div class="ws-result-head" id="resultHead" data-state="gen">
        <div class="ws-rh-style">
          <div class="ws-rh-refs">${rhRefThumbs(hsh)}</div>
          <div class="ws-rh-sbody">
            <div class="ws-rh-prompt"><b>【风格】</b> ${safePrompt}</div>
            <div class="ws-rh-meta">
              <span class="ws-rh-model"><span class="sw" style="background:${modelSwatch(model)}">${modelInitial(model)}</span>${model}</span>
              <span class="ws-rh-dot">·</span><span>${spec}</span>
              <button class="ws-rh-info" type="button" data-toast="生成参数详情 · 原型">详细信息 ⓘ</button>
            </div>
          </div>
        </div>
        <div class="ws-rh-foot">
          <div class="ws-rh-main">
            <div class="ws-rh-title"><span class="ws-rh-spin"></span><span id="rhStatus">正在生成 ${count} 张…</span></div>
            <div class="ws-rh-prog"><i id="rhBar"></i></div>
          </div>
          <div class="ws-rh-acts" id="rhActs">
            <button type="button" id="rhCancel">✕ 取消</button>
          </div>
        </div>
      </div>`;

    grid.innerHTML = headHTML + covers.map((c, i) => `
      <div class="gen-cell" data-i="${i}" style="aspect-ratio:${rw}/${rh}">
        <div class="done-cov" style="background:${c}"></div>
        <div class="shimmer"></div>
        <div class="ph">生成中 · <span class="pct">0%</span></div>
        <div class="bar"><i></i></div>
        <span class="reveal-tag">✦ 刚刚生成</span>
        <div class="gen-acts">
          <button type="button" data-act="edit">✎ 编辑</button>
          <button type="button" data-act="regen">↻ 重新生成</button>
          <button type="button" data-act="del">🗑 删除</button>
        </div>
      </div>`).join('');

    const cells = $$('#grid .gen-cell');
    const ticks = []; const progs = new Array(cells.length).fill(0); let doneCount = 0;
    function setDoneHead() {
      const head = $('#resultHead'); if (!head) return;
      head.dataset.state = 'done';
      const st = $('#rhStatus'); if (st) st.textContent = `已生成 ${cells.length} 张 · 点击查看大图`;
      const acts = $('#rhActs'); if (acts) acts.innerHTML = '';
    }
    const rhCancel = $('#rhCancel');
    if (rhCancel) rhCancel.addEventListener('click', () => {
      ticks.forEach(t => clearInterval(t));
      busy = false; gen.classList.remove('busy');
      clearCanvas(); FX.toast('已取消生成');
    });
    cells.forEach((cell, i) => {
      let p = 0;
      const bar = cell.querySelector('.bar i'), pct = cell.querySelector('.pct');
      const speed = 1.4 + Math.random() * 1.2;
      const tick = setInterval(() => {
        p = Math.min(100, p + speed + Math.random() * 3);
        progs[i] = p;
        bar.style.width = p + '%'; if (pct) pct.textContent = Math.round(p) + '%';
        const rhBar = $('#rhBar'); if (rhBar) rhBar.style.width = (progs.reduce((a, b) => a + b, 0) / cells.length) + '%';
        if (p >= 100) {
          clearInterval(tick);
          cell.classList.add('done');
          doneCount++;
          const st = $('#rhStatus'); if (st && doneCount < cells.length) st.textContent = `正在生成 ${doneCount}/${cells.length}…`;
          pushHistory(covers[i], isVid, prompt);
          cell.addEventListener('click', () => FX.openWork({
            c: covers[i], h: 1, type: isVid ? 'video' : 'image',
            cat: '创作', model: $('#model').value, title: prompt.slice(0, 14) + (prompt.length > 14 ? '…' : ''),
            author: '我的创作', likes: 0, prompt,
          }));
          const acts = cell.querySelector('.gen-acts');
          if (acts) acts.addEventListener('click', (ev) => {
            const b = ev.target.closest('button'); if (!b) return;
            ev.stopPropagation();
            const act = b.dataset.act;
            if (act === 'del') { cell.style.transition = 'opacity .2s, transform .2s'; cell.style.opacity = '0'; cell.style.transform = 'scale(.92)'; setTimeout(() => cell.remove(), 200); FX.toast('已删除'); }
            else if (act === 'regen') { $('#prompt').value = prompt; updateLen(); FX.toast('已带入提示词 · 可重新生成'); }
            else { FX.toast('编辑 · 高保真原型'); }
          });
          if (doneCount === cells.length) {
            busy = false; gen.classList.remove('busy'); setDoneHead();
            const g2 = $('#grid');
            if (g2 && !g2.querySelector('.ws-result-foot')) {
              const foot = document.createElement('div');
              foot.className = 'ws-result-foot';
              foot.innerHTML = '<button type="button" data-fa="edit"><span class="i">✎</span>重新编辑</button><button type="button" data-fa="regen"><span class="i">↻</span>再次生成</button><button type="button" data-fa="more" data-toast="更多 · 下载 / 收藏 / 分享">⋯</button>';
              foot.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-fa]'); if (!b) return;
                if (b.dataset.fa === 'edit') { $('#prompt').value = prompt; updateLen(); $('#prompt').focus(); FX.toast('已载入提示词，可继续编辑'); }
                else if (b.dataset.fa === 'regen') { if (!busy) generate(); }
              });
              g2.appendChild(foot);
            }
            FX.toast('生成完成 · 点击作品查看详情');
          }
        }
      }, 90 + i * 40);
      ticks.push(tick);
    });
  }

  function clearCanvas() {
    if (busy) return;
    $('#grid').style.display = 'none';
    $('#grid').innerHTML = '';
    $('#empty').style.display = 'flex';
    const cb = $('#clearBtn'); if (cb) cb.disabled = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    FX.mountChrome('create');
    fillModelMenu(); fillRatios(); fillResDur(); fillImgRes(); fillIdeas(); renderModes('image'); applyTypeFields(); syncModel(); updateLen(); seedHistory();

    $('#prompt').addEventListener('input', updateLen);
    $('#aiOpt').addEventListener('click', aiOptimize);
    $('#pClear').addEventListener('click', () => { $('#prompt').value = ''; updateLen(); $('#prompt').focus(); });

    // type tabs (图片 / 视频)
    $('#type-tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#type-tabs button').forEach(x => x.classList.toggle('on', x === b));
      renderModes(b.dataset.type);
    });
    // mode seg (generation tool)
    $('#mode-tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      setTool(b.dataset.tool);
    });
    // empty-state capability tags → jump straight to that type + mode
    $('.ws-empty-tags').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#type-tabs button').forEach(x => x.classList.toggle('on', x.dataset.type === b.dataset.type));
      renderModes(b.dataset.type);
      setTool(b.dataset.tool);
      $('#prompt').focus();
    });
    // typed reference uploads (image / video / audio slots)
    $('#drop').addEventListener('click', () => { const s = slotsFor(); if (s) addFile(s[0].k); });
    $('#dropFiles').addEventListener('click', (e) => {
      const swap = e.target.closest('[data-swap]');
      if (swap) {
        e.stopPropagation();
        const a = slotData.first, b = slotData.last;
        if (a || b) { slotData.first = b; slotData.last = a; FX.toast('已交换首尾帧'); renderUploads(); }
        return;
      }
      const rem = e.target.closest('[data-rem]');
      if (rem) { e.stopPropagation(); const [k, i] = rem.dataset.rem.split(':'); removeFile(k, +i); return; }
      const add = e.target.closest('[data-add]');
      if (add) { e.stopPropagation(); addFile(add.dataset.add); return; }
      const prev = e.target.closest('[data-prev]');
      if (prev) { const [k, i] = prev.dataset.prev.split(':'); openPreview(k, +i); }
    });

    $('#count').addEventListener('input', e => { count = +e.target.value; $('#countVal').textContent = count; updateCost(); });
    // custom model dropdown
    $('#modelCard').addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = $('#modelCard').parentElement;
      openModelMenu(!wrap.classList.contains('open'));
    });
    $('#modelMenu').addEventListener('click', (e) => {
      const b = e.target.closest('.ws-mopt'); if (!b) return;
      $('#model').value = b.dataset.m;
      fillModelMenu(); syncModel(); openModelMenu(false);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.ws-model-wrap')) openModelMenu(false);
    });
    $('#gen').addEventListener('click', generate);
    const cb = $('#clearBtn'); if (cb) cb.addEventListener('click', clearCanvas);

    // history media filter (全部 / 图片 / 视频)
    $('#histFilter').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      histFilterVal = b.dataset.f;
      histPage = 1;
      $$('#histFilter button').forEach(x => x.classList.toggle('on', x === b));
      renderStrip();
    });
    $('#histStrip').addEventListener('click', e => {
      const c = e.target.closest('.ws-hcard'); if (!c) return;
      const it = stripItems[+c.dataset.i]; if (!it) return;
      FX.openWork({ c: it.cover, h: 1, type: it.vid ? 'video' : 'image', cat: '创作', model: $('#model').value, title: (it.prompt || '我的创作').slice(0, 14), author: '我的创作', likes: 0, prompt: it.prompt || '' });
    });
    $('#histPager').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      histPage += b.classList.contains('ws-pnext') ? 1 : -1;
      renderStrip();
    });

    // ambient shader backdrop
    if (window.FluxField) window.FluxField.mount($('#flux'), { hue: 1.1, speed: 0.7, scale: 1.0, intensity: 0.85, variant: 0 });

    // accept a prompt handoff from "生成同款"
    try { const p = sessionStorage.getItem('flux_prompt'); if (p) { $('#prompt').value = p; updateLen(); sessionStorage.removeItem('flux_prompt'); } } catch (e) {}
  });
})();
