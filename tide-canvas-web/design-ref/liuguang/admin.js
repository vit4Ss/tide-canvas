/* SCARECROWAI 流光 — 后台管理控制台 admin
   Pure data-driven: nav config + per-section renderers. Mock data only. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const H = window.HOME || {};
  const mesh = H.mesh || ((a) => `hsl(${a} 70% 55%)`);
  const swatch = (n) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return `linear-gradient(135deg,hsl(${h} 78% 60%),hsl(${(h + 50) % 360} 78% 50%))`; };
  const ICON = {
    dash: 'M3 13h8V3H3zM13 21h8v-8h-8zM13 3v6h8V3zM3 21h8v-6H3z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    works: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    insp: 'M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1-1 2H9c0-1-.3-1.4-1-2A6 6 0 0 1 12 3z',
    log: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6',
    floor: 'M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-7h6v7',
    discover: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    model: 'M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 2v18M4 6.5l8 4.5 8-4.5',
    res: 'M3 7l2-3h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z',
    credit: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.5 9.5a2.5 2.5 0 0 1 5 0M12 7v1M12 16v1M9 14h6',
    price: 'M20 12l-8 8-9-9V4h7zM7.5 7.5h.01',
    pay: 'M2 7h20v12H2zM2 11h20M6 15h4',
    chart: 'M3 3v18h18M7 14l3-4 3 3 4-6',
    promo: 'M3 11l18-5v12L3 14v-3zM7 12v6a2 2 0 0 0 4 0v-5',
    cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 14H4a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 8.4l-.38-.38a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6V4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11H20a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  };

  /* ---------- nav config ---------- */
  const NAV = [
    { g: '总览' },
    { id: 'dash', label: '数据概览', icon: 'dash' },
    { g: '运营' },
    { id: 'users', label: '用户管理', icon: 'users', badge: '5.2M' },
    { id: 'works', label: '作品管理', icon: 'works' },
    { id: 'insp', label: '灵感管理', icon: 'insp' },
    { id: 'logs', label: '日志管理', icon: 'log' },
    { g: '内容' },
    { id: 'floor', label: '首页楼层', icon: 'floor' },
    { id: 'discover', label: '发现管理', icon: 'discover' },
    { id: 'models', label: '模型管理', icon: 'model' },
    { id: 'res', label: '资源管理', icon: 'res' },
    { g: '商业' },
    { id: 'credit', label: '积分管理', icon: 'credit' },
    { id: 'marketing', label: '营销管理', icon: 'promo' },
    { id: 'price', label: '价格管理', icon: 'price' },
    { id: 'pay', label: '支付管理', icon: 'pay' },
    { g: '系统' },
    { id: 'config', label: '配置管理', icon: 'cog' },
    { id: 'email', label: '邮件配置', icon: 'mail' },
  ];

  /* ---------- helpers ---------- */
  const kpi = (k, v, d, dir) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d ${dir || 'up'}">${d}</div>` : ''}</div>`;
  const kpis = (arr) => `<div class="adm-kpis">${arr.map(a => kpi(...a)).join('')}</div>`;
  const tag = (t, c) => `<span class="tag2 ${c}"><i class="dot"></i>${t}</span>`;
  const acts = (extra) => `<td><div class="rowacts">${(extra || ['编辑']).map(a => `<button class="${a === '删除' || a === '封禁' ? 'danger' : ''}">${a}</button>`).join('')}</div></td>`;
  const sw = (on) => `<span class="sw-toggle ${on ? 'on' : ''}"></span>`;
  function panel(title, sub, tools, inner) {
    return `<div class="adm-panel"><div class="adm-phead"><div><h2>${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="sp"></div><div class="adm-tools">${tools || ''}</div></div>${inner}</div>`;
  }
  function table(cols, rows) {
    return `<table class="adm-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  const filterChips = (arr) => arr.map((c, i) => `<button class="adm-chip ${i === 0 ? 'on' : ''}">${c}</button>`).join('');

  /* ---------- mock rows ---------- */
  const NAMES = ['夜航 NightSail', 'KENJI', '砚 Yan', 'Mira', 'Studio 3F', 'OceanLab', 'Vega', '稻田 Paddy', 'Aria Chen', 'L.Wong'];
  const MODELS = ['GPT Image 2', 'Flux.1 Pro', 'Midjourney v6', 'Nano Banana 2', 'Seedance 2.0', '可灵 Kling 1.6', '即梦 3.0', 'SDXL Lightning'];

  /* ---------- section renderers ---------- */
  const V = {};

  V.dashTables = () =>
    panel('实时运营', '近 24 小时关键指标', '<button class="adm-chip on">今日</button><button class="adm-chip">7 天</button><button class="adm-chip">30 天</button>',
      table(['时间', '事件', '模块', '数值', '状态'], [
        ['10:24', '生成峰值', '创作台', '12,400 / 分', tag('正常', 'green')],
        ['09:50', '新模型上线', '模型管理', 'Seedance 2.0', tag('已发布', 'blue')],
        ['08:31', '支付回调延迟', '支付管理', '+1.2s', tag('告警', 'amber')],
        ['02:10', '批量清理缓存', '资源管理', '38 GB', tag('完成', 'gray')],
      ].map(r => `<tr><td class="mono">${r[0]}</td><td class="strong">${r[1]}</td><td>${r[2]}</td><td class="mono">${r[3]}</td><td>${r[4]}</td></tr>`))) +
    panel('待办与审核', null, '<button class="adm-btn ghost">全部处理</button>',
      table(['类型', '内容', '提交人', '时间', '操作'], [
        ['作品举报', '涉嫌违规图像 ×3', '系统', '5 分钟前', tag('待审', 'amber')],
        ['提现申请', '¥2,400 创作者分成', 'KENJI', '1 小时前', tag('待审', 'amber')],
        ['模型申请', '社区 LoRA 上架', '砚 Yan', '3 小时前', tag('待审', 'amber')],
      ].map(r => `<tr><td class="strong">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="muted">${r[3]}</td><td>${r[4]}</td></tr>`)));

  V.users = () => kpis([
    ['总用户', '5,218,904', '+12,304 今日', 'up'],
    ['付费会员', '352,118', '+1.9%', 'up'],
    ['今日新增', '12,304', '+3.2%', 'up'],
    ['活跃率 DAU/MAU', '12.7%', '+0.4%', 'up'],
    ['封禁 / 风控', '1,206', '', 'down'],
  ]) +
    panel('用户列表', '管理账号、会员等级与风控状态',
      `<div class="adm-search" style="margin:0"><span class="muted">⌕</span><input placeholder="搜索用户 / 邮箱 / ID"></div><button class="adm-btn ghost">导出</button><button class="adm-btn">+ 新建用户</button>`,
      `<div class="adm-tools" style="padding:12px 18px 0">${filterChips(['全部', '免费', 'Pro 会员', '企业', '风控'])}</div>` +
      table(['用户', '等级', '积分余额', '本月消耗', '最近活跃', '状态', '操作'],
        NAMES.slice(0, 8).map((n, i) => `<tr>
          <td><div class="cellflex"><span class="av" style="background:${swatch(n)}"></span><div><div class="strong">${n}</div><div class="muted mono" style="font-size:11.5px">u_${(1000 + i * 137)}@mail.com</div></div></div></td>
          <td>${tag(['免费', 'Pro 会员', '企业'][i % 3], ['gray', 'blue', 'amber'][i % 3])}</td>
          <td class="mono">${(9000 - i * 820).toLocaleString()}</td>
          <td class="mono">${(1800 - i * 180).toLocaleString()}</td>
          <td class="muted">${['2 分钟前', '1 小时前', '今天', '昨天', '3 天前', '今天', '5 小时前', '刚刚'][i]}</td>
          <td>${tag(i === 4 ? '已封禁' : '正常', i === 4 ? 'red' : 'green')}</td>
          ${acts(['详情', i === 4 ? '解封' : '封禁'])}
        </tr>`))) +
    `<div class="adm-2col">` +
    panel('角色管理', '运营与后台角色', '<button class="adm-btn">+ 新建角色</button>',
      table(['角色', '成员', '范围', '操作'],
        [['超级管理员', '2', '全部'], ['运营', '6', '内容 + 用户'], ['内容审核', '9', '内容'], ['财务', '3', '商业'], ['客服', '14', '只读'], ['只读访客', '5', '查看']].map((r, i) => `<tr>
          <td class="strong">${r[0]}${i === 0 ? ' ' + tag('系统', 'amber') : ''}</td>
          <td class="mono">${r[1]}</td><td>${tag(r[2], 'blue')}</td>${acts(i === 0 ? ['权限'] : ['权限', '删除'])}
        </tr>`))) +
    panel('权限矩阵', '行=模块 · 列=角色', '<button class="adm-btn ghost">保存</button>',
      `<div class="fmatrix" style="margin:18px"><table>
        <thead><tr><th>模块 \\ 角色</th>${['超管', '运营', '审核', '财务', '客服'].map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${['用户管理', '作品管理', '灵感管理', '日志', '模型管理', '积分', '价格', '支付', '营销', '配置'].map((m, ri) => `<tr><td>${m}</td>${[0, 1, 2, 3, 4].map(ci => {
          const on = ci === 0 || (ci === 1 && ri < 9) || (ci === 2 && ri < 3) || (ci === 3 && (ri === 5 || ri === 6 || ri === 7)) || (ci === 4 && ri === 0);
          return `<td>${sw(on)}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`) +
    `</div>`;

  V.works = () => kpis([
    ['总作品', '208,441,920', '+1.9M 今日', 'up'],
    ['今日生成', '1,902,338', '+8.7%', 'up'],
    ['公开作品', '64,200,118', '', 'up'],
    ['举报待审', '38', '', 'down'],
  ]) +
    panel('作品库', '审核、下架与精选推荐',
      `${filterChips(['全部', '图片', '视频', '精选', '已举报'])}<button class="adm-btn ghost">批量下架</button>`,
      table(['作品', '作者', '模型', '点赞', '类型', '状态', '操作'],
        NAMES.slice(0, 6).map((n, i) => `<tr>
          <td><div class="cellflex"><span class="sw" style="background:${mesh(20 + i * 50, 60 + i * 40, 120 + i * 30)}"></span><span class="strong">作品 #${10240 + i}</span></div></td>
          <td>${n}</td><td class="muted">${MODELS[i % MODELS.length]}</td>
          <td class="mono">${(12000 - i * 1500).toLocaleString()}</td>
          <td>${tag(i % 3 === 0 ? '视频' : '图片', i % 3 === 0 ? 'blue' : 'gray')}</td>
          <td>${tag(i === 2 ? '已举报' : '已发布', i === 2 ? 'amber' : 'green')}</td>
          ${acts(['查看', '精选', '下架'])}
        </tr>`))) +
    panel('审核管理', '待审队列 · 机审 + 人工复核', `${filterChips(['全部', '待审', '机审拦截', '用户举报', '申诉'])}<button class="adm-btn">批量通过</button>`,
      table(['作品', '提交人', '来源', '风险标签', '机审分', '状态', '操作'],
        [['作品 #20451', 'KENJI', '用户举报', '涉政', 0.92, '待审'], ['作品 #20448', '夜航', '机审拦截', '血腥', 0.81, '待审'], ['作品 #20440', 'Mira', '机审拦截', '色情', 0.76, '待审'], ['作品 #20431', 'Vega', '申诉', '版权', 0.34, '复核'], ['作品 #20410', '砚 Yan', '用户举报', '其它', 0.21, '待审']].map((r, i) => `<tr>
          <td><div class="cellflex"><span class="sw" style="background:${mesh(40 + i * 44, 90 + i * 30, 160 + i * 20)}"></span><span class="strong">${r[0]}</span></div></td>
          <td>${r[1]}</td><td>${tag(r[2], r[2] === '机审拦截' ? 'red' : r[2] === '申诉' ? 'blue' : 'amber')}</td>
          <td>${tag(r[3], 'gray')}</td>
          <td class="mono" style="color:${r[4] > 0.7 ? '#e0334b' : r[4] > 0.4 ? '#bf7c00' : '#1a9d54'}">${r[4].toFixed(2)}</td>
          <td>${tag(r[5], r[5] === '复核' ? 'blue' : 'amber')}</td>
          <td><div class="rowacts"><button>通过</button><button class="danger">驳回</button></div></td>
        </tr>`))) +
    panel('审核策略', null, '<button class="adm-btn ghost">保存</button>',
      `<div style="padding:18px"><div class="cfg-grid">
        <div class="cfg-card"><h3>机器审核</h3><p>生成内容的自动安全检测。</p>
          <div class="cfg-row"><span class="lab">机审开关</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">自动拦截阈值</span><input type="number" value="0.75"><span class="unit">0–1</span></div>
          <div class="cfg-row"><span class="lab">人工复核阈值</span><input type="number" value="0.40"><span class="unit">0–1</span></div></div>
        <div class="cfg-card"><h3>送审范围</h3><p>哪些内容需要审核。</p>
          <div class="cfg-row"><span class="lab">公开作品先审后发</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">私有作品免审</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">视频抽帧审核</span>${sw(true)}</div></div>
        <div class="cfg-card"><h3>违规处置</h3><p>命中后的默认动作。</p>
          <div class="cfg-row"><span class="lab">命中即下架</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">累计 3 次封号</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">通知作者</span>${sw(true)}</div></div>
      </div></div>`);

  V.insp = () => kpis([
    ['灵感条目', '4,820', '+36 本周', 'up'],
    ['主题合集', '128', '', 'up'],
    ['提示词库', '12,640', '+210', 'up'],
    ['今日采用', '8,902', '+6%', 'up'],
  ]) +
    panel('灵感配置', '管理灵感页的标签、合集与精选',
      `${filterChips(['灵感', '主题', '提示词'])}<button class="adm-btn">+ 新增合集</button>`,
      table(['封面', '标题', '类型', '关联作品', '排序', '展示', '操作'],
        ['国风 Q 版', '赛博废土', '黄昏人像', '液态金属', '微缩星球'].map((t, i) => `<tr>
          <td><div class="cellflex"><span class="sw" style="background:${mesh(40 + i * 60, 90 + i * 30, 200 + i * 20)}"></span></div></td>
          <td class="strong">${t}</td><td>${tag(['合集', '主题', '提示词'][i % 3], 'blue')}</td>
          <td class="mono">${(320 - i * 40)}</td><td class="mono">${i + 1}</td>
          <td>${sw(i !== 3)}</td>${acts(['编辑', '删除'])}
        </tr>`)));

  V.logs = () => kpis([
    ['今日日志', '2,418,902', '', 'up'],
    ['错误率', '0.04%', '-0.01%', 'up'],
    ['告警', '12', '', 'down'],
    ['平均响应', '142ms', '-8ms', 'up'],
  ]) +
    panel('系统日志', '操作审计、错误与安全事件',
      `${filterChips(['全部', '操作审计', '错误', '安全', '支付'])}<button class="adm-btn ghost">导出</button>`,
      table(['时间', '级别', '模块', '操作 / 信息', '来源 IP', '操作人'],
        [['INFO', '用户登录成功', 'auth', '夜航 NightSail'], ['WARN', '支付回调超时重试', 'pay', '系统'], ['ERROR', '模型推理队列堆积', 'model', '系统'], ['INFO', '作品批量下架 ×12', 'works', 'admin'], ['SECURITY', '异常登录拦截', 'auth', '风控']].map((r, i) => `<tr>
          <td class="mono muted">2026-02-12 10:${20 - i}:0${i}</td>
          <td>${tag(r[0], { INFO: 'gray', WARN: 'amber', ERROR: 'red', SECURITY: 'blue' }[r[0]])}</td>
          <td class="mono">${r[2]}</td><td class="strong">${r[1]}</td>
          <td class="mono muted">10.2.${i}.${100 + i}</td><td>${r[3]}</td>
        </tr>`)));

  V.floor = () => panel('首页楼层管理', '拖拽排序，控制首页各楼层的展示与内容源',
    '<button class="adm-btn">+ 新增楼层</button>',
    `<div style="padding:16px 18px">` +
    [['英雄区 Hero', '主视觉 + Prompt 输入', true], ['能力展示', '4 张能力卡', true], ['无限画布', '节点画布演示', true], ['作品广场 Coverflow', '实时作品流', true], ['创作者榜', 'Top 10 创作者', false], ['价格方案', '三档套餐', true], ['FAQ', '常见问题', true]]
      .map((f, i) => `<div class="floor" data-floor="${f[0]}"><span class="grab">⋮⋮</span><span class="ix">${i + 1}</span><div><div class="nm">${f[0]}</div><div class="meta">${f[1]}</div></div><div class="sp"></div>${sw(f[2])}<div class="rowacts"><button>编辑</button><button>预览</button></div></div>`).join('') +
    `</div>`) +
    panel('楼层全局配置', null, '', `<div style="padding:18px"><div class="cfg-grid">
      <div class="cfg-card"><h3>背景流光</h3><p>首页连续着色器背景的默认预设与强度。</p>
        <div class="cfg-row"><span class="lab">默认预设</span><select><option>极光</option><option>星云</option><option>深海</option></select></div>
        <div class="cfg-row"><span class="lab">强度</span><input type="number" value="0.78"><span class="unit">0–1.5</span></div>
        <div class="cfg-row"><span class="lab">允许用户切换</span>${sw(true)}</div></div>
      <div class="cfg-card"><h3>首屏 CTA</h3><p>英雄区主按钮文案与跳转。</p>
        <div class="cfg-row"><span class="lab">按钮文案</span><input type="text" value="开始创作"></div>
        <div class="cfg-row"><span class="lab">跳转</span><select><option>创作台</option><option>定价</option></select></div></div>
    </div></div>`);

  V.discover = () => kpis([['推荐位', '24', '', 'up'], ['横幅 Banner', '6', '', 'up'], ['专题', '18', '+2', 'up'], ['今日曝光', '3.2M', '+4%', 'up']]) +
    panel('发现页配置', '管理发现页的推荐位、横幅与排序策略',
      `${filterChips(['推荐位', '横幅', '专题'])}<button class="adm-btn">+ 新增推荐位</button>`,
      table(['封面', '标题', '位置', '排序策略', '有效期', '状态', '操作'],
        ['本周精选', '新模型尝鲜', '国风专题', '年度盘点', '视频专区'].map((t, i) => `<tr>
          <td><div class="cellflex"><span class="sw" style="background:${mesh(80 + i * 40, 140 + i * 20, 60 + i * 50)}"></span></div></td>
          <td class="strong">${t}</td><td>${['首屏轮播', '中部推荐', '侧栏'][i % 3]}</td>
          <td>${tag(['热度', '最新', '人工'][i % 3], 'blue')}</td>
          <td class="muted">~ 02-2${i}</td><td>${sw(i !== 4)}</td>${acts(['编辑', '下线'])}
        </tr>`)));

  V.models = () => kpis([['接入模型', '32', '+1 本周', 'up'], ['图片模型', '20', '', 'up'], ['视频模型', '9', '', 'up'], ['平均时延', '3.4s', '-0.2s', 'up']]) +
    panel('模型管理', '接入、定价、限流与上下架',
      `${filterChips(['全部', '图片', '视频', '音频'])}<button class="adm-btn">+ 接入模型</button>`,
      table(['模型', '厂商', '类型', '单次积分', '调用量', '状态', '操作'],
        MODELS.slice(0, 7).map((m, i) => `<tr>
          <td><div class="cellflex"><span class="sw" style="background:${swatch(m)}">${''}</span><span class="strong">${m}</span></div></td>
          <td class="muted">${['OpenAI', 'Black Forest', 'Midjourney', 'Google', '字节跳动', '快手', '字节'][i]}</td>
          <td>${tag(i % 4 === 0 ? '视频' : '图片', i % 4 === 0 ? 'blue' : 'gray')}</td>
          <td class="mono">${[10, 12, 14, 10, 30, 30, 12][i]}</td>
          <td class="mono">${(1.2 - i * 0.12).toFixed(1)}M</td>
          <td>${sw(i !== 6)}</td>${acts(['配置', '限流'])}
        </tr>`)));

  V.res = () => kpis([['存储占用', '38.2 TB', '+1.1 TB', 'down'], ['CDN 月流量', '920 TB', '+6%', 'up'], ['素材库', '12,408', '', 'up'], ['回收待清', '38 GB', '', 'down']]) +
    panel('资源管理', '存储、CDN、素材与缓存',
      `${filterChips(['存储桶', '素材库', '字体', '缓存'])}<button class="adm-btn ghost">清理缓存</button>`,
      table(['资源', '类型', '大小', '引用', '更新时间', '状态', '操作'],
        [['works-images', '存储桶', '24.1 TB'], ['video-cache', 'CDN', '8.6 TB'], ['fonts', '字体库', '1.2 GB'], ['lora-weights', '模型权重', '4.3 TB'], ['temp-uploads', '临时', '38 GB']].map((r, i) => `<tr>
          <td class="strong mono">${r[0]}</td><td>${tag(r[1], 'gray')}</td><td class="mono">${r[2]}</td>
          <td class="mono">${(900 - i * 120)}k</td><td class="muted">12 分钟前</td>
          <td>${tag(i === 4 ? '待清理' : '健康', i === 4 ? 'amber' : 'green')}</td>${acts(['详情', '清理'])}
        </tr>`)));

  V.credit = () => kpis([['流通积分', '1.42 亿', '+3%', 'up'], ['今日消耗', '9.02M', '+8%', 'up'], ['今日充值', '¥182,400', '+12%', 'up'], ['赠送积分', '24.1M', '', 'up']]) +
    panel('积分规则', '消耗规则、赠送与有效期',
      '<button class="adm-btn">+ 新增规则</button>',
      table(['规则', '场景', '消耗 / 赠送', '触发条件', '状态', '操作'],
        [['文生图', '创作台', '-10 / 张', '每次生成'], ['文生视频', '创作台', '-30 / 段', '每次生成'], ['新用户礼包', '注册', '+200', '首次注册'], ['每日签到', '活跃', '+10', '每日一次'], ['邀请好友', '裂变', '+100', '成功邀请']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td>${r[1]}</td><td class="mono">${r[2]}</td><td class="muted">${r[3]}</td>
          <td>${sw(true)}</td>${acts(['编辑', '停用'])}
        </tr>`))) +
    panel('积分全局配置', null, '', `<div style="padding:18px"><div class="cfg-grid">
      <div class="cfg-card"><h3>有效期</h3><p>赠送积分的过期策略。</p>
        <div class="cfg-row"><span class="lab">赠送积分有效期</span><input type="number" value="90"><span class="unit">天</span></div>
        <div class="cfg-row"><span class="lab">充值积分</span><span class="muted">永久有效</span></div></div>
      <div class="cfg-card"><h3>汇率</h3><p>充值时的人民币与积分兑换比例。</p>
        <div class="cfg-row"><span class="lab">1 元 =</span><input type="number" value="100"><span class="unit">积分</span></div>
        <div class="cfg-row"><span class="lab">大额加赠</span>${sw(true)}</div></div>
    </div></div>`);

  V.price = () => kpis([['在售套餐', '3', '', 'up'], ['月付占比', '38%', '', 'up'], ['年付占比', '62%', '+4%', 'up'], ['ARPU', '¥58', '+5%', 'up']]) +
    panel('套餐管理', '会员套餐定价与权益',
      '<button class="adm-btn">+ 新增套餐</button>',
      table(['套餐', '月价', '年价', '每月积分', '权益', '状态', '操作'],
        [['体验版', '¥0', '¥0', '100', '基础模型'], ['创作者 Pro', '¥39', '¥468', '3,000', '全模型 · 高清'], ['企业版', '¥199', '¥1,990', '20,000', 'API · 商用授权']].map((r, i) => `<tr>
          <td class="strong">${r[0]}${i === 1 ? ' ' + tag('热门', 'amber') : ''}</td>
          <td class="mono">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono">${r[3]}</td>
          <td class="muted">${r[4]}</td><td>${sw(true)}</td>${acts(['编辑', '下架'])}
        </tr>`))) +
    panel('促销与折扣', null, '<button class="adm-btn ghost">+ 优惠券</button>',
      table(['活动', '类型', '力度', '有效期', '已用 / 限量', '状态'],
        [['限时年付', '直降', '-42%', '~ 02-29', '12.4k / ∞'], ['新人券', '满减', '¥20', '长期', '8.9k / 50k'], ['双十二', '折扣', '8 折', '已结束', '40k / 40k']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td>${r[1]}</td><td class="mono">${r[2]}</td><td class="muted">${r[3]}</td><td class="mono">${r[4]}</td>
          <td>${tag(i === 2 ? '已结束' : '进行中', i === 2 ? 'gray' : 'green')}</td>
        </tr>`)));

  V.pay = () => kpis([['今日交易', '¥384,920', '+11%', 'up'], ['成功率', '98.6%', '+0.2%', 'up'], ['退款', '¥4,210', '', 'down'], ['待对账', '6', '', 'down']]) +
    panel('支付渠道', '渠道开关、费率与回调',
      '<button class="adm-btn">+ 接入渠道</button>',
      table(['渠道', '类型', '费率', '今日金额', '回调', '状态', '操作'],
        [['微信支付', '扫码 / JSAPI', '0.6%', '¥182,400'], ['支付宝', '扫码 / APP', '0.6%', '¥150,200'], ['Apple IAP', '应用内', '15%', '¥38,900'], ['Stripe', '海外卡', '2.9%', '¥13,420']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td class="muted">${r[1]}</td><td class="mono">${r[2]}</td><td class="mono">${r[3]}</td>
          <td>${tag(i === 3 ? '延迟' : '正常', i === 3 ? 'amber' : 'green')}</td><td>${sw(i !== 2 ? true : true)}</td>${acts(['配置', '对账'])}
        </tr>`))) +
    panel('最近交易', null, '<button class="adm-btn ghost">导出流水</button>',
      table(['订单号', '用户', '套餐 / 商品', '金额', '渠道', '时间', '状态'],
        NAMES.slice(0, 5).map((n, i) => `<tr>
          <td class="mono muted">#PAY${20260212000 + i}</td><td>${n}</td>
          <td>${['创作者 Pro 年付', '积分 3000', '企业版 月付', '创作者 Pro 月付', '积分 1000'][i]}</td>
          <td class="mono strong">¥${['468', '198', '199', '39', '68'][i]}</td>
          <td>${['微信', '支付宝', 'Apple', '微信', 'Stripe'][i]}</td>
          <td class="muted">10:${30 - i}</td>
          <td>${tag(i === 4 ? '退款' : '成功', i === 4 ? 'red' : 'green')}</td>
        </tr>`)));

  /* ---------- modal ---------- */
  let admMask;
  function modal(title, bodyHTML, subtitle) {
    if (!admMask) {
      admMask = document.createElement('div'); admMask.className = 'adm-mask';
      admMask.innerHTML = '<div class="adm-modal"></div>';
      document.body.appendChild(admMask);
      admMask.addEventListener('click', e => { if (e.target === admMask) closeModal(); });
    }
    admMask.querySelector('.adm-modal').innerHTML =
      `<div class="adm-mhead"><div><h2>${title}</h2>${subtitle ? `<div class="mh-sub">${subtitle}</div>` : ''}</div><button class="x">✕</button></div>
       <div class="adm-mbody">${bodyHTML}</div>
       <div class="adm-mfoot"><span class="foot-note">变更将在保存后生效</span><button class="adm-btn ghost" data-close>取消</button><button class="adm-btn" data-save>保存</button></div>`;
    admMask.querySelector('.x').addEventListener('click', closeModal);
    admMask.querySelector('[data-close]').addEventListener('click', closeModal);
    admMask.querySelector('[data-save]').addEventListener('click', () => { closeModal(); });
    admMask.querySelectorAll('.mchip').forEach(c => c.addEventListener('click', () => {
      if (c.dataset.solo !== undefined) { c.parentElement.querySelectorAll('.mchip').forEach(x => x.classList.remove('on')); c.classList.add('on'); }
      else c.classList.toggle('on');
    }));
    void admMask.offsetWidth; admMask.classList.add('show');
  }
  function closeModal() { if (admMask) admMask.classList.remove('show'); }

  const chips = (arr, sel, solo) => `<div class="mchips">${arr.map(a => `<span class="mchip ${sel && sel.includes(a) ? 'on' : ''}" ${solo ? 'data-solo' : ''}>${a}</span>`).join('')}</div>`;

  function modelModal() {
    const quals = ['低画质', '标准画质', '高画质'], res = ['1K', '2K', '4K'];
    const matrix = `<div class="fmatrix"><table><thead><tr><th>画质 \\ 清晰度</th>${res.map(r => `<th>${r}</th>`).join('')}</tr></thead>
      <tbody>${quals.map(q => `<tr><td>${q}</td>${res.map(() => `<td><input placeholder="—"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    modal('新增模型', `
      <div class="fcard"><div class="ct">基础信息</div>
      <div class="fgrid">
        <div class="fld"><label>名称<span class="req">*</span></label><input placeholder="如：DALL·E 3"></div>
        <div class="fld"><label>模型 ID<span class="req">*</span></label><input placeholder="如：dall-e-3"></div>
        <div class="fld"><label>类型</label><select><option>图片生成</option><option>视频生成</option><option>音频生成</option></select></div>
        <div class="fld"><label>供应商</label><select><option>请选择供应商</option><option>OpenAI</option><option>Black Forest</option><option>字节跳动</option><option>快手</option></select></div>
        <div class="fld"><label>图标</label><input placeholder="emoji 或图片 URL"><span class="hint">显示在「Lib Image」模型选择处</span></div>
        <div class="fld col2"><label>描述</label><input placeholder="如：动漫高审美模型"><span class="hint">模型列表名称下副标题（选填）</span></div>
        <div class="fld"><label>预计耗时（秒）</label><input value="0"><span class="hint">列表右侧耗时徽标（0=不显示）</span></div>
      </div></div>

      <div class="fcard"><div class="ct">成本与计费</div>
      <div class="fgrid">
        <div class="fld col2"><label>消耗积分</label><input value="0.0"><span class="hint">支持小数；按「单价×张数×团队系数」总价</span></div>
        <div class="fld col2"><label>成本价（USD）</label><input value="0.0000"><span class="hint">上游单次成本，仅后台参考毛利，不对用户暴露</span></div>
      </div></div>

      <div class="fcard"><div class="ct">能力与限制</div>
      <div class="fsec"><span class="lab">支持的生成方式</span>${chips(['文生图', '图生图'], ['文生图'])}<div class="hint">不勾选 = 不限制（画布显示全部模式）</div></div>
      <div class="fsec"><span class="lab">出图张数档位</span>${chips(['1 张', '2 张', '3 张', '4 张'], ['1 张', '2 张', '4 张'])}<div class="hint">Midjourney 等固定 4 张只勾「4 张」，不勾用默认(1/2/4)</div></div>
      <div class="fsec"><span class="lab">上游四宫格输出</span>${chips(['是（单张 2×2 合图）', '否（独立多张）'], ['否（独立多张）'], true)}<div class="hint">Midjourney 原生输出为一张 2×2 合图时选「是」，生成后自动切成 4 张组图</div></div>
      <div class="fsec"><span class="lab">支持画质</span>${chips(quals, quals)}</div>
      <div class="fsec"><span class="lab">支持清晰度</span>${chips(res, res)}</div>
      <div class="fsec"><span class="lab">支持比例</span>${chips(['自适应', '1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'], ['自适应', '1:1', '16:9', '9:16'])}</div>
      </div>

      <div class="fcard"><div class="ct">积分定价（画质 × 清晰度）</div>
      <div class="hint" style="margin:-6px 0 8px">不同档位可设不同积分；留空或 0 的格回退到上方「消耗积分」。</div>${matrix}</div>
    `, '配置模型的基础信息、计费、能力与定价');
  }

  function tplModal(name) {
    modal(name ? '编辑模板 · ' + name : '新建模板', `
      <div class="fcard" style="margin-top:0"><div class="ct">模板信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>模板名称<span class="req">*</span></label><input value="${name || ''}" placeholder="如：注册验证码"></div>
        <div class="fld col2"><label>类型</label><select><option>系统</option><option>通知</option><option>营销</option></select></div>
        <div class="fld col2"><label>触发场景</label><input value="用户注册"></div>
        <div class="fld col2"><label>可用变量</label><input value="{code} {name}"></div>
        <div class="fld col4" style="grid-column:span 4"><label>邮件标题</label><input value="【SCARECROW AI】您的验证码"></div>
      </div>
      <div class="fsec"><span class="lab">正文</span>
        <textarea style="width:100%;min-height:120px;padding:12px 13px;border-radius:10px;background:var(--panel);border:1px solid transparent;font:inherit;font-size:13px;color:var(--text);resize:vertical">您好 {name}，您的验证码是 {code}，5 分钟内有效。</textarea></div>
      <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
        <div class="cfg-row"><span class="lab">启用模板</span>${sw(true)}</div></div></div>
      </div>
    `, name ? '编辑邮件模板内容' : '新建邮件模板');
  }

  function keyModal(name) {
    modal(name ? '密钥 · ' + name : '新建密钥', `
      <div class="fcard" style="margin-top:0"><div class="ct">密钥信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>名称<span class="req">*</span></label><input value="${name || ''}" placeholder="如：前台 Web"></div>
        <div class="fld col2"><label>权限范围</label><select><option>全部</option><option>生成</option><option>只读</option><option>导出</option></select></div>
        <div class="fld col4" style="grid-column:span 4"><label>Key</label><input value="sk_live_a1b2c3d4e5f6g7h8" readonly></div>
        <div class="fld col2"><label>调用上限 / 日</label><input value="不限"></div>
        <div class="fld col2"><label>到期</label><input value="永久"></div>
      </div>
      <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
        <div class="cfg-row"><span class="lab">启用</span>${sw(true)}</div>
        <div class="cfg-row"><span class="lab">IP 白名单</span>${sw(false)}</div></div></div></div>
    `, name ? '查看 / 轮换 API 密钥' : '创建一个新的 API 密钥');
  }
  function memberModal(name) {
    modal(name ? '编辑成员 · ' + name : '添加成员', `
      <div class="fcard" style="margin-top:0"><div class="ct">成员信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>成员<span class="req">*</span></label><input value="${name || ''}" placeholder="昵称 / 邮箱"></div>
        <div class="fld col2"><label>角色</label><select><option>超级管理员</option><option>运营</option><option>内容审核</option><option>财务</option><option>客服</option><option>只读访客</option></select></div>
        <div class="fld col2"><label>数据范围</label><select><option>全部</option><option>内容 / 用户</option><option>作品审核</option><option>商业</option><option>查看</option></select></div>
        <div class="fld col2"><label>状态</label><select><option>启用</option><option>禁用</option></select></div>
      </div>
      <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
        <div class="cfg-row"><span class="lab">二次验证 2FA</span>${sw(true)}</div>
        <div class="cfg-row"><span class="lab">发送邀请邮件</span>${sw(true)}</div></div></div></div>
    `, name ? '编辑后台成员与角色' : '添加后台管理成员');
  }

  function payModal(name) {
    modal('支付渠道 · ' + (name || ''), `
      <div class="fcard" style="margin-top:0"><div class="ct">渠道配置</div>
      <div class="fgrid">
        <div class="fld col2"><label>渠道名称</label><input value="${name || '微信支付'}"></div>
        <div class="fld col2"><label>接入类型</label><select><option>扫码 / JSAPI</option><option>扫码 / APP</option><option>应用内</option><option>海外卡</option></select></div>
        <div class="fld"><label>费率（%）</label><input value="0.6"></div>
        <div class="fld"><label>结算周期</label><select><option>T+1</option><option>T+7</option><option>实时</option></select></div>
        <div class="fld col2"><label>商户号</label><input value="MCH_8021xxxx"></div>
        <div class="fld col2"><label>API 密钥</label><input value="••••••••••••" type="password"></div>
        <div class="fld col4" style="grid-column:span 4"><label>回调地址</label><input value="https://api.scarecrow.ai/pay/callback"></div>
      </div></div>
      <div class="fcard"><div class="ct">选项</div>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">启用渠道</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">支持退款</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">沙箱模式</span>${sw(false)}</div>
        </div></div>
    `, '配置支付渠道与费率');
  }

  function priceModal(name) {
    modal(name ? '编辑套餐 · ' + name : '新增套餐', `
      <div class="fcard" style="margin-top:0"><div class="ct">套餐信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>套餐名称<span class="req">*</span></label><input value="${name || ''}" placeholder="如：创作者 Pro"></div>
        <div class="fld"><label>月价（¥）</label><input value="39"></div>
        <div class="fld"><label>年价（¥）</label><input value="468"></div>
        <div class="fld"><label>每月积分</label><input value="3000"></div>
        <div class="fld"><label>角标</label><select><option>无</option><option>热门</option><option>推荐</option><option>超值</option></select></div>
        <div class="fld col4" style="grid-column:span 4"><label>权益摘要</label><input value="全模型 · 高清"></div>
      </div></div>
      <div class="fcard"><div class="ct">权益项</div>
      <div class="fsec" style="margin-top:0"><span class="lab">包含权益</span>${chips(['全部模型', '高清出图', '去水印', '商用授权', '并发加速', 'API 访问', '优先队列'], ['全部模型', '高清出图', '去水印'])}</div>
      <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
        <div class="cfg-row"><span class="lab">上架销售</span>${sw(true)}</div>
        <div class="cfg-row"><span class="lab">支持试用</span>${sw(false)}</div></div></div>
      </div>
    `, name ? '编辑会员套餐定价与权益' : '新增会员套餐');
  }

  function mktModal(name, kind) {
    modal(name ? '编辑 · ' + name : '新建活动', `
      <div class="fcard" style="margin-top:0"><div class="ct">${kind === 'coupon' ? '优惠券信息' : '活动信息'}</div>
      <div class="fgrid">
        <div class="fld col2"><label>名称<span class="req">*</span></label><input value="${name || ''}" placeholder="如：限时年付 -42%"></div>
        <div class="fld col2"><label>类型</label><select>${(kind === 'coupon' ? ['满减', '折扣', '兑换', '直减'] : ['促销', '拉新', '裂变', '活动', '线索']).map(o => `<option>${o}</option>`).join('')}</select></div>
        <div class="fld"><label>力度 / 面额</label><input placeholder="如：-42% 或 ¥20"></div>
        <div class="fld"><label>限量</label><input placeholder="不限"></div>
        <div class="fld col2"><label>周期 / 有效期</label><input value="2026-02-01 ~ 2026-02-29"></div>
        <div class="fld col4" style="grid-column:span 4"><label>说明</label><input placeholder="选填"></div>
      </div></div>
      <div class="fcard"><div class="ct">投放</div>
      <div class="fsec" style="margin-top:0"><span class="lab">适用人群</span>${chips(['全部', '新用户', '付费会员', '流失用户'], ['全部'], true)}</div>
      <div class="fsec"><span class="lab">渠道</span>${chips(['站内', '抖音', '小红书', '微信', '短信'], ['站内'])}</div>
      <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
        <div class="cfg-row"><span class="lab">立即上线</span>${sw(true)}</div>
        <div class="cfg-row"><span class="lab">可叠加其它优惠</span>${sw(false)}</div></div></div>
      </div>
    `, name ? '编辑营销活动' : '新建一个营销活动');
  }

  function resModal(rname) {
    modal('资源详情 · ' + (rname || ''), `
      <div class="adm-kpis" style="margin-bottom:16px">
        ${kpi('大小', '24.1 TB', '', 'up')}${kpi('引用', '900k', '', 'up')}${kpi('对象数', '1.2M', '', 'up')}${kpi('健康度', '99.9%', '', 'up')}
      </div>
      <div class="fcard" style="margin-top:0"><div class="ct">资源信息</div>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">名称</span><span class="strong mono">${rname || 'works-images'}</span></div>
          <div class="cfg-row"><span class="lab">类型</span>${tag('存储桶', 'gray')}</div>
          <div class="cfg-row"><span class="lab">区域</span><span class="muted">华东 1 · 上海</span></div>
          <div class="cfg-row"><span class="lab">CDN 加速</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">访问权限</span><span class="muted">私有 · 签名访问</span></div>
          <div class="cfg-row"><span class="lab">更新时间</span><span class="muted">12 分钟前</span></div>
        </div></div>
      <div class="fcard"><div class="ct">生命周期 / 清理</div>
        <div class="fgrid"><div class="fld col2"><label>冷归档阈值（天）</label><input value="90"></div>
          <div class="fld col2"><label>临时文件保留（天）</label><input value="7"></div></div>
        <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">自动清理临时文件</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">重复文件去重</span>${sw(true)}</div></div></div></div>
    `, '查看与管理资源存储');
  }

  function ruleModal(rname) {
    modal(rname ? '编辑规则 · ' + rname : '新增规则', `
      <div class="fcard" style="margin-top:0"><div class="ct">规则信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>规则名称<span class="req">*</span></label><input value="${rname || ''}" placeholder="如：文生图"></div>
        <div class="fld col2"><label>场景</label><select><option>创作台</option><option>注册</option><option>活跃</option><option>裂变</option></select></div>
        <div class="fld"><label>方向</label><select><option>消耗</option><option>赠送</option></select></div>
        <div class="fld"><label>数量</label><input value="10"></div>
        <div class="fld col2"><label>触发条件</label><input value="每次生成"></div>
        <div class="fld col4" style="grid-column:span 4"><label>说明</label><input placeholder="选填"></div>
      </div></div>
      <div class="fcard"><div class="ct">限制</div>
        <div class="fgrid"><div class="fld col2"><label>每日上限（次）</label><input value="不限"></div>
          <div class="fld col2"><label>每用户上限</label><input value="不限"></div></div>
        <div class="fsec"><span class="lab">选项</span><div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">启用规则</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">叠加其它规则</span>${sw(true)}</div></div></div></div>
    `, rname ? '编辑积分规则' : '新增积分规则');
  }

  function discoverModal(title) {
    modal(title ? '编辑推荐位 · ' + title : '新增推荐位', `
      <div class="fcard"><div class="ct">推荐位信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>标题<span class="req">*</span></label><input value="${title || ''}" placeholder="如：本周精选"></div>
        <div class="fld col2"><label>类型</label><select><option>推荐位</option><option>横幅 Banner</option><option>专题</option></select></div>
        <div class="fld"><label>位置</label><select><option>首屏轮播</option><option>中部推荐</option><option>侧栏</option></select></div>
        <div class="fld"><label>排序策略</label><select><option>热度</option><option>最新</option><option>人工</option></select></div>
        <div class="fld col2"><label>跳转链接</label><input placeholder="作品 / 合集 / 自定义 URL"></div>
        <div class="fld col2"><label>封面图</label><input placeholder="图片 URL 或上传"></div>
        <div class="fld col2"><label>有效期</label><input value="2026-02-12 ~ 2026-02-20"></div>
      </div></div>
      <div class="fcard"><div class="ct">投放设置</div>
      <div class="fsec" style="margin-top:0"><span class="lab">可见端</span>${chips(['Web', 'iOS', 'Android', '小程序'], ['Web', 'iOS', 'Android'])}</div>
      <div class="fsec"><span class="lab">人群</span>${chips(['全部', '新用户', '付费会员', '流失用户'], ['全部'], true)}</div>
      <div class="fsec"><span class="lab">选项</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">上线</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">定时投放</span>${sw(false)}</div>
        </div></div>
      </div>
    `, title ? '编辑发现页推荐位' : '新增一个发现页推荐位');
  }

  function inspModal(title) {
    modal(title ? '编辑 · ' + title : '新增合集', `
      <div class="fcard"><div class="ct">合集信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>标题<span class="req">*</span></label><input value="${title || ''}" placeholder="如：国风 Q 版"></div>
        <div class="fld col2"><label>类型</label><select><option>合集</option><option>主题</option><option>提示词</option></select></div>
        <div class="fld"><label>关联作品</label><input value="320"></div>
        <div class="fld"><label>排序</label><input value="1"></div>
        <div class="fld col2"><label>封面图</label><input placeholder="图片 URL 或上传"></div>
        <div class="fld col4" style="grid-column:span 4"><label>描述</label><input placeholder="选填,展示在合集卡片下方"></div>
      </div></div>
      <div class="fcard"><div class="ct">关联提示词</div>
      <div class="fsec" style="margin-top:0"><span class="lab">标签</span>${chips(['国风', 'Q 版', '赛博朋克', '人像', '3D', '动漫', '写实'], ['国风', 'Q 版'])}</div>
      <div class="fsec"><span class="lab">选项</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">在灵感页展示</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">首页推荐</span>${sw(false)}</div>
        </div></div>
      </div>
    `, title ? '编辑灵感合集内容与展示' : '新增一个灵感合集');
  }

  function workModal(wid, author) {
    const cover = mesh(40 + wid.length * 9, 90, 180);
    modal('作品详情 · ' + wid, `
      <div class="adm-2col" style="margin-top:6px">
        <div style="aspect-ratio:1;border-radius:14px;background:${cover};box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)"></div>
        <div>
          <div class="fcard" style="margin-top:0"><div class="ct">作品信息</div>
            <div class="cfg-row"><span class="lab">作者</span><span class="strong">${author || '夜航 NightSail'}</span></div>
            <div class="cfg-row"><span class="lab">模型</span><span class="mono">GPT Image 2</span></div>
            <div class="cfg-row"><span class="lab">类型</span>${tag('图片', 'gray')}</div>
            <div class="cfg-row"><span class="lab">点赞 / 收藏</span><span class="mono">12,000 / 3,402</span></div>
            <div class="cfg-row"><span class="lab">状态</span>${tag('已发布', 'green')}</div>
            <div class="cfg-row"><span class="lab">发布时间</span><span class="muted">2026-02-12 10:24</span></div>
          </div>
          <div class="fcard"><div class="ct">展示控制</div>
            <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
              <div class="cfg-row"><span class="lab">公开展示</span>${sw(true)}</div>
              <div class="cfg-row"><span class="lab">设为精选</span>${sw(false)}</div>
              <div class="cfg-row"><span class="lab">允许二创</span>${sw(true)}</div>
            </div></div>
        </div>
      </div>
      <div class="fcard"><div class="ct">提示词</div>
        <div class="muted" style="font-size:13px;line-height:1.6">霓虹废土行者，赛博朋克城市夜景，电影感布光，8K 超写实，景深层次</div></div>
    `, '查看作品详情与展示控制');
  }

  function floorModal(fname) {
    modal(fname ? '编辑楼层 · ' + fname : '新增楼层', `
      <div class="fcard"><div class="ct">楼层信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>楼层名称<span class="req">*</span></label><input value="${fname || ''}" placeholder="如：本周精选"></div>
        <div class="fld col2"><label>楼层类型</label><select><option>英雄区</option><option>能力展示</option><option>作品流</option><option>创作者榜</option><option>价格</option><option>FAQ</option><option>自定义</option></select></div>
        <div class="fld col2"><label>副标题</label><input placeholder="选填"></div>
        <div class="fld col2"><label>内容源</label><select><option>实时热度</option><option>人工精选</option><option>最新发布</option><option>指定合集</option></select></div>
        <div class="fld"><label>展示数量</label><input value="10"></div>
        <div class="fld"><label>排序</label><input value="1"></div>
      </div></div>
      <div class="fcard"><div class="ct">展示设置</div>
      <div class="fsec" style="margin-top:0"><span class="lab">布局样式</span>${chips(['瀑布流', '横向滑动', 'Coverflow', '网格', '轮播'], ['Coverflow'], true)}</div>
      <div class="fsec"><span class="lab">可见端</span>${chips(['Web', 'iOS', 'Android', '小程序'], ['Web', 'iOS', 'Android', '小程序'])}</div>
      <div class="fsec"><span class="lab">选项</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">启用楼层</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">登录后可见</span>${sw(false)}</div>
          <div class="cfg-row"><span class="lab">定时上下线</span>${sw(false)}</div>
        </div></div>
      </div>
    `, fname ? '调整该楼层的展示与内容源' : '新增一个首页楼层');
  }

  function roleModal(roleName) {
    const mods = ['用户管理', '作品管理', '灵感管理', '日志', '模型管理', '资源', '积分', '价格', '支付', '营销', '配置'];
    modal(roleName ? '角色权限 · ' + roleName : '新建角色', `
      <div class="fcard"><div class="ct">角色信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>角色名称<span class="req">*</span></label><input value="${roleName || ''}" placeholder="如：内容运营"></div>
        <div class="fld col2"><label>数据范围</label><select><option>全部</option><option>内容 + 用户</option><option>内容</option><option>商业</option><option>只读</option></select></div>
        <div class="fld col4" style="grid-column:span 4"><label>描述</label><input placeholder="一句话说明该角色职责"></div>
      </div></div>
      <div class="fcard"><div class="ct">模块权限</div>
        <div class="fmatrix"><table><thead><tr><th>模块</th><th>查看</th><th>编辑</th><th>删除 / 高危</th></tr></thead>
          <tbody>${mods.map((m, i) => `<tr><td>${m}</td><td>${sw(true)}</td><td>${sw(i < 6)}</td><td>${sw(i < 2)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    `, roleName ? '调整该角色可访问的模块与操作' : '创建一个新的后台角色');
  }

  function newUserModal() {
    modal('新建用户', `
      <div class="fcard"><div class="ct">账号信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>昵称<span class="req">*</span></label><input placeholder="如：夜航 NightSail"></div>
        <div class="fld col2"><label>邮箱 / 账号<span class="req">*</span></label><input placeholder="user@mail.com"></div>
        <div class="fld col2"><label>手机号</label><input placeholder="选填"></div>
        <div class="fld col2"><label>初始密码</label><input placeholder="留空则发送邀请邮件设置"></div>
      </div></div>
      <div class="fcard"><div class="ct">会员与权益</div>
      <div class="fgrid">
        <div class="fld"><label>会员等级</label><select><option>免费</option><option>Pro 会员</option><option>企业</option></select></div>
        <div class="fld"><label>初始积分</label><input value="200"></div>
        <div class="fld"><label>注册渠道</label><select><option>后台创建</option><option>抖音投放</option><option>小红书</option><option>邀请</option></select></div>
        <div class="fld"><label>角色</label><select><option>普通用户</option><option>创作者</option><option>企业成员</option></select></div>
      </div>
      <div class="fsec"><span class="lab">账号选项</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">发送欢迎邮件</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">要求首次登录改密</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">立即激活</span>${sw(true)}</div>
        </div></div>
      </div>
    `, '创建一个新的平台账号');
  }

  function userModal(name) {
    const lv = ['免费', 'Pro 会员', '企业'][Math.abs(name.length) % 3];
    const lvC = ['gray', 'blue', 'amber'][Math.abs(name.length) % 3];
    const works = Array.from({ length: 6 }, (_, i) => mesh(30 + i * 50, 80 + i * 40, 150 + i * 25));
    modal('用户详情', `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
        <span style="width:64px;height:64px;border-radius:50%;flex:none;background:${swatch(name)}"></span>
        <div style="flex:1;min-width:0"><div style="font-size:19px;font-weight:700;display:flex;align-items:center;gap:9px">${name} ${tag(lv, lvC)} ${tag('正常', 'green')}</div>
          <div class="muted mono" style="font-size:12.5px;margin-top:4px">u_${1000 + name.length * 37}@mail.com · UID 80${name.length}241 · 注册 2026-01-10</div></div>
        <button class="adm-btn ghost" id="uEdit">编辑</button><button class="adm-btn" id="uCredit">调整积分</button>
      </div>
      <div class="adm-kpis" style="margin-bottom:18px">
        ${kpi('积分余额', '8,180', '', 'up')}${kpi('本月消耗', '1,620', '+12%', 'up')}${kpi('累计生成', '12,408', '', 'up')}${kpi('连续活跃', '46 天', '', 'up')}
      </div>
      <div class="fsec" style="margin-top:0"><span class="lab">最近作品</span>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">${works.map(c => `<div style="aspect-ratio:1;border-radius:10px;background:${c};box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)"></div>`).join('')}</div></div>
      <div class="adm-2col" style="margin-top:20px">
        <div><div class="fsec" style="margin:0"><span class="lab">账户信息</span></div>
          <div class="cfg-card"><div class="cfg-row"><span class="lab">会员到期</span><span class="mono">2026-12-31</span></div>
            <div class="cfg-row"><span class="lab">注册渠道</span><span class="muted">抖音投放</span></div>
            <div class="cfg-row"><span class="lab">绑定方式</span><span class="muted">微信 / 手机</span></div>
            <div class="cfg-row"><span class="lab">风控评分</span><span class="mono" style="color:#1a9d54">A · 低风险</span></div>
            <div class="cfg-row"><span class="lab">账号状态</span>${sw(true)}</div></div></div>
        <div><div class="fsec" style="margin:0"><span class="lab">最近积分流水</span></div>
          <div class="cfg-card" style="padding:6px 16px">
            ${[['文生图 ×4', '-40', '2 分钟前'], ['充值 3000 积分', '+3000', '今天 09:12'], ['每日签到', '+10', '今天 08:00'], ['文生视频', '-30', '昨天'], ['邀请奖励', '+100', '02-10']].map(r => `<div class="cfg-row"><span class="lab">${r[0]}<br><span class="muted" style="font-size:11px">${r[2]}</span></span><span class="mono" style="color:${r[1][0] === '+' ? '#1a9d54' : '#e0334b'}">${r[1]}</span></div>`).join('')}
          </div></div>
      </div>`);
    const eb = document.getElementById('uEdit'); if (eb) eb.addEventListener('click', () => editUserModal(name));
    const cb = document.getElementById('uCredit'); if (cb) cb.addEventListener('click', () => creditModal(name));
  }

  function editUserModal(name) {
    modal('编辑用户', `
      <div class="fcard"><div class="ct">账号信息</div>
      <div class="fgrid">
        <div class="fld col2"><label>昵称</label><input value="${name}"></div>
        <div class="fld col2"><label>邮箱 / 账号</label><input value="u_${1000 + name.length * 37}@mail.com"></div>
        <div class="fld col2"><label>手机号</label><input value="138****${1000 + name.length}"></div>
        <div class="fld col2"><label>风控评分</label><select><option>A · 低风险</option><option>B · 关注</option><option>C · 高风险</option></select></div>
      </div></div>
      <div class="fcard"><div class="ct">会员与状态</div>
      <div class="fgrid">
        <div class="fld"><label>会员等级</label><select><option>免费</option><option>Pro 会员</option><option>企业</option></select></div>
        <div class="fld"><label>会员到期</label><input value="2026-12-31"></div>
        <div class="fld col2"><label>注册渠道</label><input value="抖音投放"></div>
      </div>
      <div class="fsec"><span class="lab">账号选项</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px">
          <div class="cfg-row"><span class="lab">账号启用</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">允许公开作品</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">加入风控名单</span>${sw(false)}</div>
        </div></div>
      </div>
    `, '修改 ' + name + ' 的资料与状态');
  }

  function creditModal(name) {
    modal('调整积分', `
      <div class="fcard"><div class="ct">当前余额</div>
        <div style="font-family:var(--disp);font-size:30px;font-weight:700">8,180 <span style="font-size:14px;color:var(--text-faint);font-weight:500">积分</span></div></div>
      <div class="fcard"><div class="ct">调整</div>
      <div class="fsec" style="margin-top:0"><span class="lab">方式</span>${chips(['增加', '扣减', '设为'], ['增加'], true)}</div>
      <div class="fgrid" style="margin-top:16px">
        <div class="fld col2"><label>数量</label><input value="0"></div>
        <div class="fld col2"><label>原因</label><select><option>人工补偿</option><option>活动奖励</option><option>违规扣除</option><option>客服处理</option></select></div>
        <div class="fld col4" style="grid-column:span 4"><label>备注</label><input placeholder="选填，记录到积分流水"></div>
      </div>
      <div class="fsec"><span class="lab">通知</span>
        <div class="cfg-card" style="box-shadow:none;padding:4px 16px"><div class="cfg-row"><span class="lab">站内信通知用户</span>${sw(true)}</div></div></div>
      </div>
    `, '为 ' + name + ' 增减积分,记录到流水');
  }

  /* ---------- chart helpers (inline SVG) ---------- */
  const CC = ['#0a84ff', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#5ac8fa'];
  function smoothPath(vals, w, h, pad) {
    const max = Math.max(...vals) * 1.12, min = Math.min(...vals) * 0.9;
    const xs = i => pad + (i / (vals.length - 1)) * (w - pad * 2);
    const ys = v => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    let d = `M ${xs(0)} ${ys(vals[0])}`;
    for (let i = 1; i < vals.length; i++) {
      const x0 = xs(i - 1), y0 = ys(vals[i - 1]), x1 = xs(i), y1 = ys(vals[i]);
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`;
    }
    return { d, xs, ys };
  }
  function areaChart(vals, color) {
    const w = 640, h = 220, pad = 14;
    const { d, xs, ys } = smoothPath(vals, w, h, pad);
    const area = d + ` L ${xs(vals.length - 1)} ${h - pad} L ${xs(0)} ${h - pad} Z`;
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    const dots = vals.map((v, i) => i % 3 === 0 ? `<circle cx="${xs(i)}" cy="${ys(v)}" r="3" fill="${color}"/>` : '').join('');
    return `<svg class="viz-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".26"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map(g => `<line x1="${pad}" x2="${w - pad}" y1="${pad + g * (h - pad * 2)}" y2="${pad + g * (h - pad * 2)}" stroke="#e8e8ed" stroke-width="1"/>`).join('')}
      <path d="${area}" fill="url(#${id})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>${dots}
    </svg>`;
  }
  function donut(segs) {
    const total = segs.reduce((a, s) => a + s.v, 0), r = 52, c = 2 * Math.PI * r; let off = 0;
    const rings = segs.map((s, i) => {
      const len = (s.v / total) * c;
      const el = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${CC[i % CC.length]}" stroke-width="16" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" stroke-linecap="round"/>`;
      off += len; return el;
    }).join('');
    return `<div class="viz-donut-wrap"><div class="viz-donut-center" style="width:140px;height:140px">
      <svg width="140" height="140" viewBox="0 0 140 140">${rings}</svg>
      <div class="ctr"><b>${total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total}</b><small>总计</small></div></div>
      <div class="viz-legend" style="flex-direction:column;gap:9px">${segs.map((s, i) => `<span><i style="background:${CC[i % CC.length]}"></i>${s.n} · ${Math.round(s.v / total * 100)}%</span>`).join('')}</div></div>`;
  }
  function hbars(rows, color) {
    const max = Math.max(...rows.map(r => r.v));
    return `<div class="viz-bars">${rows.map((r, i) => `<div class="viz-bar"><span class="nm">${r.n}</span>
      <span class="track"><span class="fill" style="width:${(r.v / max * 100).toFixed(0)}%;background:${color || CC[i % CC.length]}"></span></span>
      <span class="val">${r.v >= 1000 ? (r.v / 1000).toFixed(1) + 'k' : r.v}</span></div>`).join('')}</div>`;
  }
  function multiLine(series, w, h) {
    w = w || 640; h = h || 220; const pad = 14;
    const all = series.flatMap(s => s.vals); const max = Math.max(...all) * 1.12, min = Math.min(...all) * 0.85;
    const n = series[0].vals.length;
    const xs = i => pad + (i / (n - 1)) * (w - pad * 2);
    const ys = v => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    const grid = [0.25, 0.5, 0.75].map(g => `<line x1="${pad}" x2="${w - pad}" y1="${pad + g * (h - pad * 2)}" y2="${pad + g * (h - pad * 2)}" stroke="#e8e8ed"/>`).join('');
    const lines = series.map((s, si) => {
      let d = `M ${xs(0)} ${ys(s.vals[0])}`;
      for (let i = 1; i < n; i++) { const x0 = xs(i - 1), y0 = ys(s.vals[i - 1]), x1 = xs(i), y1 = ys(s.vals[i]), cx = (x0 + x1) / 2; d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`; }
      return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.5" stroke-linecap="round"/>`;
    }).join('');
    return `<svg class="viz-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${lines}</svg>`;
  }
  function funnel(steps) {
    const max = steps[0].v;
    return `<div class="viz-funnel">${steps.map((s, i) => {
      const pct = s.v / max * 100;
      return `<div class="fn-row"><span class="fn-n">${s.n}</span><div class="fn-track"><div class="fn-fill" style="width:${pct}%;background:${CC[i % CC.length]}"><span>${s.v >= 1000 ? (s.v / 1000).toFixed(0) + 'k' : s.v}</span></div></div><span class="fn-p">${pct.toFixed(0)}%</span></div>`;
    }).join('')}</div>`;
  }
  function gauge(pct, label, color) {
    const r = 54, c = Math.PI * r, len = (pct / 100) * c;
    color = color || (pct > 85 ? '#ff375f' : pct > 65 ? '#ff9f0a' : '#34c759');
    return `<div class="viz-gauge"><svg width="150" height="92" viewBox="0 0 150 92">
      <path d="M 16 84 A ${r} ${r} 0 0 1 134 84" fill="none" stroke="#e8e8ed" stroke-width="13" stroke-linecap="round"/>
      <path d="M 16 84 A ${r} ${r} 0 0 1 134 84" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${len} ${c}"/>
      </svg><div class="gv"><b>${pct}%</b><small>${label}</small></div></div>`;
  }
  function heatmap() {
    const days = ['一', '二', '三', '四', '五', '六', '日'];
    let cells = '';
    for (let d = 0; d < 7; d++) for (let hN = 0; hN < 24; hN++) {
      const peak = (hN >= 9 && hN <= 23) ? 1 : 0.3;
      const v = Math.min(1, (0.2 + Math.random() * 0.8) * peak * (d < 5 ? 1 : 0.8));
      cells += `<span class="hm-c" style="background:color-mix(in oklab,#0a84ff ${Math.round(v * 100)}%, #eef1f6)" title="周${days[d]} ${hN}:00"></span>`;
    }
    return `<div class="hm"><div class="hm-grid">${cells}</div></div>`;
  }
  function ring(pct, color) {
    const r = 20, c = 2 * Math.PI * r, len = pct / 100 * c;
    return `<svg width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="${r}" fill="none" stroke="#e8e8ed" stroke-width="6"/><circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${len} ${c}" transform="rotate(-90 26 26)"/><text x="26" y="30" text-anchor="middle" font-size="12" font-weight="700" fill="#1d1d1f">${pct}</text></svg>`;
  }
  function leaderboard(rows, kind) {
    const max = Math.max(...rows.map(r => r.v));
    return `<div class="lb">${rows.map((r, i) => `<div class="lb-row ${i < 3 ? 'top' + (i + 1) : ''}">
      <span class="lb-rank">${i + 1}</span>
      <div class="lb-main"><div class="lb-nm">${kind === 'user' ? `<span class="av" style="background:${swatch(r.n)}"></span>` : `<span class="sw" style="background:${swatch(r.n)}"></span>`}${r.n}</div>
        <div class="lb-track"><i style="width:${(r.v / max * 100).toFixed(0)}%;background:${CC[i % CC.length]}"></i></div></div>
      <div class="lb-val">${r.v >= 10000 ? (r.v / 10000).toFixed(1) + 'w' : r.v.toLocaleString()}<small class="${r.up >= 0 ? 'up' : 'down'}">${r.up >= 0 ? '↑' : '↓'}${Math.abs(r.up)}%</small></div>
    </div>`).join('')}</div>`;
  }
  function healthBoard(models) {
    return `<div class="hb-grid">${models.map(m => {
      const col = m.ok > 99 ? '#34c759' : m.ok > 97 ? '#ff9f0a' : '#ff375f';
      const st = m.ok > 99 ? ['正常', 'green'] : m.ok > 97 ? ['波动', 'amber'] : ['异常', 'red'];
      return `<div class="hb-card"><div class="hb-top"><span class="sw" style="background:${swatch(m.n)}"></span><span class="nm">${m.n}</span></div>
        <div class="hb-ring">${ring(m.ok, col)}<div class="hb-stat">
          <div class="hb-row"><span>状态</span>${tag(st[0], st[1])}</div>
          <div class="hb-row"><span>时延</span><b>${m.lat}ms</b></div>
          <div class="hb-row"><span>队列</span><b>${m.q}</b></div>
        </div></div></div>`;
    }).join('')}</div>`;
  }

  V.viz = () => {
    const trend = [42, 48, 45, 60, 58, 72, 70, 85, 80, 96, 92, 110, 120];
    const KI = { dash: ICON.users, users: ICON.users, gen: ICON.works, rev: ICON.price };
    const KPIS = [
      ['总用户', '5,218,904', '+2.4%', 'up', 'users', '#0a84ff'], ['日活 DAU', '486,210', '+5.1%', 'up', 'chart', '#34c759'],
      ['月活 MAU', '3.82M', '+3.4%', 'up', 'chart', '#5ac8fa'], ['今日生成', '1,902,338', '+8.7%', 'up', 'works', '#bf5af2'],
      ['付费会员', '352,118', '+1.9%', 'up', 'credit', '#ff9f0a'], ['付费转化', '6.8%', '-0.3%', 'down', 'price', '#ff375f'],
      ['今日营收', '¥384.9K', '+11%', 'up', 'pay', '#1a9d54'], ['ARPU', '¥58.2', '+5%', 'up', 'credit', '#0a84ff'],
    ];
    const heroSpark = (() => { const { d } = smoothPath(trend, 360, 60, 4); const area = d + ' L 356 56 L 4 56 Z'; return `<svg width="360" height="60" viewBox="0 0 360 60" preserveAspectRatio="none"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#hg)"/><path d="${d}" fill="none" stroke="#fff" stroke-width="2.5"/></svg>`; })();
    return `<div class="viz-grid">
      <div class="viz-hero"><div class="viz-hero-row">
        <div class="lead"><div class="lbl"><span class="live"></span>实时营收 · 今日</div><div class="big">¥384,920</div><div class="chg">↑ 11.2% 较昨日 · 本月累计 ¥9.84M</div></div>
        <div class="hstats">
          <div class="hstat"><div class="k">今日订单</div><div class="v">6,418</div></div>
          <div class="hstat"><div class="k">客单价</div><div class="v">¥59.9</div></div>
          <div class="hstat"><div class="k">实时在线</div><div class="v">12,043</div></div>
        </div>
        <div class="hspark">${heroSpark}</div>
      </div></div>

      ${KPIS.map((k, i) => `<div class="viz-card" style="grid-column:span 3"><div class="viz-kpi">
        <div class="kpi-top"><span class="badge-ic" style="background:color-mix(in oklab,${k[5]} 14%,transparent)"><svg viewBox="0 0 24 24" style="stroke:${k[5]}"><path d="${ICON[k[4]] || ICON.chart}"/></svg></span><span class="k">${k[0]}</span></div>
        <span class="v">${k[1]}</span><span class="d ${k[3]}">${k[3] === 'up' ? '↑' : '↓'} ${k[2]} 较昨日</span></div>
        <svg class="viz-svg" viewBox="0 0 200 32" style="margin-top:8px;height:32px" preserveAspectRatio="none">${(() => { const v = trend.slice(i % 6, i % 6 + 8).concat(trend.slice(0, 3)); const { d } = smoothPath(v, 200, 32, 3); return `<path d="${d}" fill="none" stroke="${k[5]}" stroke-width="2"/>`; })()}</svg></div>`).join('')}

      <div class="viz-card span8"><div class="viz-h"><div><h3>生成趋势</h3><div class="sub">近 13 天 · 单位万次</div></div><div class="viz-big" style="font-size:22px;color:#1a9d54">+34%</div></div>
        ${areaChart(trend, '#0a84ff')}<div class="viz-dot"><span>11-30</span><span>12-12</span></div></div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>用户构成</h3><div class="sub">按会员等级</div></div></div>
        ${donut([{ n: '免费用户', v: 4520 }, { n: 'Pro 会员', v: 352 }, { n: '企业版', v: 86 }, { n: '试用中', v: 260 }])}</div>

      <div class="viz-card span8"><div class="viz-h"><div><h3>用户增长</h3><div class="sub">近 12 周 · 新增 vs 活跃</div></div>
        <div class="viz-legend"><span><i style="background:#0a84ff"></i>新增</span><span><i style="background:#34c759"></i>活跃</span></div></div>
        ${multiLine([
          { c: '#0a84ff', vals: [12, 14, 13, 18, 20, 19, 24, 26, 25, 30, 34, 38] },
          { c: '#34c759', vals: [40, 44, 46, 52, 55, 60, 64, 70, 76, 82, 90, 98] },
        ])}<div class="viz-dot"><span>W1</span><span>W12</span></div></div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>转化漏斗</h3><div class="sub">访客 → 付费</div></div></div>
        ${funnel([{ n: '访问', v: 100000 }, { n: '注册', v: 42000 }, { n: '生成', v: 28000 }, { n: '加购', v: 9800 }, { n: '付费', v: 6800 }])}</div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>模型调用占比</h3><div class="sub">本周</div></div></div>
        ${donut([{ n: 'GPT Image 2', v: 4200 }, { n: 'Flux.1 Pro', v: 2600 }, { n: 'Seedance', v: 1800 }, { n: '可灵', v: 1200 }, { n: '其它', v: 900 }])}</div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>各模块调用量</h3><div class="sub">今日</div></div></div>
        ${hbars([{ n: '文生图', v: 9200 }, { n: '图生图', v: 5400 }, { n: '文生视频', v: 3100 }, { n: '图生视频', v: 1800 }, { n: '改图', v: 1200 }], '#0a84ff')}</div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>地区分布</h3><div class="sub">活跃用户 Top 5</div></div></div>
        ${hbars([{ n: '广东', v: 880 }, { n: '海外', v: 920 }, { n: '北京', v: 720 }, { n: '上海', v: 690 }, { n: '浙江', v: 540 }])}</div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>设备来源</h3><div class="sub">本周会话</div></div></div>
        ${donut([{ n: 'iOS', v: 3800 }, { n: 'Android', v: 3200 }, { n: 'Web', v: 2400 }, { n: '小程序', v: 1400 }])}</div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>系统健康</h3><div class="sub">实时</div></div></div>
        <div style="display:flex;justify-content:space-around;flex-wrap:wrap;gap:8px">${gauge(72, 'GPU 负载')}${gauge(43, '存储占用')}</div>
        <div class="viz-bars" style="margin-top:8px">
          <div class="viz-bar"><span class="nm">平均时延</span><span class="track"><span class="fill" style="width:34%;background:#34c759"></span></span><span class="val">142ms</span></div>
          <div class="viz-bar"><span class="nm">成功率</span><span class="track"><span class="fill" style="width:98%;background:#34c759"></span></span><span class="val">98.6%</span></div></div></div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>留存率</h3><div class="sub">次日 / 7日 / 30日</div></div></div>
        ${hbars([{ n: '次日 D1', v: 52 }, { n: '7 日 D7', v: 34 }, { n: '30 日 D30', v: 21 }], '#bf5af2')}
        <p style="font-size:12px;color:var(--text-faint);margin:12px 0 0">单位 %，对比行业均值 D7 28% 高 6pt</p></div>

      <div class="viz-card span4"><div class="viz-h"><div><h3>积分流水</h3><div class="sub">今日</div></div></div>
        <div class="viz-kpi" style="margin-bottom:10px"><span class="k">净消耗</span><span class="v" style="font-size:24px">9.02M</span></div>
        ${hbars([{ n: '消耗', v: 9020 }, { n: '充值', v: 6240 }, { n: '赠送', v: 2410 }, { n: '退还', v: 320 }], '#ff9f0a')}</div>

      <div class="viz-card span12"><div class="viz-h"><div><h3>模型健康度</h3><div class="sub">实时 · 成功率 / 时延 / 队列</div></div></div>
        ${healthBoard([
          { n: 'GPT Image 2', ok: 99.6, lat: 132, q: 12 },
          { n: 'Flux.1 Pro', ok: 99.2, lat: 168, q: 8 },
          { n: 'Seedance 2.0', ok: 98.1, lat: 940, q: 34 },
          { n: '可灵 Kling 1.6', ok: 96.4, lat: 1120, q: 58 },
          { n: 'Midjourney v6', ok: 99.8, lat: 210, q: 4 },
          { n: '即梦 3.0', ok: 99.1, lat: 156, q: 9 },
        ])}</div>

      <div class="viz-card span6"><div class="viz-h"><div><h3>用户消耗榜</h3><div class="sub">本月积分消耗 Top 6</div></div></div>
        ${leaderboard([
          { n: 'KENJI', v: 184200, up: 12 }, { n: '夜航 NightSail', v: 152600, up: 8 },
          { n: 'Studio 3F', v: 121800, up: -3 }, { n: 'Mira', v: 98400, up: 5 },
          { n: '砚 Yan', v: 76200, up: 2 }, { n: 'Vega', v: 64800, up: -1 },
        ], 'user')}</div>

      <div class="viz-card span6"><div class="viz-h"><div><h3>模型使用排行榜</h3><div class="sub">本周调用次数</div></div></div>
        ${leaderboard([
          { n: 'GPT Image 2', v: 1240000, up: 9 }, { n: 'Flux.1 Pro', v: 862000, up: 6 },
          { n: 'Seedance 2.0', v: 540000, up: 22 }, { n: '可灵 Kling 1.6', v: 410000, up: 14 },
          { n: 'Midjourney v6', v: 320000, up: -4 }, { n: '即梦 3.0', v: 286000, up: 7 },
        ], 'model')}</div>
    </div>`;
  };

  V.marketing = () => kpis([
    ['进行中活动', '8', '+2 本周', 'up'],
    ['今日券核销', '4,218', '+9%', 'up'],
    ['活动带来营收', '¥86,400', '+14%', 'up'],
    ['拉新 ROI', '3.8×', '+0.4', 'up'],
  ]) +
    panel('营销活动', '运营活动、Banner 与投放', `${filterChips(['全部', '进行中', '待开始', '已结束'])}<button class="adm-btn">+ 新建活动</button>`,
      table(['活动', '类型', '周期', '参与', '转化', '状态', '操作'],
        [['限时年付 -42%', '促销', '02-01 ~ 02-29', '12.4k', '8.2%'], ['新人 7 天礼包', '拉新', '长期', '48k', '21%'], ['老带新裂变', '裂变', '01-10 ~ 02-20', '9.8k', '12%'], ['春节创作大赛', '活动', '已结束', '32k', '—'], ['企业试用', '线索', '长期', '1.2k', '6%']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td>${tag(r[1], 'blue')}</td><td class="muted">${r[2]}</td>
          <td class="mono">${r[3]}</td><td class="mono">${r[4]}</td>
          <td>${tag(i === 3 ? '已结束' : i === 4 ? '进行中' : '进行中', i === 3 ? 'gray' : 'green')}</td>${acts(['编辑', '数据', '停用'])}
        </tr>`))) +
    panel('优惠券 / 兑换码', null, '<button class="adm-btn ghost">+ 发券</button>',
      table(['名称', '类型', '面额 / 力度', '已领 / 已用', '有效期', '状态', '操作'],
        [['新人券', '满减', '¥20', '50k / 38k'], ['会员折扣', '折扣', '8 折', '20k / 12k'], ['积分礼包码', '兑换', '+500 积分', '10k / 7.2k'], ['回归券', '直减', '¥15', '8k / 2.1k']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td>${r[1]}</td><td class="mono">${r[2]}</td><td class="mono">${r[3]}</td>
          <td class="muted">~ 02-2${i}</td><td>${sw(i !== 3)}</td>${acts(['编辑', '停用'])}
        </tr>`))) +
    panel('渠道投放', '各渠道获客与成本', '',
      `<div style="padding:18px"><div class="cfg-grid">
        <div class="cfg-card"><h3>渠道 ROI</h3><p>近 30 天各投放渠道表现。</p>
          ${hbars([{ n: '抖音', v: 4200 }, { n: '小红书', v: 3600 }, { n: '微信', v: 2800 }, { n: 'B 站', v: 1900 }, { n: 'SEO', v: 1500 }], '#0a84ff')}</div>
        <div class="cfg-card"><h3>获客成本 CAC</h3><p>单个付费用户平均成本。</p>
          <div class="cfg-row"><span class="lab">本月 CAC</span><span class="mono">¥18.6</span></div>
          <div class="cfg-row"><span class="lab">目标 CAC</span><span class="mono">≤ ¥22</span></div>
          <div class="cfg-row"><span class="lab">LTV / CAC</span><span class="mono">4.2×</span></div>
          <div class="cfg-row"><span class="lab">自动竞价</span>${sw(true)}</div></div>
        <div class="cfg-card"><h3>Push / 触达</h3><p>消息推送与召回策略。</p>
          <div class="cfg-row"><span class="lab">流失召回</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">每日 Push 上限</span><input type="number" value="2"><span class="unit">条</span></div>
          <div class="cfg-row"><span class="lab">免打扰时段</span><span class="muted">23:00–8:00</span></div></div>
      </div></div>`);

  V.config = () => kpis([
    ['服务可用率', '99.98%', '近 30 天', 'up'],
    ['API 密钥', '14', '', 'up'],
    ['管理员', '8', '', 'up'],
    ['待生效变更', '2', '', 'down'],
  ]) +
    panel('基础配置', '站点信息与全局开关', '<button class="adm-btn">保存变更</button>',
      `<div style="padding:18px"><div class="cfg-grid">
        <div class="cfg-card"><h3>站点信息</h3><p>前台展示的基础品牌信息。</p>
          <div class="cfg-row"><span class="lab">站点名称</span><input type="text" value="SCARECROW AI"></div>
          <div class="cfg-row"><span class="lab">备案号</span><input type="text" value="粤ICP备2026xxxxx"></div>
          <div class="cfg-row"><span class="lab">默认语言</span><select><option>简体中文</option><option>English</option></select></div></div>
        <div class="cfg-card"><h3>开关</h3><p>影响全站的功能总开关。</p>
          <div class="cfg-row"><span class="lab">维护模式</span>${sw(false)}</div>
          <div class="cfg-row"><span class="lab">开放注册</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">游客试用</span>${sw(true)}</div>
          <div class="cfg-row"><span class="lab">内容安全审核</span>${sw(true)}</div></div>
        <div class="cfg-card"><h3>生成默认值</h3><p>创作台的默认参数。</p>
          <div class="cfg-row"><span class="lab">默认模型</span><select><option>GPT Image 2</option><option>Flux.1 Pro</option></select></div>
          <div class="cfg-row"><span class="lab">默认数量</span><input type="number" value="4"></div>
          <div class="cfg-row"><span class="lab">单用户并发</span><input type="number" value="3"></div></div>
      </div></div>`) +
    panel('API 密钥', '第三方接入与回调密钥', '<button class="adm-btn ghost">+ 新建密钥</button>',
      table(['名称', 'Key', '权限', '调用量', '状态', '操作'],
        [['前台 Web', 'sk_live_a1b2…f9', '全部'], ['移动端', 'sk_live_c3d4…8e', '生成'], ['企业 API', 'sk_live_e5f6…2a', '只读'], ['剪映同步', 'sk_live_77a8…1c', '导出']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td class="mono muted">${r[1]}</td><td>${tag(r[2], 'blue')}</td>
          <td class="mono">${(2.1 - i * 0.4).toFixed(1)}M</td><td>${sw(i !== 3)}</td>${acts(['轮换', '吊销'])}
        </tr>`))) +
    panel('权限与角色', '后台管理员与角色权限', '<button class="adm-btn ghost">+ 添加成员</button>',
      table(['成员', '角色', '范围', '最近登录', '状态', '操作'],
        NAMES.slice(0, 5).map((n, i) => `<tr>
          <td><div class="cellflex"><span class="av" style="background:${swatch(n)}"></span><span class="strong">${n}</span></div></td>
          <td>${tag(['超级管理员', '运营', '审核', '财务', '只读'][i], i === 0 ? 'amber' : 'gray')}</td>
          <td class="muted">${['全部', '内容 / 用户', '作品审核', '商业', '查看'][i]}</td>
          <td class="muted">${i + 1} 小时前</td><td>${tag('启用', 'green')}</td>${acts(['编辑', '禁用'])}
        </tr>`)));

  V.email = () => kpis([
    ['今日发送', '48,210', '+6%', 'up'],
    ['送达率', '99.2%', '+0.1%', 'up'],
    ['打开率', '38.4%', '+2.1%', 'up'],
    ['退信 / 投诉', '0.6%', '-0.1%', 'up'],
  ]) +
    `<div class="adm-2col">` +
    panel('SMTP 服务', '发件服务器与认证', '<button class="adm-btn ghost">发送测试</button>',
      `<div style="padding:18px"><div class="cfg-card" style="border:none;padding:0;box-shadow:none">
        <div class="cfg-row"><span class="lab">服务商</span><select><option>阿里云邮件推送</option><option>腾讯云 SES</option><option>SendGrid</option><option>自建 SMTP</option></select></div>
        <div class="cfg-row"><span class="lab">SMTP 主机</span><input type="text" value="smtp.scarecrow.ai"></div>
        <div class="cfg-row"><span class="lab">端口</span><input type="number" value="465"></div>
        <div class="cfg-row"><span class="lab">加密</span><select><option>SSL</option><option>TLS</option><option>无</option></select></div>
        <div class="cfg-row"><span class="lab">发件邮箱</span><input type="text" value="no-reply@scarecrow.ai"></div>
        <div class="cfg-row"><span class="lab">发件人名称</span><input type="text" value="SCARECROW AI"></div>
        <div class="cfg-row"><span class="lab">SPF / DKIM</span>${tag('已验证', 'green')}</div>
        <div class="cfg-row"><span class="lab">启用发信</span>${sw(true)}</div>
      </div></div>`) +
    panel('发送策略', '频控与降级', '',
      `<div style="padding:18px"><div class="cfg-card" style="border:none;padding:0;box-shadow:none">
        <div class="cfg-row"><span class="lab">每用户每日上限</span><input type="number" value="10"><span class="unit">封</span></div>
        <div class="cfg-row"><span class="lab">每分钟发送上限</span><input type="number" value="600"><span class="unit">封</span></div>
        <div class="cfg-row"><span class="lab">失败重试次数</span><input type="number" value="3"></div>
        <div class="cfg-row"><span class="lab">退信自动拉黑</span>${sw(true)}</div>
        <div class="cfg-row"><span class="lab">营销邮件免打扰</span><span class="muted">22:00–8:00</span></div>
        <div class="cfg-row"><span class="lab">备用通道降级</span>${sw(true)}</div>
      </div></div>`) +
    `</div>` +
    panel('邮件模板', '系统与营销邮件模板', `${filterChips(['全部', '系统', '营销', '通知'])}<button class="adm-btn">+ 新建模板</button>`,
      table(['模板', '类型', '触发场景', '变量', '更新时间', '状态', '操作'],
        [['注册验证码', '系统', '用户注册', '{code} {name}'], ['找回密码', '系统', '密码重置', '{link}'], ['会员到期提醒', '通知', '到期前 3 天', '{plan} {date}'], ['充值成功', '通知', '支付完成', '{amount} {balance}'], ['限时促销', '营销', '活动推送', '{title} {coupon}'], ['流失召回', '营销', '7 天未活跃', '{name} {gift}']].map((r, i) => `<tr>
          <td class="strong">${r[0]}</td><td>${tag(r[1], r[1] === '系统' ? 'gray' : r[1] === '营销' ? 'amber' : 'blue')}</td>
          <td class="muted">${r[2]}</td><td class="mono muted" style="font-size:11.5px">${r[3]}</td>
          <td class="muted">02-1${i}</td><td>${sw(i !== 5)}</td>${acts(['编辑', '预览', '测试'])}
        </tr>`)));

  V.dash = () => V.viz() + V.dashTables();

  /* ---------- router ---------- */
  function buildNav() {
    const nav = $('#admNav');
    nav.innerHTML = NAV.map(n => n.g
      ? `<div class="adm-grp">${n.g}</div>`
      : `<div class="adm-link" data-id="${n.id}"><svg viewBox="0 0 24 24"><path d="${ICON[n.icon]}"/></svg><span>${n.label}</span>${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</div>`
    ).join('');
    nav.addEventListener('click', e => { const l = e.target.closest('.adm-link'); if (l) go(l.dataset.id); });
  }
  function go(id) {
    const item = NAV.find(n => n.id === id) || NAV[1];
    $$('#admNav .adm-link').forEach(l => l.classList.toggle('on', l.dataset.id === id));
    $('#admTitle').textContent = item.label;
    $('#admCrumb').textContent = '控制台 / ' + (item.label);
    $('#admContent').innerHTML = (V[id] || V.dash)();
    $('#admContent').scrollTop = 0;
    // wire toggles + chips + toasts
    $$('#admContent .sw-toggle').forEach(s => s.addEventListener('click', () => s.classList.toggle('on')));
    $$('#admContent .adm-chip').forEach(c => c.addEventListener('click', () => {
      const sib = c.parentElement.querySelectorAll('.adm-chip'); sib.forEach(x => x.classList.remove('on')); c.classList.add('on');
    }));
    try { location.hash = id; } catch (e) {}
    // auto-pager for list tables (>=5 rows)
    $$('#admContent .adm-panel').forEach(p => {
      const tb = p.querySelector('.adm-table tbody'); if (!tb) return;
      const rows = tb.querySelectorAll('tr').length; if (rows < 5) return;
      const total = rows * 7 + 13;
      const pages = Math.min(7, Math.ceil(total / 10));
      let btns = '<button class="pg nav">‹</button>';
      for (let i = 1; i <= pages; i++) btns += `<button class="pg${i === 1 ? ' on' : ''}">${i}</button>`;
      btns += `<span class="gap">…</span><button class="pg">${Math.ceil(total / 10)}</button><button class="pg nav">›</button>`;
      const pager = document.createElement('div');
      pager.className = 'adm-pager';
      pager.innerHTML = `<span class="total">共 ${total.toLocaleString()} 条</span><div class="pgs"><select class="psz"><option>10 条/页</option><option>20 条/页</option><option>50 条/页</option></select>${btns}</div>`;
      pager.addEventListener('click', e => { const b = e.target.closest('.pg'); if (!b || b.classList.contains('nav')) return; pager.querySelectorAll('.pg').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
      p.appendChild(pager);
    });
    // model管理: wire add/config buttons to the detail modal
    if (id === 'models') {
      $$('#admContent .adm-btn').forEach(b => { if (b.textContent.includes('接入模型')) { b.dataset.modal = '1'; b.addEventListener('click', modelModal); } });
      $$('#admContent .rowacts button').forEach(b => { if (b.textContent === '配置') { b.dataset.modal = '1'; b.addEventListener('click', modelModal); } });
    }
    if (id === 'works') {
      $$('#admContent .adm-table tbody tr').forEach(tr => {
        const vb = Array.from(tr.querySelectorAll('.rowacts button')).find(b => b.textContent === '查看');
        if (vb) { vb.dataset.modal = '1'; const wid = (tr.querySelector('.strong') || {}).textContent || '作品'; const au = tr.children[1] ? tr.children[1].textContent : ''; vb.addEventListener('click', () => workModal(wid, au)); }
      });
    }
    if (id === 'insp') {
      $$('#admContent .adm-btn').forEach(b => { if (b.textContent.includes('新增合集')) { b.dataset.modal = '1'; b.addEventListener('click', () => inspModal()); } });
      $$('#admContent .adm-table tbody tr').forEach(tr => {
        const eb = Array.from(tr.querySelectorAll('.rowacts button')).find(b => b.textContent === '编辑');
        if (eb) { eb.dataset.modal = '1'; const t = (tr.querySelector('.strong') || {}).textContent || '合集'; eb.addEventListener('click', () => inspModal(t)); }
      });
    }
    // unified secondary-page wiring for remaining modules
    (function () {
      const wire = (addText, addFn, editText, editFn) => {
        if (addText) $$('#admContent .adm-btn').forEach(b => { if (b.textContent.includes(addText)) { b.dataset.modal = '1'; b.addEventListener('click', () => addFn()); } });
        if (editText) $$('#admContent .adm-table tbody tr').forEach(tr => {
          const eb = Array.from(tr.querySelectorAll('.rowacts button')).find(b => editText.includes(b.textContent));
          if (eb) { eb.dataset.modal = '1'; const nm = (tr.querySelector('.strong') || {}).textContent.replace(/\s+热门|\s+系统/g, '').trim() || ''; eb.addEventListener('click', () => editFn(nm)); }
        });
      };
      if (id === 'discover') wire('新增推荐位', discoverModal, ['编辑'], discoverModal);
      if (id === 'res') wire(null, null, ['详情'], resModal);
      if (id === 'credit') wire('新增规则', ruleModal, ['编辑'], ruleModal);
      if (id === 'price') wire('新增套餐', priceModal, ['编辑'], priceModal);
      if (id === 'pay') wire('接入渠道', payModal, ['配置'], payModal);
      if (id === 'config') {
        wire('新建密钥', keyModal, null, null);
        wire('添加成员', memberModal, null, null);
        $$('#admContent .adm-table tbody tr').forEach(tr => {
          const nm = (tr.querySelector('.strong') || {}).textContent || '';
          tr.querySelectorAll('.rowacts button').forEach(b => {
            if (b.textContent === '轮换') { b.dataset.modal = '1'; b.addEventListener('click', () => keyModal(nm)); }
            if (b.textContent === '编辑') { b.dataset.modal = '1'; b.addEventListener('click', () => memberModal(nm)); }
          });
        });
      }
      if (id === 'marketing') {
        wire('新建活动', mktModal, null, null);
        wire('优惠券', () => mktModal(null, 'coupon'), null, null);
        $$('#admContent .adm-table tbody tr').forEach(tr => {
          const nm = (tr.querySelector('.strong') || {}).textContent || '';
          const eb = Array.from(tr.querySelectorAll('.rowacts button')).find(b => b.textContent === '编辑');
          if (eb) { eb.dataset.modal = '1'; eb.addEventListener('click', () => mktModal(nm)); }
        });
      }
      if (id === 'email') wire('新建模板', tplModal, ['编辑'], tplModal);
    })();
    if (id === 'floor') {
      $$('#admContent .adm-btn').forEach(b => { if (b.textContent.includes('新增楼层')) { b.dataset.modal = '1'; b.addEventListener('click', () => floorModal()); } });
      $$('#admContent .floor').forEach(fl => {
        const nm = (fl.querySelector('.nm') || {}).textContent || '楼层';
        fl.querySelectorAll('.rowacts button').forEach(b => { if (b.textContent === '编辑') { b.dataset.modal = '1'; b.addEventListener('click', () => floorModal(nm)); } });
      });
    }
    if (id === 'users') {
      $$('#admContent .adm-btn').forEach(b => {
        if (b.textContent.includes('新建用户')) { b.dataset.modal = '1'; b.addEventListener('click', newUserModal); }
        if (b.textContent.includes('新建角色')) { b.dataset.modal = '1'; b.addEventListener('click', () => roleModal()); }
      });
      $$('#admContent .adm-table tbody tr').forEach(tr => {
        const dt = Array.from(tr.querySelectorAll('.rowacts button')).find(b => b.textContent === '详情');
        if (dt) { dt.dataset.modal = '1'; const nm = (tr.querySelector('.strong') || {}).textContent || '用户'; dt.addEventListener('click', () => userModal(nm)); }
        const pm = Array.from(tr.querySelectorAll('.rowacts button')).find(b => b.textContent === '权限');
        if (pm) { pm.dataset.modal = '1'; const rn = (tr.querySelector('.strong') || {}).textContent.replace(/\s*系统\s*$/, '').trim() || '角色'; pm.addEventListener('click', () => roleModal(rn)); }
      });
    }
  }

  /* ---------- global toast for every other action ---------- */
  let admToastEl, admToastT;
  function admToast(msg) {
    if (!admToastEl) { admToastEl = document.createElement('div'); admToastEl.className = 'adm-toast'; document.body.appendChild(admToastEl); }
    admToastEl.textContent = msg; void admToastEl.offsetWidth; admToastEl.classList.add('show');
    clearTimeout(admToastT); admToastT = setTimeout(() => admToastEl.classList.remove('show'), 1900);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('.adm-mask')) return;            // modal internals handle themselves
    const b = e.target.closest('.adm-btn, .rowacts button, .adm-top .tbtn, .adm-side-foot a');
    if (!b || b.dataset.modal === '1') return;
    const t = b.textContent.trim().replace(/^[+✦↻⤓☑⇄↩]\s*/, '');
    admToast(t ? '「' + t + '」· 高保真原型' : '操作已记录 · 原型');
  });

  document.addEventListener('DOMContentLoaded', () => {
    buildNav();
    const start = (location.hash || '').replace('#', '') || 'dash';
    go(NAV.find(n => n.id === start) ? start : 'dash');
  });
})();
