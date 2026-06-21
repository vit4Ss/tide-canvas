/* SCARECROWAI 流光 — 创作台 workstation (prototype generate flow) */
(function () {
  const H = window.HOME, FX = window.FX;
  const { CREATE_MODELS, ARTWORKS, mesh } = H;
  const { $, $$ } = FX;

  const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16'];
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
    setTool(keys[0]);
  }

  function setTool(t) {
    if (!TOOLS[t]) return;
    tool = t;
    const cfg = TOOLS[t];
    $$('#mode-tabs button').forEach(x => x.classList.toggle('on', x.dataset.tool === t));
    const head = $('.ws-phead'); if (head) head.innerHTML = '<span class="spark">✦</span> ' + cfg.head;
    $('#prompt').placeholder = cfg.ph;
    $('#drop').classList.toggle('show', cfg.drop);
    updateCost();
  }

  function currentRatio() { const b = $('#ratios .ratio.on'); return b ? b.dataset.r : '1:1'; }
  function updateCost() {
    const per = $('#model').value.match(/Seedance|Kling|Veo|视频/) || tool === 't2v' ? 30 : 10;
    $('#cost').textContent = per * count;
    syncProps();
  }
  function syncProps() {
    const pm = $('#pModel'); if (pm) pm.textContent = $('#model').value;
    const pr = $('#pRatio'); if (pr) pr.textContent = currentRatio();
    const pc = $('#pCount'); if (pc) pc.textContent = count;
  }

  let histCount = 0;
  function pushHistory(cover, isVid, prompt) {
    const strip = $('#histStrip'); if (!strip) return;
    const ph = strip.querySelector('.ws-hempty'); if (ph) ph.remove();
    const card = document.createElement('button');
    card.className = 'ws-hcard'; card.type = 'button'; card.dataset.htype = isVid ? 'video' : 'image';
    card.innerHTML = `<span class="cov" style="background:${cover}"></span>${isVid ? '<span class="vbadge">▶</span>' : ''}`;
    card.addEventListener('click', () => FX.openWork({ c: cover, h: 1, type: isVid ? 'video' : 'image', cat: '创作', model: $('#model').value, title: (prompt || '我的创作').slice(0, 14), author: '我的创作', likes: 0, prompt }));
    strip.prepend(card);
    const af = $('#histFilter .on'); if (af && af.dataset.f !== 'all' && card.dataset.htype !== af.dataset.f) card.style.display = 'none';
    histCount++; const n = $('#histN'); if (n) n.textContent = histCount;
  }
  function filterHistory(f) {
    $$('#histStrip .ws-hcard').forEach(c => {
      c.style.display = (f === 'all' || c.dataset.htype === f) ? '' : 'none';
    });
  }
  function seedHistory() {
    const pool = (ARTWORKS || []).slice(0, 12);
    // oldest first so prepend leaves newest on the left
    pool.slice().reverse().forEach(a => pushHistory(a.c, a.type === 'video', a.titleCn || a.title || '示例作品'));
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
    const modeLabel = TOOLS[tool].label;
    const headHTML = `<div class="ws-result-head" id="resultHead" data-state="gen">
        <div class="ws-rh-main">
          <div class="ws-rh-title"><span class="ws-rh-spin"></span><span id="rhStatus">正在生成 ${count} 张…</span></div>
          <div class="ws-rh-meta">
            <span class="ws-rh-chip"><i class="dot"></i>${modeLabel}</span>
            <span class="ws-rh-chip">${$('#model').value}</span>
            <span class="ws-rh-chip">${currentRatio()}</span>
            <span class="ws-rh-chip">×${count}</span>
          </div>
          <div class="ws-rh-prog"><i id="rhBar"></i></div>
        </div>
        <div class="ws-rh-acts" id="rhActs">
          <button type="button" id="rhCancel">✕ 取消</button>
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
      const st = $('#rhStatus'); if (st) st.textContent = prompt.slice(0, 40) + (prompt.length > 40 ? '…' : '');
      const acts = $('#rhActs');
      if (acts) {
        acts.innerHTML = '<button type="button" id="rhRegen">↻ 重新生成</button><button type="button" id="rhDl">⤓ 下载全部</button>';
        $('#rhRegen').addEventListener('click', () => { if (!busy) generate(); });
        $('#rhDl').addEventListener('click', () => FX.toast('已下载全部 · 原型'));
      }
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
          if (doneCount === cells.length) { busy = false; gen.classList.remove('busy'); setDoneHead(); FX.toast('生成完成 · 点击作品查看详情'); }
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
    fillModelMenu(); fillRatios(); fillIdeas(); renderModes('image'); syncModel(); updateLen(); seedHistory();

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
    // drop zone (prototype)
    $('#drop').addEventListener('click', () => FX.toast('选择参考图 · 高保真原型'));

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

    // history type filter
    $('#histFilter').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#histFilter button').forEach(x => x.classList.toggle('on', x === b));
      filterHistory(b.dataset.f);
    });

    // ambient shader backdrop
    if (window.FluxField) window.FluxField.mount($('#flux'), { hue: 1.1, speed: 0.7, scale: 1.0, intensity: 0.85, variant: 0 });

    // accept a prompt handoff from "生成同款"
    try { const p = sessionStorage.getItem('flux_prompt'); if (p) { $('#prompt').value = p; updateLen(); sessionStorage.removeItem('flux_prompt'); } } catch (e) {}
  });
})();
