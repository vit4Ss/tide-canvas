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
  ];

  const REPLIES = [
    '收到，我来基于你的描述继续推进。可以告诉我更偏向哪种风格或情绪吗？',
    '好的，已记录。要我先出分镜脚本，还是直接生成画面？',
    '明白！我建议先确定主色调与镜头节奏，这样成片更统一。需要我给几个方案吗？',
    '这个方向很棒 ✦ 我已经准备好了，确认后即可开始生成。',
  ];

  function bubble(m) {
    return `<div class="msg ${m.who === 'me' ? 'me' : 'ai'}"><span class="av"></span><div class="bubble">${m.html}</div></div>`;
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
      msgs.push({ who: 'ai', html: REPLIES[Math.floor(Math.random() * REPLIES.length)] });
      renderThread(msgs); busy = false; $('#chatSend').disabled = false;
    }, 1100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderConvos();
    renderThread(msgs);
    const ta = $('#composer');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#chatSend').addEventListener('click', send);
    $('#chatNew').addEventListener('click', () => { msgs = [{ who: 'ai', html: '新对话已开启 ✦ 想创作点什么？' }]; renderThread(msgs); $('#chatTitle').textContent = '新对话'; });
    $$('.cm-chip[data-toggle]').forEach(c => c.addEventListener('click', () => c.classList.toggle('on')));
    const up = $('#cmUpload'); if (up) up.addEventListener('click', () => FX && FX.toast && FX.toast('上传参考素材 · 高保真原型'));
  });
})();
