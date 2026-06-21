/* SCARECROWAI 流光首页 — data (mesh covers + curated feed, mirrors app/data.jsx) */
(function () {
  function mesh(h1, h2, h3) {
    const map = (h) => 198 + (((h % 360) + 360) % 360) / 360 * 120;
    const a = map(h1), b = map(h2), c = map(h3);
    return [
      `radial-gradient(120% 130% at 16% 8%, hsl(${a} 68% 60%) 0%, transparent 52%)`,
      `radial-gradient(120% 120% at 88% 18%, hsl(${b} 60% 54%) 0%, transparent 50%)`,
      `radial-gradient(140% 140% at 50% 108%, hsl(${c} 56% 44%) 0%, transparent 58%)`,
      `linear-gradient(155deg, hsl(${a} 46% 15%) 0%, hsl(${b} 52% 8%) 100%)`
    ].join(', ');
  }
  function fmt(n) {
    if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return '' + n;
  }

  const ARTWORKS = [
    { c: mesh(268,192,320), h:1.34, type:'image', cat:'科幻',  model:'Flux.1 Pro',     title:'霓虹废土行者', author:'夜航 NightSail', likes:4820 },
    { c: mesh(20,42,8),     h:0.78, type:'image', cat:'人像',  model:'SDXL Lightning', title:'黄昏侧颜',     author:'Mira',          likes:2310 },
    { c: mesh(190,250,210), h:1.0,  type:'video', cat:'视频',  model:'Seedance 2.0',   title:'深海水母',     author:'OceanLab',      likes:8930 },
    { c: mesh(330,286,350), h:1.5,  type:'image', cat:'动漫',  model:'Animagine XL',   title:'雨夜便利店',   author:'青柠 Lime',     likes:6140 },
    { c: mesh(150,110,180), h:0.72, type:'image', cat:'插画',  model:'Flux.1 Dev',     title:'苔原小屋',     author:'Forrest',       likes:1890 },
    { c: mesh(300,260,18),  h:1.18, type:'image', cat:'人像',  model:'Midjourney v6',  title:'赛博艺伎',     author:'KENJI',         likes:12400 },
    { c: mesh(95,140,70),   h:0.92, type:'video', cat:'视频',  model:'可灵 Kling 1.6', title:'风穿麦田',     author:'稻田 Paddy',    likes:3360 },
    { c: mesh(210,248,196), h:1.28, type:'image', cat:'3D',    model:'Flux.1 Pro',     title:'果冻机器人',   author:'Studio 3F',     likes:5210 },
    { c: mesh(8,350,28),    h:0.84, type:'image', cat:'国风',  model:'墨韵 InkXL',     title:'青绿山水',     author:'砚 Yan',        likes:7720 },
    { c: mesh(255,230,290), h:1.12, type:'image', cat:'科幻',  model:'SDXL Turbo',     title:'轨道城市',     author:'Vega',          likes:4480 },
    { c: mesh(38,16,52),    h:0.7,  type:'image', cat:'摄影',  model:'Flux.1 Dev',     title:'沙丘正午',     author:'Atlas',         likes:2050 },
    { c: mesh(282,318,200), h:1.4,  type:'video', cat:'视频',  model:'Seedance 2.0',   title:'液态金属',     author:'FLUXLAB',       likes:9610 },
    { c: mesh(168,200,140), h:0.95, type:'image', cat:'插画',  model:'Animagine XL',   title:'森灵',         author:'青柠 Lime',     likes:3990 },
    { c: mesh(345,12,300),  h:1.22, type:'image', cat:'设计',  model:'Ideogram 2.0',   title:'复古唱片封面', author:'PRESS PLAY',    likes:1670 },
    { c: mesh(225,265,245), h:0.88, type:'image', cat:'人像',  model:'Midjourney v6',  title:'冰晶女王',     author:'Mira',          likes:8120 },
    { c: mesh(110,78,150),  h:1.3,  type:'image', cat:'动漫',  model:'Pony Diffusion', title:'机甲少女',     author:'KENJI',         likes:10500 },
    { c: mesh(30,60,20),    h:0.76, type:'video', cat:'视频',  model:'可灵 Kling 1.6', title:'熔岩流动',     author:'OceanLab',      likes:2890 },
    { c: mesh(195,175,230), h:1.05, type:'image', cat:'3D',    model:'Flux.1 Pro',     title:'微缩盆栽星球', author:'Studio 3F',     likes:4310 }
  ];

  const MODELS = [
    { c: mesh(268,200,320), name:'麦田写实 XL',   base:'SDXL', runs:182000, ver:'v3.0', tags:['写实','人像','电影感'], badge:'hot' },
    { c: mesh(330,286,12),  name:'霓虹故障风',     base:'Flux', runs:94000,  ver:'v2',   tags:['故障','霓虹'],          badge:'hot' },
    { c: mesh(110,78,150),  name:'动漫挚爱',       base:'SDXL', runs:312000, ver:'v5.0', tags:['二次元','高饱和'],      badge:'hot' },
    { c: mesh(20,42,8),     name:'胶片人像',       base:'Flux', runs:156000, ver:'v1.5', tags:['胶片','柔光'],          badge:null },
    { c: mesh(8,350,28),    name:'青绿山水 国风',  base:'SDXL', runs:41000,  ver:'v1',   tags:['国风','工笔'],          badge:'new' },
    { c: mesh(282,318,200), name:'液态金属质感',   base:'Flux', runs:67000,  ver:'v2.1', tags:['材质','3D'],            badge:null },
    { c: mesh(225,265,245), name:'极致质感人像',   base:'Flux', runs:134000, ver:'v3.1', tags:['人像','细节'],          badge:'hot' },
    { c: mesh(345,12,300),  name:'复古海报',       base:'Flux', runs:52000,  ver:'v1.3', tags:['复古','排版'],          badge:null }
  ];

  const MODEL_NAMES = ['Flux.1 Pro','SDXL Lightning','Seedance 2.0','可灵 Kling 1.6','Midjourney v6',
    'Animagine XL','Ideogram 2.0','墨韵 InkXL','Pony Diffusion','SDXL Turbo','Flux.1 Dev','即梦 3.0'];

  const CATEGORIES = ['全部','插画','动漫','摄影','3D','人像','科幻','国风','设计','视频'];

  /* capability bento — sizes: big | wide | (default) */
  const CAPS = [
    { t:'文生图', d:'一句话生成高清画面，GPT Image 2 细节拉满，画风随心定制。', ico:'✦', size:'big',  c:mesh(265,210,320) },
    { t:'文生视频', d:'Seedance 2.0 视听双绝，重塑 AI 视频标杆。', ico:'▣', size:'wide', c:mesh(190,250,210) },
    { t:'图生图', d:'参考图秒变新画风。', ico:'⧉', size:'',     c:mesh(150,110,180) },
    { t:'智能扩图', d:'Outpainting 无缝补全。', ico:'⤢', size:'',  c:mesh(28,48,8) },
    { t:'局部重绘', d:'圈选即改，精细编辑。', ico:'✎', size:'',   c:mesh(330,286,12) },
    { t:'一键抠图', d:'智能移除背景与对象。', ico:'⬡', size:'',   c:mesh(95,140,70) },
    { t:'高清放大', d:'4× 无损 Upscale。', ico:'⤡', size:'',     c:mesh(255,230,290) },
  ];

  const STEPS = [
    { ico:'✎', t:'描述你的想法', d:'用一句话写下脑海里的画面，或拖入一张参考图——无需任何专业术语。' },
    { ico:'✦', t:'挑模型，生成', d:'选择心仪的模型与比例，点击生成，数秒之内即得多张高质量结果。' },
    { ico:'⤴', t:'编辑与分享', d:'局部重绘、放大、抠图一步到位，导出成品或发布到作品广场。' },
  ];

  const CREATORS = [
    { name:'夜航 NightSail', tag:'科幻 · 概念场景', works:312, c:mesh(268,192,320) },
    { name:'KENJI',         tag:'动漫 · 人像',     works:489, c:mesh(300,260,18) },
    { name:'OceanLab',      tag:'视频 · 自然',     works:204, c:mesh(190,250,210) },
    { name:'砚 Yan',        tag:'国风 · 工笔',     works:176, c:mesh(8,350,28) },
    { name:'Mira',          tag:'人像 · 胶片',     works:351, c:mesh(20,42,8) },
    { name:'Studio 3F',     tag:'3D · 产品',       works:267, c:mesh(210,248,196) },
  ];

  const TESTIMONIALS = [
    { q:'以前一张商业插画要外包等一周，现在一个下午出了二十版方案，客户当场拍板。', name:'林深', role:'自由插画师', stars:5, c:mesh(268,200,320) },
    { q:'视频分镜直接用文生视频打草稿，团队沟通效率翻倍，省下大把试错时间。', name:'阿哲', role:'短视频导演', stars:5, c:mesh(190,250,210) },
    { q:'模型切换太丝滑了，一个入口把 Midjourney、Flux、可灵全用上，再也不用开十个网页。', name:'Coco', role:'电商视觉', stars:5, c:mesh(330,286,12) },
    { q:'国风工笔的还原度惊到我了，矿物色和金线质感都在，发小红书直接爆了。', name:'砚秋', role:'国风博主', stars:5, c:mesh(8,350,28) },
    { q:'作品广场就是灵感宝库，看到喜欢的点「生成同款」连参数都带过来，新手友好。', name:'小鹿', role:'设计学生', stars:4, c:mesh(150,110,180) },
    { q:'公司用企业版做营销物料，出图速度和一致性都达标，性价比远超买图库。', name:'David', role:'品牌市场', stars:5, c:mesh(255,230,290) },
  ];

  const FAQS = [
    { q:'SCARECROWAI 是什么？', a:'一站式 AI 创作平台。用一句话即可生成图片与视频，接入海量顶级模型，由你的中转站算力驱动，无需任何专业知识也能做出精彩作品。' },
    { q:'支持哪些模型？', a:'已接入 GPT Image 2、Nano Banana、Midjourney、Imagen、Seedance、可灵 Kling、Sora、Wan、即梦等主流图片与视频模型，并持续更新，新模型上线即可使用。' },
    { q:'生成一张图 / 一段视频要多久？', a:'图片通常数秒即可完成；视频依据时长与复杂度，一般需要数分钟。' },
    { q:'生成的内容可以商用吗？', a:'你对生成内容拥有使用权，可用于社交媒体、营销推广、产品演示等场景。具体以所选模型的授权条款为准。' },
    { q:'新用户有免费额度吗？', a:'有。注册即赠送体验积分，无需绑定信用卡即可开始创作，额度用完后可按需升级。' },
    { q:'如何生成「同款」？', a:'在作品广场或详情页点击「生成同款」，系统会自动把该作品的提示词与参数带入创作台，你可以直接生成或微调后再创作。' },
  ];

  const PLANS = [
    { name:'体验版', desc:'适合尝鲜与轻度创作', mo:0, yr:0, cta:'免费开始', feat:false,
      items:['每月 100 积分','基础图片模型','标准生成队列','社区作品广场','512² 标准分辨率'] },
    { name:'创作者 Pro', desc:'高频创作者的首选', mo:68, yr:39, cta:'升级 Pro', feat:true,
      items:['每月 3,000 积分','全部图片 + 视频模型','优先生成队列 · 不限速','高清放大 / 局部重绘','商用授权','4K 超高分辨率'] },
    { name:'企业版', desc:'团队协作与品牌量产', mo:268, yr:199, cta:'联系我们', feat:false,
      items:['无限积分（公平使用）','团队席位与协作空间','API 接入与工作流','专属客户成功经理','品牌风格私有模型','SLA 与发票支持'] },
  ];

  const CMP = [
    ['每月积分', '100', '3,000', '无限'],
    ['图片模型', '基础', '全部', '全部 + 私有'],
    ['视频模型', '—', '全部', '全部'],
    ['生成速度', '标准', '优先不限速', '最高优先'],
    ['最高分辨率', '512²', '4K', '4K'],
    ['商用授权', '—', '✓', '✓'],
    ['API 接入', '—', '—', '✓'],
    ['团队协作', '—', '—', '✓'],
  ];

  const CREATE_MODELS = ['GPT Image 2','Flux.1 Pro','Midjourney v6','Nano Banana 2','SDXL Lightning','即梦 3.0','Seedance 2.0','可灵 Kling 1.6'];

  const HERO_PROMPTS = [
    '液态金属机器人，纯白工作室布光，C4D 渲染',
    '青绿山水工笔，矿物颜料石青石绿，宋代院体',
    '赛博艺伎，全息面具，电路纹和服，超细节 8K',
    '深海发光水母，慢镜头，4K 微距，蓝紫光束',
    '黄昏侧颜人像，胶片颗粒，85mm f/1.4，柔光',
  ];

  window.HOME = { mesh, fmt, ARTWORKS, MODELS, MODEL_NAMES, CATEGORIES, CAPS, STEPS,
    CREATORS, TESTIMONIALS, FAQS, PLANS, CMP, CREATE_MODELS, HERO_PROMPTS };
})();
