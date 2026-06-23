/* SCARECROWAI 流光 — 对话式生成 chat */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const FX = window.FX;

  const CONVOS = [
    { t: '守护者 · 影片创作', on: true },
    { t: '赛博朋克城市海报', on: false },
    { t: '国风 Q 版头像', on: false },
    { t: '产品视频脚本', on: false },
  ];

  const SEED = [
    { who: 'ai', html: '你好！我是你的 SCARECROW 创作助手。告诉我你想创作的内容 —— 图片、视频、剧本或灵感，我来帮你一步步完成。' },
    { who: 'me', html: '帮我构思一个 20 分钟的抗战题材短片,主题是"守护"。' },
    { who: 'ai', html: '<p>好的，已为「守护」主题搭建创作框架：</p><ol><li><strong>外部风暴</strong>：以纪实语言表现 1941–1942 年的大规模扫荡，铁蹄、拉网战术。</li><li><strong>内部守护</strong>：普通农民像守护生命一样守护一面旗帜，强调"守"而非"战"。</li><li><strong>最终结局</strong>：抗战胜利后，旗帜被迎回再次升起。</li></ol><p>下一步，你想先确认 20 分钟整体结构，还是直接推进"扫荡与守护"段落的分镜？</p>' },
    { who: 'me', html: '先生成几张关键场景的概念图。' },
    { who: 'ai', html: '<p>已根据剧情生成 4 张关键场景概念图（雪原扫荡 / 山洞藏旗 / 守护群像 / 旗帜升起）：</p><div class="imgrow"><div class="ph" style="background:linear-gradient(135deg,#6d8bf5,#9b7bf0)"></div><div class="ph" style="background:linear-gradient(135deg,#57c9e8,#6d8bf5)"></div><div class="ph" style="background:linear-gradient(135deg,#9b7bf0,#e0567f)"></div><div class="ph" style="background:linear-gradient(135deg,#f4b740,#e0567f)"></div></div>' },
    { who: 'me', html: '把第 4 张「旗帜升起」做成 15 秒的开场镜头。' },
    {
      who: 'ai', kind: 'result',
      style: '16:9 横版，8K UHD，HDR10+，60fps。好莱坞历史剧情片基底，冯小刚《1942》式写实，24fps。室内夜景，两盏豆油灯暖黄火光。手持微呼吸感转稳定，浅景深 f/1.8。35mm 柯达 Portra 400 胶片颗粒质感，1.85:1。',
      model: '即梦 Seedance 2.0 Fast', spec: '16:9 · 1080p · 15s', ar: '16/9',
      refs: ['linear-gradient(135deg,#3a4a6b,#1e2740)', 'linear-gradient(135deg,#b03b3b,#7a1f1f)', 'linear-gradient(135deg,#c9a23a,#7a5a12)', 'linear-gradient(135deg,#4a5240,#23281c)'],
      cover: 'linear-gradient(160deg,#5a2d2d 0%,#3a1e1e 45%,#1a1414 100%)', video: true,
    },
  ];

  const REPLIES = [
    '收到，我来基于你的描述继续推进。可以告诉我更偏向哪种风格或情绪吗？',
    '好的，已记录。要我先出分镜脚本，还是直接生成画面？',
    '明白！我建议先确定主色调与镜头节奏，这样成片更统一。需要我给几个方案吗？',
    '这个方向很棒 ✦ 我已经准备好了，确认后即可开始生成。',
  ];

  /* ── composer config: linked dropdowns ───────────────────────────── */
  const TYPES = [
    { k: 't2i', label: '文生图', kind: 'image', hint: '文字生成图片' },
    { k: 'i2i', label: '图生图', kind: 'image', hint: '参考图生成图片' },
    { k: 't2v', label: '文生视频', kind: 'video', hint: '文字生成视频' },
    { k: 'i2v', label: '图生视频', kind: 'video', hint: '参考图生成视频' },
  ];
  const IMG_MODELS = ['GPT Image 2', 'Flux.1 Pro', 'Midjourney v6', 'Nano Banana 2', '即梦 3.0', 'SDXL Lightning'];
  const VID_MODELS = ['Kling-VIDEO-3.0-Pro', 'Seedance 2.0', '可灵 Kling 1.6', 'Veo 3', 'Hailuo 02'];
  const MODEL_META = {
    'GPT Image 2': { tag: 'HD', by: 'OpenAI', desc: '万能画风 · 超清细节' },
    'Flux.1 Pro': { tag: 'PRO', by: 'Black Forest', desc: '写实质感 · 精准构图' },
    'Midjourney v6': { tag: 'ART', by: 'Midjourney', desc: '艺术氛围 · 电影光影' },
    'Nano Banana 2': { tag: 'NEW', by: 'Google', desc: '极速出图 · 风格百变' },
    '即梦 3.0': { tag: 'CN', by: '字节跳动', desc: '中文语义 · 国风擅长' },
    'SDXL Lightning': { tag: '4×', by: 'Stability', desc: '秒级生成 · 开源高效' },
    'Kling-VIDEO-3.0-Pro': { tag: 'VID', by: '快手', desc: '长镜头 · 物理真实' },
    'Seedance 2.0': { tag: 'VID', by: '字节跳动', desc: '视听双绝 · 镜头流畅' },
    '可灵 Kling 1.6': { tag: 'VID', by: '快手', desc: '稳定运动 · 高一致性' },
    'Veo 3': { tag: '4K', by: 'Google', desc: '电影质感 · 原生音轨' },
    'Hailuo 02': { tag: 'NEW', by: 'MiniMax', desc: '灵动表演 · 自然光影' },
  };
  const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  const IMG_RES = [['1K', '1024 px'], ['2K', '2048 px'], ['4K', '4096 px · 超清']];
  const VID_RES = [['720p', '高清'], ['1080p', '全高清'], ['4K', '电影级 · 限部分模型']];
  const DURS = [['5s', '短片段'], ['10s', '长镜头']];
  const IMG_COUNTS = [1, 2, 4];
  const VID_COUNTS = [1, 2];

  // per-unit credit cost (prototype)
  const RES_COST = { '1K': 6, '2K': 12, '4K': 28, '720p': 30, '1080p': 50 };
  const DUR_MULT = { '5s': 1, '10s': 2 };

  const STATE = { type: 't2v', model: 'Kling-VIDEO-3.0-Pro', ratio: '16:9', res: '1080p', dur: '5s', count: 2 };

  function typeOf() { return TYPES.find(t => t.k === STATE.type); }
  function kindOf() { return typeOf().kind; }
  function modelsFor() { return kindOf() === 'video' ? VID_MODELS : IMG_MODELS; }
  function resFor() { return kindOf() === 'video' ? VID_RES : IMG_RES; }
  function countsFor() { return kindOf() === 'video' ? VID_COUNTS : IMG_COUNTS; }
  function modelSwatch(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 50) % 360} 80% 52%))`;
  }
  function modelInitial(n) { return n.replace(/[^A-Za-z一-龥]/g, '').charAt(0) || 'A'; }

  // when the type changes, re-resolve dependent fields
  function applyType(k) {
    STATE.type = k;
    const models = modelsFor();
    if (!models.includes(STATE.model)) STATE.model = models[0];
    const res = resFor().map(r => r[0]);
    if (!res.includes(STATE.res)) STATE.res = kindOf() === 'video' ? '1080p' : '2K';
    const counts = countsFor();
    if (!counts.includes(STATE.count)) STATE.count = counts[counts.length - 1];
  }

  function ratioBox(r) {
    const [w, h] = r.split(':').map(Number);
    const max = 16, bw = Math.round((w / Math.max(w, h)) * max), bh = Math.round((h / Math.max(w, h)) * max);
    return `<span class="cm-rt" style="width:${bw}px;height:${bh}px"></span>`;
  }

  function selHTML({ sel, label, lead, menuH, items, right }) {
    return `<div class="cm-sel" data-sel="${sel}">
      <button class="cm-chip" type="button" data-chip>${lead || ''}<span class="cm-lab">${label}</span><span class="cv">▾</span></button>
      <div class="cm-menu${right ? ' right' : ''}">
        <div class="cm-menu-h">${menuH}</div>
        ${items}
      </div>
    </div>`;
  }

  function renderBar() {
    const t = typeOf();
    // 类型
    const typeItems = TYPES.map(x => `
      <button class="cm-mitem${x.k === STATE.type ? ' on' : ''}" data-v="${x.k}">
        <span class="cm-ico">${x.kind === 'video' ? '▶' : '▦'}</span>
        <span class="nfo"><span class="nm">${x.label}</span><span class="ds">${x.hint}</span></span>
        <span class="ck">✓</span>
      </button>`).join('');
    // 模型
    const modelItems = modelsFor().map(m => {
      const meta = MODEL_META[m] || { tag: 'AI', by: '模型', desc: '高质量生成' };
      return `<button class="cm-mitem${m === STATE.model ? ' on' : ''}" data-v="${m}">
        <span class="cm-sw" style="background:${modelSwatch(m)}">${modelInitial(m)}</span>
        <span class="nfo"><span class="nm">${m}<i>${meta.tag}</i></span><span class="ds">${meta.by} · ${meta.desc}</span></span>
        <span class="ck">✓</span>
      </button>`;
    }).join('');
    // 比例
    const ratioItems = RATIOS.map(r => `
      <button class="cm-mitem${r === STATE.ratio ? ' on' : ''}" data-v="${r}">
        ${ratioBox(r)}<span class="nfo"><span class="nm">${r}</span></span><span class="ck">✓</span>
      </button>`).join('');
    // 分辨率
    const resItems = resFor().map(([v, d]) => `
      <button class="cm-mitem${v === STATE.res ? ' on' : ''}" data-v="${v}">
        <span class="nfo"><span class="nm">${v}</span><span class="ds">${d}</span></span><span class="ck">✓</span>
      </button>`).join('');
    // 数量
    const countItems = countsFor().map(c => `
      <button class="cm-mitem${c === STATE.count ? ' on' : ''}" data-v="${c}">
        <span class="cm-ico">⚲</span><span class="nfo"><span class="nm">${c} ${kindOf() === 'video' ? '段' : '张'}</span></span><span class="ck">✓</span>
      </button>`).join('');

    const chips = [
      selHTML({ sel: 'type', label: t.label, lead: `<span class="cm-ico lead">${t.kind === 'video' ? '▶' : '▦'}</span>`, menuH: '生成类型', items: typeItems }),
      selHTML({ sel: 'model', label: STATE.model, lead: `<span class="cm-sw sm" style="background:${modelSwatch(STATE.model)}">${modelInitial(STATE.model)}</span>`, menuH: '选择模型', items: modelItems }),
      selHTML({ sel: 'ratio', label: STATE.ratio, lead: ratioBox(STATE.ratio), menuH: '画面比例', items: ratioItems }),
      selHTML({ sel: 'res', label: STATE.res, menuH: '分辨率', items: resItems }),
    ];
    if (kindOf() === 'video') {
      const durItems = DURS.map(([v, d]) => `
        <button class="cm-mitem${v === STATE.dur ? ' on' : ''}" data-v="${v}">
          <span class="nfo"><span class="nm">${v}</span><span class="ds">${d}</span></span><span class="ck">✓</span>
        </button>`).join('');
      chips.push(selHTML({ sel: 'dur', label: STATE.dur, menuH: '时长', items: durItems }));
    }
    chips.push(selHTML({ sel: 'count', label: '⚲ ' + STATE.count, menuH: '生成数量', items: countItems, right: true }));

    $('#cmConfig').innerHTML = chips.join('');
    updatePts();
  }

  function updatePts() {
    const unit = RES_COST[STATE.res] || 12;
    const mult = kindOf() === 'video' ? (DUR_MULT[STATE.dur] || 1) : 1;
    $('#cmPts').textContent = unit * mult * STATE.count;
  }

  function onPick(sel, v) {
    if (sel === 'type') applyType(v);
    else if (sel === 'count') STATE.count = +v;
    else STATE[sel] = v;
    renderBar();
  }

  function closeMenus() {
    $$('#cmConfig .cm-sel.open').forEach(s => {
      s.classList.remove('open');
      const m = s.querySelector('.cm-menu');
      if (m) { m.style.position = ''; m.style.left = ''; m.style.right = ''; m.style.bottom = ''; }
    });
  }
  function positionMenu(sel) {
    const chip = sel.querySelector('[data-chip]'), menu = sel.querySelector('.cm-menu');
    const r = chip.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    if (menu.classList.contains('right')) { menu.style.right = (window.innerWidth - r.right) + 'px'; menu.style.left = 'auto'; }
    else {
      const mw = menu.offsetWidth || 190;
      let left = r.left;
      if (left + mw > window.innerWidth - 12) left = window.innerWidth - 12 - mw;
      menu.style.left = Math.max(12, left) + 'px'; menu.style.right = 'auto';
    }
  }
  function bindBar() {
    const cfg = $('#cmConfig');
    cfg.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-chip]');
      if (trigger) {
        e.stopPropagation();
        const sel = trigger.closest('.cm-sel');
        const wasOpen = sel.classList.contains('open');
        closeMenus();
        if (!wasOpen) { sel.classList.add('open'); positionMenu(sel); }
        return;
      }
      const item = e.target.closest('.cm-mitem');
      if (item) {
        e.stopPropagation();
        const sel = item.closest('.cm-sel').dataset.sel;
        closeMenus();
        onPick(sel, item.dataset.v);
      }
    });
    cfg.addEventListener('scroll', closeMenus, { passive: true });
    document.addEventListener('click', closeMenus);
    window.addEventListener('resize', closeMenus, { passive: true });
  }

  function hashStr(t) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 100000; return h; }
  function ratioAR(r) { return r.replace(':', '/'); }
  function coverGrad(s) { const h = s % 360; return `linear-gradient(155deg, hsl(${h} 42% 26%), hsl(${(h + 26) % 360} 38% 13%))`; }
  function refThumbs(s) { return Array.from({ length: 4 }, (_, i) => { const h = (s * 7 + i * 53) % 360; return `linear-gradient(135deg, hsl(${h} 48% 46%), hsl(${(h + 38) % 360} 54% 28%))`; }); }

  function resultCard(o) {
    const sw = o.sw || modelSwatch(o.model || 'A');
    const refs = (o.refs || refThumbs(hashStr(o.style || o.model || 'x'))).slice(0, 4)
      .map(c => `<span class="gr-ref" style="background:${c}"></span>`).join('');
    return `<div class="gen-card">
      <div class="gen-head">
        <div class="gr-refs">${refs}</div>
        <div class="gr-body">
          <div class="gr-text"><b>【风格】</b> ${o.style}</div>
          <div class="gr-meta">
            <span class="gr-model"><span class="gr-sw" style="background:${sw}">${modelInitial(o.model || 'A')}</span>${o.model}</span>
            <span class="gr-dot">·</span><span class="gr-spec">${o.spec}</span>
            <button class="gr-info" type="button" data-toast="生成参数详情 · 原型">详细信息 <span class="i">ⓘ</span></button>
          </div>
        </div>
      </div>
      <div class="gen-img" style="aspect-ratio:${o.ar || '16/9'};background:${o.cover || coverGrad(hashStr(o.style || 'x'))}">
        ${o.video ? '<span class="gr-play">▶</span>' : ''}
        <span class="gr-tag">✦ 已生成</span>
      </div>
      <div class="gen-acts">
        <button type="button" data-act="edit"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>重新编辑</button>
        <button type="button" data-act="again"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>再次生成</button>
        <button type="button" class="gr-more" data-toast="更多 · 下载 / 收藏 / 分享">⋯</button>
      </div>
    </div>`;
  }

  function bubble(m) {
    const inner = m.kind === 'result' ? resultCard(m) : m.html;
    return `<div class="msg ${m.who === 'me' ? 'me' : 'ai'}"><span class="av"></span><div class="bubble">${inner}</div></div>`;
  }
  function renderThread(list) {
    $('#threadInner').innerHTML = list.map(bubble).join('');
    scrollEnd();
  }
  function scrollEnd() { const t = $('#thread'); t.scrollTop = t.scrollHeight; }

  let msgs = SEED.slice();

  function renderConvos() {
    $('#convos').innerHTML = '<div class="chat-ch">最近对话</div>' + CONVOS.map((c, i) =>
      `<div class="convo ${c.on ? 'on' : ''}" data-i="${i}"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="t">${c.t}</span></div>`).join('');
    $$('#convos .convo').forEach(c => c.addEventListener('click', () => {
      $$('#convos .convo').forEach(x => x.classList.remove('on')); c.classList.add('on');
      $('#chatTitle').textContent = CONVOS[+c.dataset.i].t;
    }));
  }

  let busy = false;
  function send() {
    const ta = $('#composer'); const v = ta.value.trim();
    if (!v || busy) return;
    msgs.push({ who: 'me', html: v.replace(/</g, '&lt;') });
    renderThread(msgs); ta.value = ''; ta.style.height = 'auto';
    busy = true; $('#chatSend').disabled = true;
    // typing indicator
    $('#threadInner').insertAdjacentHTML('beforeend', '<div class="msg ai" id="typing"><span class="av"></span><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>');
    scrollEnd();
    setTimeout(() => {
      const tn = $('#typing'); if (tn) tn.remove();
      const isVid = kindOf() === 'video';
      msgs.push({
        who: 'ai', kind: 'result', style: v,
        model: STATE.model, sw: modelSwatch(STATE.model),
        spec: STATE.ratio + ' · ' + STATE.res + (isVid ? ' · ' + STATE.dur : ''),
        ar: ratioAR(STATE.ratio), cover: coverGrad(hashStr(v)), video: isVid,
      });
      renderThread(msgs); busy = false; $('#chatSend').disabled = false;
    }, 1400);
  }

  function regen(styleText) {
    if (busy) return;
    const isVid = kindOf() === 'video';
    msgs.push({
      who: 'ai', kind: 'result', style: styleText,
      model: STATE.model, sw: modelSwatch(STATE.model),
      spec: STATE.ratio + ' · ' + STATE.res + (isVid ? ' · ' + STATE.dur : ''),
      ar: ratioAR(STATE.ratio), cover: coverGrad(hashStr(styleText + Math.random())), video: isVid,
    });
    renderThread(msgs); FX && FX.toast && FX.toast('已重新生成 ✦');
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderConvos();
    renderThread(msgs);
    const ta = $('#composer');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#chatSend').addEventListener('click', send);
    $('#chatNew').addEventListener('click', () => { msgs = [{ who: 'ai', html: '新对话已开启 ✦ 想创作点什么？' }]; renderThread(msgs); $('#chatTitle').textContent = '新对话'; });
    $('#cmWeb').addEventListener('click', () => $('#cmWeb').classList.toggle('on'));
    renderBar();
    bindBar();
    $('#threadInner').addEventListener('click', (e) => {
      const b = e.target.closest('.gen-acts [data-act]'); if (!b) return;
      const card = b.closest('.gen-card');
      const styleText = ((card.querySelector('.gr-text') || {}).textContent || '').replace('【风格】', '').trim();
      if (b.dataset.act === 'edit') { $('#composer').value = styleText; $('#composer').focus(); FX && FX.toast && FX.toast('已载入提示词，可继续编辑'); }
      else if (b.dataset.act === 'again') regen(styleText);
    });
    const up = $('#cmUpload'); if (up) up.addEventListener('click', () => FX && FX.toast && FX.toast('上传参考素材 · 高保真原型'));
  });
})();
