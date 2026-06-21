/* global React, Icon, Logo, Wordmark, mesh, tr */
// SCARECROWAI — Pricing page / 价格方案页 (imini-style)
const { createElement: p, useState: pS, useEffect: pE } = React;

const PLAN_FEATS_CN = ['全球 SOTA 模型聚合','可选全球顶级模型','Codex Agent 智能创作系统','角色写真 / 真人风格','高质量艺术风格图','专业修图 / 精修','独家 AI 幻灯片（图文结合）','时刻至 Prompt 优化','视频扩展 / 视频补帧','换脸、抠像、综艺剪辑','视频风格化 / 动画'];
const PLAN_FEATS_EN = ['Global SOTA model hub','Top global models','Codex Agent creation','Portrait / real-person style','High-quality art styles','Pro retouch / refine','Exclusive AI slides','Smart prompt optimize','Video extend / interpolate','Face/cutout/edit','Video stylize / animate'];

const PLANS_CN = [
  { id: 'free', name: 'FREE', usd_m: 0, usd_y: 0, off: 0, year: 0, yearOrig: 0, credits: null, mult: null,
    core: ['每日 1 次 Nano Banana', '每日 20 轮 Chat 对话', '基础模型体验', '免费开始创作'],
    extra: [], cta: '立即订阅', accent: false },
  { id: 'pro', name: 'PRO', usd_m: 8.33, usd_y: 8.33, off: 17, year: 100, yearOrig: 120, credits: '10,000', mult: '标准用量', fill: 0.25,
    core: ['最高 200 次 AI 图像生成', '最高 100 次 AI 视频生成', '创作专家 Agent 无限对话', '30GB 云存储空间'],
    extra: ['GPT-5.5 创作专家 Agent 早鸟体验权限', '每日首次免费使用 Nano Banana', 'Nano Banana 系列模型消耗低至 4 折', 'Seedance 2.0 模型积分限时 9 折', '访问所有功能', '访问所有模型', '所有生成内容可商用'],
    cta: '立即订阅', accent: false },
  { id: 'max', name: 'MAX', usd_m: 20, usd_y: 20, off: 34, year: 240, yearOrig: 360, credits: '30,000', mult: '3 倍用量', fill: 0.55,
    core: ['最高 600 次 AI 图像生成', '最高 300 次 AI 视频生成', '创作专家 Agent 无限对话', '100GB 云存储空间'],
    extra: ['GPT-5.5 创作专家 Agent 早鸟体验权限', '每日首次免费使用 Nano Banana', 'Nano Banana 系列模型消耗低至 4 折', 'Seedance 2.0 模型积分限时 9 折', '访问所有功能', '访问所有模型', '所有生成内容可商用'],
    cta: '立即订阅', accent: true, badge: '最热门' },
  { id: 'ultra', name: 'ULTRA', usd_m: 55, usd_y: 55, off: 45, year: 660, yearOrig: 1200, credits: '100,000', mult: '10 倍用量', fill: 1,
    core: ['最高 2000 次 AI 图像生成', '最高 1000 次 AI 视频生成', '创作专家 Agent 无限对话', '300GB 云存储空间'],
    extra: ['GPT-5.5 创作专家 Agent 早鸟体验权限', '每日首次免费使用 Nano Banana', 'Nano Banana 系列模型消耗低至 4 折', 'Seedance 2.0 模型积分限时 9 折', '访问所有功能', '访问所有模型', '所有生成内容可商用'],
    cta: '立即订阅', accent: false },
];
const PLANS_EN = [
  { ...PLANS_CN[0], core: ['1 Nano Banana / day', '20 Chat rounds / day', 'Basic model access', 'Start for free'], extra: [], cta: 'Subscribe', badge: undefined },
  { ...PLANS_CN[1], mult: 'Standard', core: ['Up to 200 AI images', 'Up to 100 AI videos', 'Unlimited Agent chat', '30GB cloud storage'], extra: ['GPT-5.5 Agent early access', 'Free daily Nano Banana', 'Nano Banana up to 60% off', 'Seedance 2.0 10% off', 'All features', 'All models', 'Commercial use'], cta: 'Subscribe' },
  { ...PLANS_CN[2], mult: '3× usage', badge: 'Most Popular', core: ['Up to 600 AI images', 'Up to 300 AI videos', 'Unlimited Agent chat', '100GB cloud storage'], extra: ['GPT-5.5 Agent early access', 'Free daily Nano Banana', 'Nano Banana up to 60% off', 'Seedance 2.0 10% off', 'All features', 'All models', 'Commercial use'], cta: 'Subscribe' },
  { ...PLANS_CN[3], mult: '10× usage', core: ['Up to 2000 AI images', 'Up to 1000 AI videos', 'Unlimited Agent chat', '300GB cloud storage'], extra: ['GPT-5.5 Agent early access', 'Free daily Nano Banana', 'Nano Banana up to 60% off', 'Seedance 2.0 10% off', 'All features', 'All models', 'Commercial use'], cta: 'Subscribe' },
];

// comparison: columns + per-row support (2=full check, 1=partial, 0=none)
const COMPARE_COLS_CN = ['SCARECROWAI', 'GPT Image 2', 'Nano Banana Pro', 'Dreamina / Seedance'];
const COMPARE_COLS_EN = ['SCARECROWAI', 'GPT Image 2', 'Nano Banana Pro', 'Dreamina / Seedance'];
const COMPARE_SUB = ['US$10.00 /月', 'US$30 / 100张', 'US$19.99 /月起', 'US$18 /月起'];
const COMPARE_ROWS = [
  [2, 0, 0, 1], [2, 0, 0, 0], [2, 0, 0, 0], [2, 0, 2, 2], [2, 2, 2, 2],
  [2, 0, 1, 2], [2, 0, 0, 0], [2, 0, 0, 0], [2, 0, 2, 2], [2, 0, 1, 1], [2, 0, 2, 2],
];

const PRICING_FAQS_CN = [
  { q: 'SCARECROWAI 提供哪些订阅方案？', a: 'SCARECROWAI 提供四种方案：功能有限的免费方案、包含 10,000 积分的 Pro 方案、包含 30,000 积分的 Max 方案，以及包含 100,000 积分的 Ultra 方案。' },
  { q: '积分如何运作？', a: '每次生成消耗对应积分，生成前会显示确切用量。图片约 5–20 积分/张，视频约 50–200 积分/条，具体视模型而定。' },
  { q: '如果我的积分用完了，该如何获取更多积分？', a: '可随时升级到更高方案，或按需购买一次性积分包，灵活补充。' },
  { q: '如果我决定将每月订阅升级为年度订阅怎么办？', a: '可随时升级，系统将按比例折算剩余费用并应用到年度订阅，享受年付优惠价。' },
  { q: 'SCARECROWAI 提供哪些付款选项？', a: '支持信用卡（Visa / MasterCard / AMEX）、支付宝、微信支付、Apple Pay、PayPal 及银联。' },
  { q: '未使用的每月额度会累积到下一个计费周期吗？', a: '月度积分在账单日刷新，未使用积分清零。年度方案积分按月发放，当月未用同样清零。' },
  { q: '如果我决定取消怎么办？', a: '可随时取消，当前周期结束前仍享受完整权益，不收取额外费用。' },
  { q: '如何查看我的剩余积分额度？', a: '在「我的创作」→「账户」页面可实时查看积分余额、用量明细与刷新日期。' },
  { q: '如何联系 SCARECROWAI 支持团队？', a: '个人用户请邮件 support@scarecrow.ai，商务合作请邮件 business@scarecrow.ai。' },
];
const PRICING_FAQS_EN = [
  { q: 'What plans does SCARECROWAI offer?', a: 'Four tiers: a limited Free plan, Pro (10,000 credits), Max (30,000 credits), and Ultra (100,000 credits).' },
  { q: 'How do credits work?', a: 'Each generation uses credits. Images ~5–20, videos ~50–200, depending on the model. Exact cost is shown before you generate.' },
  { q: 'What if I run out of credits?', a: 'Upgrade to a higher plan or buy a one-time credit pack anytime.' },
  { q: 'What if I upgrade monthly to annual?', a: 'Upgrade anytime — remaining balance is prorated and applied to the annual plan at the discounted rate.' },
  { q: 'What payment methods are accepted?', a: 'Visa, MasterCard, AMEX, Alipay, WeChat Pay, Apple Pay, PayPal, and UnionPay.' },
  { q: 'Do unused monthly credits roll over?', a: 'Monthly credits reset on your billing date; unused credits are cleared. The same applies to annual monthly allocations.' },
  { q: 'What if I cancel?', a: 'Cancel anytime — full access until the end of the current period, no extra charges.' },
  { q: 'How do I check my credit balance?', a: 'See real-time balance, usage, and refresh date under My Work → Account.' },
  { q: 'How do I contact support?', a: 'Personal: support@scarecrow.ai · Business: business@scarecrow.ai.' },
];

// ── countdown ──────────────────────────────────────────────────────────
function useCountdown(target) {
  const [rem, setRem] = pS(() => Math.max(0, target - Date.now()));
  pE(() => {
    const t = setInterval(() => setRem(Math.max(0, target - Date.now())), 1000);
    return () => clearInterval(t);
  }, [target]);
  return {
    d: Math.floor(rem / 86400000),
    h: Math.floor((rem % 86400000) / 3600000),
    m: Math.floor((rem % 3600000) / 60000),
    s: Math.floor((rem % 60000) / 1000),
  };
}
function CD({ n, label }) {
  return p('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 'none' } },
    p('div', { style: { display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 12,
      fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 800, color: '#fff',
      background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' } }, String(n).padStart(2, '0')),
    p('div', { style: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 } }, label));
}

// ── plan credit bar ─────────────────────────────────────────────────────
function CreditBar({ fill, accent }) {
  const total = 22; const lit = Math.round(total * fill);
  return p('div', { style: { display: 'flex', gap: 2.5, marginTop: 8 } },
    Array.from({ length: total }, (_, i) => p('span', { key: i, style: { flex: 1, height: 10, borderRadius: 2,
      background: i < lit ? (accent ? 'var(--accent-2)' : 'var(--accent)') : 'var(--border)' } })));
}

// ── feature row icon ────────────────────────────────────────────────────
function Tick({ kind }) {
  if (kind === 2) return p('span', { style: { display: 'grid', placeItems: 'center', width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-2)', flex: 'none' } }, p(Icon, { name: 'check', size: 12, stroke: 2.4, style: { color: '#06243a' } }));
  if (kind === 1) return p('span', { style: { width: 9, height: 9, borderRadius: '50%', background: '#f5a623', flex: 'none', margin: '0 4.5px' } });
  return p('span', { style: { display: 'grid', placeItems: 'center', width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--border-strong)', flex: 'none', color: 'var(--text-faint)' } }, p(Icon, { name: 'close', size: 10, stroke: 2.2 }));
}

// ── plan card ───────────────────────────────────────────────────────────
function PlanCard({ plan, annual, lang }) {
  const isAccent = plan.accent;
  const showYear = annual && plan.usd_m > 0;
  const baseShadow = isAccent ? '0 0 0 1px var(--accent-2), 0 16px 50px color-mix(in oklab, var(--accent-2) 22%, transparent)' : 'var(--shadow-card)';
  const hoverShadow = isAccent ? '0 0 0 1px var(--accent-2), 0 24px 64px color-mix(in oklab, var(--accent-2) 34%, transparent)' : 'var(--shadow-pop)';
  return p('div', { className: 'pcard',
    onMouseEnter: e => { e.currentTarget.style.boxShadow = hoverShadow; if (!isAccent) e.currentTarget.style.borderColor = 'var(--border-strong)'; },
    onMouseLeave: e => { e.currentTarget.style.boxShadow = baseShadow; if (!isAccent) e.currentTarget.style.borderColor = 'var(--border)'; },
    style: { position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 18, minWidth: 0,
    background: 'var(--panel-solid)',
    border: '1.5px solid ' + (isAccent ? 'var(--accent-2)' : 'var(--border)'),
    boxShadow: baseShadow,
    overflow: 'hidden', paddingTop: isAccent ? 0 : 26 } },
    isAccent ? p('div', { style: { height: 34, background: 'var(--accent-2)', color: '#06243a', fontSize: 12.5, fontWeight: 800, display: 'grid', placeItems: 'center', letterSpacing: '.05em' } }, plan.badge || (lang === 'cn' ? '最热门' : 'Most Popular')) : null,
    p('div', { style: { padding: isAccent ? '22px 22px 26px' : '0 22px 26px', display: 'flex', flexDirection: 'column', flex: 1 } },
      // name + off
      p('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 } },
        p('span', { className: 'font-display', style: { fontSize: 22, fontWeight: 800, letterSpacing: '.01em' } }, plan.name),
        plan.off > 0 ? p('span', { style: { fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
          background: isAccent ? 'var(--accent-2)' : 'var(--panel)', color: isAccent ? '#06243a' : 'var(--text-dim)', border: isAccent ? 'none' : '1px solid var(--border)' } }, plan.off + '% OFF') : null),
      // price
      p('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: showYear ? 5 : 22 } },
        p('span', { className: 'font-display', style: { fontSize: 34, fontWeight: 800 } }, 'US$ ' + (annual ? plan.usd_y : plan.usd_m)),
        p('span', { style: { fontSize: 14, color: 'var(--text-faint)' } }, '/', lang === 'cn' ? '月' : 'mo')),
      showYear ? p('div', { style: { fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 20 } },
        'US$' + plan.year + '.0/' + (lang === 'cn' ? '年' : 'yr') + '  ',
        p('span', { style: { textDecoration: 'line-through', opacity: 0.6 } }, 'US$' + plan.yearOrig + '.0')) : null,
      // CTA
      p('button', { className: 'pcard-cta', style: { width: '100%', height: 46, borderRadius: 10, fontWeight: 700, fontSize: 15, marginBottom: 22,
        background: isAccent ? 'var(--accent-2)' : 'var(--text)', color: isAccent ? '#06243a' : 'var(--bg)',
        boxShadow: isAccent ? '0 6px 20px color-mix(in oklab, var(--accent-2) 35%, transparent)' : 'none' } }, plan.cta),
      // credits
      plan.credits ? p('div', { style: { marginBottom: 18 } },
        p('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          p('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700 } },
            p(Icon, { name: 'sparkle', size: 14, style: { color: isAccent ? 'var(--accent-2)' : 'var(--accent)' } }),
            lang === 'cn' ? '每月 ' + plan.credits + ' 积分' : plan.credits + ' credits/mo'),
          p('span', { style: { fontSize: 11.5, color: 'var(--text-faint)', fontWeight: 600 } }, plan.mult)),
        p(CreditBar, { fill: plan.fill, accent: isAccent }))
        : p('div', { style: { marginBottom: 18, height: 1 } }),
      // core features
      p('div', { style: { display: 'flex', flexDirection: 'column', gap: 11, paddingTop: plan.credits ? 16 : 0, borderTop: plan.credits ? '1px solid var(--border)' : 'none' } },
        plan.core.map((f, i) => p('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 } },
          p(Icon, { name: 'check', size: 14, style: { color: isAccent ? 'var(--accent-2)' : 'var(--accent)', flex: 'none' } }),
          p('span', { style: { color: 'var(--text-dim)' } }, f)))),
      // extra features
      plan.extra.length ? p('div', { style: { display: 'flex', flexDirection: 'column', gap: 11, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' } },
        plan.extra.map((f, i) => p('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13 } },
          p(Icon, { name: 'check', size: 14, style: { color: isAccent ? 'var(--accent-2)' : 'var(--accent)', flex: 'none', marginTop: 2 } }),
          p('span', { style: { color: 'var(--text-dim)', lineHeight: 1.4 } }, f)))) : null,
    ),
  );
}

function PricingPage({ lang, onCreate }) {
  const [annual, setAnnual] = pS(true);
  const [faqOpen, setFaqOpen] = pS(0);
  const deadline = Date.now() + 8 * 86400000 + 15 * 3600000 + 13 * 60000 + 40000;
  const { d, h, m, s } = useCountdown(deadline);
  const plans = lang === 'cn' ? PLANS_CN : PLANS_EN;
  const faqs = lang === 'cn' ? PRICING_FAQS_CN : PRICING_FAQS_EN;
  const featRows = lang === 'cn' ? PLAN_FEATS_CN : PLAN_FEATS_EN;
  const cols = lang === 'cn' ? COMPARE_COLS_CN : COMPARE_COLS_EN;

  return p('div', { style: { maxWidth: 1240, margin: '0 auto', padding: '48px 22px 80px' } },
    // ── title
    p('h1', { className: 'font-display', style: { fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, margin: '0 0 30px', letterSpacing: '-0.02em', textAlign: 'center' } },
      lang === 'cn' ? '一站式超级 AI 创作智能体' : 'One super AI agent for everything'),

    // ── flash sale banner
    p('div', { style: { position: 'relative', overflow: 'hidden', borderRadius: 20, marginBottom: 30,
      background: 'linear-gradient(110deg, #5b3df5 0%, #7b6bf0 45%, #9d8bf5 100%)', padding: '22px 28px',
      boxShadow: '0 16px 50px color-mix(in oklab, #6d4fff 30%, transparent)' } },
      p('div', { style: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', top: -140, right: 120, background: '#fff', opacity: 0.12, filter: 'blur(70px)' } }),
      p('div', { style: { position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 22 } },
        // app icon
        p('div', { style: { width: 76, height: 76, borderRadius: 18, background: 'linear-gradient(135deg,#9d8bf5,#5b3df5)', display: 'grid', placeItems: 'center', flex: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,0.25)' } },
          p(Logo, { size: 42, tone: 'solid', style: { color: '#fff' } })),
        // copy
        p('div', { style: { flex: 1, minWidth: 240 } },
          p('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
            p('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.22)', color: '#fff' } },
              '⚡ ', lang === 'cn' ? '限时闪购' : 'Flash sale'),
            p('span', { style: { fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'rgba(255,255,255,0.2)', color: '#fff' } },
              lang === 'cn' ? '立省 $160！抢占年度 Max 算力。' : 'Save $160 on annual Max!')),
          p('div', { style: { fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 4 } },
            lang === 'cn' ? 'GPT 5.5 驱动的创作 Agent 早鸟权益' : 'GPT 5.5 Agent early-bird access'),
          p('div', { style: { fontSize: 13.5, color: 'rgba(255,255,255,0.78)' } },
            lang === 'cn' ? '帮你聊清楚需求，SCARECROWAI 直接出图' : 'Describe your idea, SCARECROWAI generates instantly')),
        // countdown
        p('div', { style: { display: 'flex', gap: 8, flex: 'none' } },
          [[d, lang === 'cn' ? '天' : 'D'], [h, lang === 'cn' ? '小时' : 'H'], [m, lang === 'cn' ? '分钟' : 'M'], [s, lang === 'cn' ? '秒' : 'S']]
            .map(([n, l], i) => p(CD, { key: i, n, label: l })))),
    ),

    // ── annual/monthly toggle
    p('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: 34 } },
      p('div', { style: { display: 'inline-flex', padding: 4, borderRadius: 30, background: 'var(--panel)', border: '1px solid var(--border)' } },
        p('button', { onClick: () => setAnnual(true), style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 18px', borderRadius: 30, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
          background: annual ? 'var(--text)' : 'transparent', color: annual ? 'var(--bg)' : 'var(--text-dim)', transition: 'all .18s' } },
          lang === 'cn' ? '年付' : 'Annual',
          p('span', { style: { fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: '#ff4d6c', color: '#fff' } }, '45%OFF')),
        p('button', { onClick: () => setAnnual(false), style: { height: 36, padding: '0 20px', borderRadius: 30, fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap',
          background: !annual ? 'var(--text)' : 'transparent', color: !annual ? 'var(--bg)' : 'var(--text-dim)', transition: 'all .18s' } },
          lang === 'cn' ? '月付' : 'Monthly'))),

    // ── plan cards
    p('div', { style: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))', marginBottom: 70, alignItems: 'stretch' } },
      plans.map((plan) => p(PlanCard, { key: plan.id, plan, annual, lang }))),

    // ── comparison
    p('h2', { className: 'font-display', style: { fontSize: 'clamp(22px, 2.6vw, 30px)', fontWeight: 800, textAlign: 'center', margin: '0 0 28px' } },
      lang === 'cn' ? '选择 SCARECROWAI 的理由' : 'Why choose SCARECROWAI'),
    p('div', { style: { overflowX: 'auto', marginBottom: 70, borderRadius: 16, border: '1px solid var(--border)' } },
      p('div', { style: { minWidth: 720 } },
        // header
        p('div', { style: { display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 1fr)', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' } },
          p('div', { style: { padding: '16px 18px', fontSize: 14, fontWeight: 700, color: 'var(--text-dim)' } }, lang === 'cn' ? '方案比较' : 'Comparison'),
          cols.map((c, i) => p('div', { key: i, style: { padding: '14px 12px', textAlign: 'center', borderLeft: i === 0 ? '1px solid var(--border)' : 'none' } },
            p('div', { style: { fontSize: 13.5, fontWeight: 800, color: i === 0 ? 'var(--accent)' : 'var(--text)', marginBottom: 3 } }, i === 0 ? 'SCARECROWAI' : c),
            p('div', { style: { fontSize: 10.5, color: 'var(--text-faint)' } }, COMPARE_SUB[i])))),
        // rows
        featRows.map((label, ri) => p('div', { key: ri, style: { display: 'grid', gridTemplateColumns: '1.6fr repeat(4, 1fr)', borderBottom: ri < featRows.length - 1 ? '1px solid var(--border)' : 'none', background: ri % 2 ? 'var(--surface-2)' : 'transparent' } },
          p('div', { style: { padding: '13px 18px', fontSize: 13, color: 'var(--text-dim)', display: 'flex', alignItems: 'center' } }, label),
          COMPARE_ROWS[ri].map((kind, ci) => p('div', { key: ci, style: { padding: '13px 12px', display: 'grid', placeItems: 'center', borderLeft: ci === 0 ? '1px solid var(--border)' : 'none', background: ci === 0 ? 'var(--accent-soft)' : 'transparent' } },
            p(Tick, { kind })))))),
    ),

    // ── FAQ
    p('h2', { className: 'font-display', style: { fontSize: 'clamp(22px, 2.6vw, 30px)', fontWeight: 800, textAlign: 'center', margin: '0 0 26px' } }, lang === 'cn' ? '常见问题' : 'FAQ'),
    p('div', { style: { maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column' } },
      faqs.map((f, i) => p('div', { key: i, style: { borderBottom: '1px solid var(--border)' } },
        p('button', { className: 'faq-row', onClick: () => setFaqOpen(faqOpen === i ? -1 : i),
          onMouseEnter: e => e.currentTarget.style.color = 'var(--accent)',
          onMouseLeave: e => e.currentTarget.style.color = 'var(--text)',
          style: { display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '18px 4px', fontSize: 15, fontWeight: 600, color: 'var(--text)' } },
          p('span', { style: { flex: 1 } }, f.q),
          p('span', { style: { color: 'var(--text-faint)', flex: 'none', transform: faqOpen === i ? 'rotate(45deg)' : 'none', transition: 'transform .2s' } }, p(Icon, { name: faqOpen === i ? 'close' : 'plus', size: 16 }))),
        faqOpen === i ? p('div', { style: { padding: '0 4px 18px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-dim)', maxWidth: 720 } }, f.a) : null))),
  );
}

window.PricingPage = PricingPage;
