/* SCARECROWAI — mock data, i18n, generative cover art ----------------------*/

// Rich mesh-gradient covers. These STAND IN for real AI artwork — drop real
// images in by replacing `cover` with a url. Each is a deterministic tri-tone mesh.
// Hues are graded into ONE cohesive cool band (cyan→blue→indigo→violet→magenta)
// so the whole gallery reads curated & premium instead of rainbow "AI slop".
function mesh(h1, h2, h3) {
  const map = (h) => 198 + (((h % 360) + 360) % 360) / 360 * 120; // 198..318
  const a = map(h1), b = map(h2), c = map(h3);
  return [
    `radial-gradient(120% 130% at 16% 8%, hsl(${a} 68% 60%) 0%, transparent 52%)`,
    `radial-gradient(120% 120% at 88% 18%, hsl(${b} 60% 54%) 0%, transparent 50%)`,
    `radial-gradient(140% 140% at 50% 108%, hsl(${c} 56% 44%) 0%, transparent 58%)`,
    `linear-gradient(155deg, hsl(${a} 46% 15%) 0%, hsl(${b} 52% 8%) 100%)`,
  ].join(', ');
}

const I18N = {
  cn: {
    'nav.explore': '作品广场', 'nav.market': '模型市场', 'nav.create': '开始创作', 'nav.home': '主页',
    'nav.search': '搜索作品、模型、创作者…', 'nav.login': '登录',
    'sort.hot': '最热', 'sort.new': '最新', 'sort.top': '本周精选',
    'cat.all': '全部', 'cat.illus': '插画', 'cat.anime': '动漫', 'cat.photo': '摄影',
    'cat.3d': '3D', 'cat.design': '设计', 'cat.portrait': '人像', 'cat.scifi': '科幻',
    'cat.guofeng': '国风', 'cat.video': '视频',
    'tab.image': '图片', 'tab.video': '视频',
    'feed.same': '生成同款', 'feed.by': '作者', 'feed.runs': '次生成',
    'market.all': '全部', 'market.ckpt': '大模型', 'market.lora': 'LoRA', 'market.flow': '工作流',
    'market.base': '基础模型', 'market.sort.dl': '下载最多', 'market.sort.like': '点赞最多', 'market.sort.new': '最新发布',
    'market.use': '立即生成', 'market.runs': '运行', 'market.ver': '版本',
    'badge.hot': '热门', 'badge.new': '新', 'badge.video': '视频',
    'detail.prompt': '提示词', 'detail.neg': '反向提示词', 'detail.model': '模型', 'detail.params': '参数',
    'detail.copy': '复制', 'detail.copied': '已复制', 'detail.same': '生成同款', 'detail.download': '下载',
    'detail.follow': '关注', 'detail.related': '相关作品', 'detail.seed': '种子',
    'detail.steps': '步数', 'detail.sampler': '采样器', 'detail.size': '尺寸', 'detail.cfg': 'CFG',
    'create.title': '创作', 'create.t2i': '文生图', 'create.i2i': '图生图', 'create.t2v': '文生视频',
    'create.ph': '描述你想要的画面，越具体越好…', 'create.model': '选择模型', 'create.ratio': '比例',
    'create.count': '数量', 'create.go': '生成', 'create.cost': '消耗', 'create.credits': '积分',
    'create.ref': '拖入参考图', 'create.hint': '这是高保真原型 — 点击「生成」可预览流程',
    'sw.theme': '主题', 'sw.lang': '语言', 'sw.style': '风格',
    'style.neon': '霓虹夜', 'style.candy': '糖果波普', 'style.mono': '极简墨',
    'foot.tip': '高保真交互原型 · 占位封面为生成式渐变，可替换为真实作品',
    'hero.tagline': '人人都是 AI 艺术家',
    'hero.sub': '一句话生成图片与视频 · 海量模型一键调用 · 在作品广场获取灵感',
  },
  en: {
    'nav.explore': 'Explore', 'nav.market': 'Models', 'nav.create': 'Create', 'nav.home': 'Home',
    'nav.search': 'Search art, models, creators…', 'nav.login': 'Sign in',
    'sort.hot': 'Hot', 'sort.new': 'Latest', 'sort.top': 'Top this week',
    'cat.all': 'All', 'cat.illus': 'Illustration', 'cat.anime': 'Anime', 'cat.photo': 'Photo',
    'cat.3d': '3D', 'cat.design': 'Design', 'cat.portrait': 'Portrait', 'cat.scifi': 'Sci-Fi',
    'cat.guofeng': 'Guofeng', 'cat.video': 'Video',
    'tab.image': 'Images', 'tab.video': 'Video',
    'feed.same': 'Remix', 'feed.by': 'by', 'feed.runs': 'runs',
    'market.all': 'All', 'market.ckpt': 'Checkpoints', 'market.lora': 'LoRA', 'market.flow': 'Workflows',
    'market.base': 'Base model', 'market.sort.dl': 'Most used', 'market.sort.like': 'Most liked', 'market.sort.new': 'Newest',
    'market.use': 'Generate', 'market.runs': 'runs', 'market.ver': 'ver',
    'badge.hot': 'HOT', 'badge.new': 'NEW', 'badge.video': 'VIDEO',
    'detail.prompt': 'Prompt', 'detail.neg': 'Negative prompt', 'detail.model': 'Model', 'detail.params': 'Parameters',
    'detail.copy': 'Copy', 'detail.copied': 'Copied', 'detail.same': 'Remix', 'detail.download': 'Download',
    'detail.follow': 'Follow', 'detail.related': 'Related', 'detail.seed': 'Seed',
    'detail.steps': 'Steps', 'detail.sampler': 'Sampler', 'detail.size': 'Size', 'detail.cfg': 'CFG',
    'create.title': 'Create', 'create.t2i': 'Text→Image', 'create.i2i': 'Image→Image', 'create.t2v': 'Text→Video',
    'create.ph': 'Describe the image you want — the more detail the better…', 'create.model': 'Model', 'create.ratio': 'Ratio',
    'create.count': 'Count', 'create.go': 'Generate', 'create.cost': 'Cost', 'create.credits': 'credits',
    'create.ref': 'Drop a reference image', 'create.hint': 'Hi-fi prototype — hit Generate to preview the flow',
    'sw.theme': 'Theme', 'sw.lang': 'Language', 'sw.style': 'Style',
    'style.neon': 'Neon Night', 'style.candy': 'Candy Pop', 'style.mono': 'Mono Ink',
    'foot.tip': 'Hi-fi interactive prototype · placeholder covers are generative gradients — swap in real work',
    'hero.tagline': 'Everyone is an AI artist',
    'hero.sub': 'Text-to-image & video · one-click access to every model · find inspiration in Explore',
  },
};
function tr(lang, k) { return (I18N[lang] && I18N[lang][k]) || (I18N.cn[k]) || k; }

const CATEGORIES = ['all', 'illus', 'anime', 'photo', '3d', 'design', 'portrait', 'scifi', 'guofeng', 'video'];

// Artwork feed. h = relative tile height (drives masonry rhythm). type image|video.
// steps/sampler/cfgScale/size/negPrompt reflect realistic Stable Diffusion / Flux generation params.
const ARTWORKS = [
  {
    id: 'a1', c: mesh(268, 192, 320), h: 1.34, type: 'image', cat: 'scifi',
    model: 'Flux.1 Pro', titleCn: '霓虹废土行者', titleEn: 'Neon Wastes Walker',
    author: '夜航 NightSail', likes: 4820,
    prompt: 'a lone wanderer in a neon-drenched ruined city, volumetric fog, cinematic lighting, extremely detailed environment, 8k uhd, sharp focus, award-winning photography',
    negPrompt: 'blurry, oversaturated, watermark, multiple people, text, low resolution, jpeg artifacts, crowd',
    steps: 28, sampler: 'DPM++ 2M Karras', cfgScale: 7.5, size: '1024×1536',
  },
  {
    id: 'a2', c: mesh(20, 42, 8), h: 0.78, type: 'image', cat: 'portrait',
    model: 'SDXL Lightning', titleCn: '黄昏侧颜', titleEn: 'Dusk Profile',
    author: 'Mira', likes: 2310,
    prompt: 'cinematic portrait of a woman, golden hour rim light, film grain, 85mm f/1.4, shallow depth of field, skin texture, analog film look, Kodak Portra 400',
    negPrompt: 'harsh shadows, overexposed, ugly, distorted face, extra limbs, makeup, digital, plastic skin',
    steps: 35, sampler: 'Euler a', cfgScale: 8.0, size: '896×1152',
  },
  {
    id: 'a3', c: mesh(190, 250, 210), h: 1.0, type: 'video', cat: 'video',
    model: 'Seedance 2.0', titleCn: '深海水母', titleEn: 'Abyssal Jellyfish',
    author: 'OceanLab', likes: 8930,
    prompt: 'bioluminescent jellyfish drifting in deep ocean, slow motion, hyperreal, 4K macro cinematography, blue-violet light rays, absolute silence atmosphere',
    negPrompt: 'fast motion, abrupt cuts, noise, artifacts, text on screen, human, surface',
    steps: 40, sampler: 'DDIM', cfgScale: 7.0, size: '1920×1080',
  },
  {
    id: 'a4', c: mesh(330, 286, 350), h: 1.5, type: 'image', cat: 'anime',
    model: 'Animagine XL', titleCn: '雨夜便利店', titleEn: 'Rainy Konbini',
    author: '青柠 Lime', likes: 6140,
    prompt: 'anime girl standing under convenience store light, rainy night, reflections on wet pavement, lofi mood, soft pastel neon glow, Studio Ghibli atmosphere, masterpiece',
    negPrompt: 'realistic, 3d, ugly hands, extra fingers, bad anatomy, lowres, watermark, signature',
    steps: 30, sampler: 'DPM++ SDE Karras', cfgScale: 8.5, size: '832×1216',
  },
  {
    id: 'a5', c: mesh(150, 110, 180), h: 0.72, type: 'image', cat: 'illus',
    model: 'Flux.1 Dev', titleCn: '苔原小屋', titleEn: 'Tundra Cabin',
    author: 'Forrest', likes: 1890,
    prompt: 'cozy isometric cabin nestled in misty tundra, soft illustration style, muted pastel palette, warm window glow against cold fog, storybook feel',
    negPrompt: 'dark, gloomy, realistic, photorealistic, harsh shadows, people, busy background',
    steps: 24, sampler: 'Euler a', cfgScale: 7.0, size: '1024×1024',
  },
  {
    id: 'a6', c: mesh(300, 260, 18), h: 1.18, type: 'image', cat: 'portrait',
    model: 'Midjourney v6', titleCn: '赛博艺伎', titleEn: 'Cyber Geisha',
    author: 'KENJI', likes: 12400,
    prompt: 'cyberpunk geisha, ornate holographic mask, iridescent kimono with circuit patterns, dramatic studio lighting, hyperdetailed, 8K, ultra sharp, WLOP style',
    negPrompt: 'blurry, low quality, watermark, deformed face, bad anatomy, extra limbs, oversaturated, low detail',
    steps: 40, sampler: 'DPM++ 2M Karras', cfgScale: 9.0, size: '1024×1536',
  },
  {
    id: 'a7', c: mesh(95, 140, 70), h: 0.92, type: 'video', cat: 'video',
    model: '可灵 Kling 1.6', titleCn: '风穿麦田', titleEn: 'Wind Through Wheat',
    author: '稻田 Paddy', likes: 3360,
    prompt: 'golden wheat field at sunset, strong wind sweeping through in slow motion, drone aerial shot, warm light, cinematic color grade, 4K',
    negPrompt: 'shaky camera, night scene, dark, rain, overexposed, people in frame, buildings',
    steps: 35, sampler: 'DDIM', cfgScale: 7.5, size: '1920×1080',
  },
  {
    id: 'a8', c: mesh(210, 248, 196), h: 1.28, type: 'image', cat: '3d',
    model: 'Flux.1 Pro', titleCn: '果冻机器人', titleEn: 'Jelly Bot',
    author: 'Studio 3F', likes: 5210,
    prompt: 'cute translucent jelly robot, pastel studio background, soft key light, Octane render, subsurface scattering, 3d character design, kawaii, product shot',
    negPrompt: 'dark, scary, sharp edges, metallic, photorealistic, text, dirty, broken',
    steps: 32, sampler: 'DPM++ 2M Karras', cfgScale: 7.5, size: '1024×1024',
  },
  {
    id: 'a9', c: mesh(8, 350, 28), h: 0.84, type: 'image', cat: 'guofeng',
    model: '墨韵 InkXL', titleCn: '青绿山水', titleEn: 'Verdant Mountains',
    author: '砚 Yan', likes: 7720,
    prompt: '中国传统工笔青绿山水，矿物质颜料质感，石青石绿设色，金线勾勒，白云缭绕，宣纸肌理，宋代院体画风',
    negPrompt: 'western art style, oil paint, photorealistic, modern elements, dark background, digital painting',
    steps: 36, sampler: 'Euler a', cfgScale: 8.0, size: '1344×768',
  },
  {
    id: 'a10', c: mesh(255, 230, 290), h: 1.12, type: 'image', cat: 'scifi',
    model: 'SDXL Turbo', titleCn: '轨道城市', titleEn: 'Orbital City',
    author: 'Vega', likes: 4480,
    prompt: 'megastructure orbital ring city surrounding Earth, hard science fiction, extreme detail, blue atmosphere below, solar panels, docking bays, inspired by Ian Banks Culture novels',
    negPrompt: 'clouds blocking view, people, lens flare, blurry, cartoonish, fantasy, magic',
    steps: 30, sampler: 'DPM++ 2M SDE', cfgScale: 8.5, size: '1344×768',
  },
  {
    id: 'a11', c: mesh(38, 16, 52), h: 0.7, type: 'image', cat: 'photo',
    model: 'Flux.1 Dev', titleCn: '沙丘正午', titleEn: 'Dune Noon',
    author: 'Atlas', likes: 2050,
    prompt: 'minimal desert sand dunes, harsh noon light casting sharp shadow ridge lines, fine art photography, negative space, monochromatic tan, Sebastião Salgado style',
    negPrompt: 'people, animals, vegetation, overcast sky, colorful objects, oversaturated, structures',
    steps: 25, sampler: 'Euler a', cfgScale: 7.0, size: '1344×768',
  },
  {
    id: 'a12', c: mesh(282, 318, 200), h: 1.4, type: 'video', cat: 'video',
    model: 'Seedance 2.0', titleCn: '液态金属', titleEn: 'Liquid Chrome',
    author: 'FLUXLAB', likes: 9610,
    prompt: 'morphing liquid chrome blob on infinite white studio floor, perfect reflections, seamless loop, 4K, photorealistic, slow motion close-up',
    negPrompt: 'rough surface, matte material, dark, colored tint, organic imperfections, fingerprints',
    steps: 40, sampler: 'DDIM', cfgScale: 7.0, size: '1920×1080',
  },
  {
    id: 'a13', c: mesh(168, 200, 140), h: 0.95, type: 'image', cat: 'illus',
    model: 'Animagine XL', titleCn: '森灵', titleEn: 'Forest Spirit',
    author: '青柠 Lime', likes: 3990,
    prompt: 'tiny luminous forest spirit perched on a mossy branch, soft volumetric god-rays, Ghibli-esque illustration, watercolor wash, muted greens and gold',
    negPrompt: 'dark, scary, photorealistic, adult, harsh lighting, crowded, modern objects',
    steps: 28, sampler: 'DPM++ SDE Karras', cfgScale: 7.5, size: '832×1216',
  },
  {
    id: 'a14', c: mesh(345, 12, 300), h: 1.22, type: 'image', cat: 'design',
    model: 'Ideogram 2.0', titleCn: '复古唱片封面', titleEn: 'Retro Sleeve',
    author: 'PRESS PLAY', likes: 1670,
    prompt: 'retro vinyl record album cover art, bold geometric typography, risograph texture, warm 70s color palette — mustard yellow, burnt orange, deep teal, halftone dots',
    negPrompt: 'modern flat design, 3d render, photography, cluttered, overly complex, dark, cold palette',
    steps: 20, sampler: 'Euler a', cfgScale: 6.5, size: '1024×1024',
  },
  {
    id: 'a15', c: mesh(225, 265, 245), h: 0.88, type: 'image', cat: 'portrait',
    model: 'Midjourney v6', titleCn: '冰晶女王', titleEn: 'Frost Queen',
    author: 'Mira', likes: 8120,
    prompt: 'ethereal ice queen, crystalline crown with embedded snowflakes, frozen breath in cold air, dramatic blue-white rim lighting, ultra-detailed fabric and ice textures',
    negPrompt: 'warm colors, summer setting, greenery, casual clothing, smiling, blurry, painterly',
    steps: 38, sampler: 'DPM++ 2M Karras', cfgScale: 8.5, size: '896×1152',
  },
  {
    id: 'a16', c: mesh(110, 78, 150), h: 1.3, type: 'image', cat: 'anime',
    model: 'Pony Diffusion', titleCn: '机甲少女', titleEn: 'Mecha Pilot',
    author: 'KENJI', likes: 10500,
    prompt: 'anime girl mecha pilot in sleek cockpit, dynamic low-angle shot, HUD display reflections on visor, detailed lineart, cel shaded, vibrant colors, score_9',
    negPrompt: 'realistic, photorealistic, 3d rendering, bad anatomy, extra limbs, blurry, ugly, duplicate',
    steps: 35, sampler: 'DPM++ SDE Karras', cfgScale: 8.0, size: '832×1216',
  },
  {
    id: 'a17', c: mesh(30, 60, 20), h: 0.76, type: 'video', cat: 'video',
    model: '可灵 Kling 1.6', titleCn: '熔岩流动', titleEn: 'Lava Flow',
    author: 'OceanLab', likes: 2890,
    prompt: 'extreme close-up of molten lava flowing over black basalt, glowing orange cracks, steam rising, macro lens, slow motion 240fps, 4K',
    negPrompt: 'wide landscape shot, people, cold tones, night sky, water, plants',
    steps: 35, sampler: 'DDIM', cfgScale: 7.5, size: '1920×1080',
  },
  {
    id: 'a18', c: mesh(195, 175, 230), h: 1.05, type: 'image', cat: '3d',
    model: 'Flux.1 Pro', titleCn: '微缩盆栽星球', titleEn: 'Pocket Planet',
    author: 'Studio 3F', likes: 4310,
    prompt: 'miniature planet inside a glass terrarium dome, tiny forests and mountains, soft studio lighting, bokeh background, product photography, 3D render, Octane',
    negPrompt: 'dark background, flat lighting, 2d illustration, cartoon, oversaturated, people, text',
    steps: 30, sampler: 'DPM++ 2M Karras', cfgScale: 7.5, size: '1024×1024',
  },
];

// Model marketplace. type ckpt|lora|flow. base = base model family.
const MODELS = [
  { id: 'm1',  type: 'ckpt', c: mesh(268, 200, 320), nameCn: '麦田写实 XL',   nameEn: 'Wheat Realism XL',  base: 'SDXL',  author: '稻田 Paddy',  runs: 182000, likes: 9200, ver: 'v3.0', tags: ['写实', '人像', '电影感'],     badge: 'hot' },
  { id: 'm2',  type: 'lora', c: mesh(330, 286, 12),  nameCn: '霓虹故障风',     nameEn: 'Neon Glitch',       base: 'Flux', author: 'FLUXLAB',     runs: 94000,  likes: 6100, ver: 'v2',   tags: ['故障', '霓虹', '风格'],       badge: 'hot' },
  { id: 'm3',  type: 'ckpt', c: mesh(20, 42, 8),     nameCn: '胶片人像',       nameEn: 'Film Portrait',     base: 'Flux', author: 'Mira',        runs: 156000, likes: 8800, ver: 'v1.5', tags: ['胶片', '人像', '柔光'],       badge: null },
  { id: 'm4',  type: 'lora', c: mesh(8, 350, 28),    nameCn: '青绿山水 国风',  nameEn: 'Ink Mountains',     base: 'SDXL', author: '砚 Yan',       runs: 41000,  likes: 5400, ver: 'v1',   tags: ['国风', '山水', '工笔'],       badge: 'new' },
  { id: 'm5',  type: 'flow', c: mesh(190, 250, 210), nameCn: '一键写真工作流', nameEn: 'Portrait Workflow', base: 'ComfyUI', author: 'Studio 3F', runs: 28000, likes: 3900, ver: 'v4', tags: ['工作流', '换脸', '高清修复'], badge: null },
  { id: 'm6',  type: 'ckpt', c: mesh(110, 78, 150),  nameCn: '动漫挚爱',       nameEn: 'Anime Beloved',     base: 'SDXL', author: 'KENJI',       runs: 312000, likes: 15600, ver: 'v5.0', tags: ['动漫', '二次元', '高饱和'],  badge: 'hot' },
  { id: 'm7',  type: 'lora', c: mesh(282, 318, 200), nameCn: '液态金属质感',   nameEn: 'Liquid Chrome',     base: 'Flux', author: 'FLUXLAB',     runs: 67000,  likes: 4700, ver: 'v2.1', tags: ['材质', '金属', '3D'],         badge: null },
  { id: 'm8',  type: 'flow', c: mesh(95, 140, 70),   nameCn: '视频运镜工作流', nameEn: 'Cinematic Motion',  base: 'Kling', author: 'OceanLab',   runs: 19000,  likes: 2600, ver: 'v2', tags: ['视频', '运镜', '电影'],       badge: 'new' },
  { id: 'm9',  type: 'ckpt', c: mesh(195, 175, 230), nameCn: '梦幻 3D 渲染',   nameEn: 'Dreamy 3D',         base: 'SDXL', author: 'Studio 3F',   runs: 88000,  likes: 5900, ver: 'v2.2', tags: ['3D', '渲染', '可爱'],         badge: null },
  { id: 'm10', type: 'lora', c: mesh(345, 12, 300),  nameCn: '复古海报',       nameEn: 'Retro Poster',      base: 'Flux', author: 'PRESS PLAY',  runs: 52000,  likes: 4100, ver: 'v1.3', tags: ['复古', '排版', '海报'],       badge: null },
  { id: 'm11', type: 'ckpt', c: mesh(225, 265, 245), nameCn: '极致质感人像',   nameEn: 'Skin Detail Pro',   base: 'Flux', author: 'Mira',        runs: 134000, likes: 7300, ver: 'v3.1', tags: ['人像', '皮肤', '细节'],       badge: 'hot' },
  { id: 'm12', type: 'flow', c: mesh(150, 110, 180), nameCn: '产品图工作流',   nameEn: 'Product Shot Flow', base: 'ComfyUI', author: 'Vega',     runs: 23000,  likes: 3100, ver: 'v3', tags: ['电商', '产品', '布光'],       badge: null },
];

const BASE_FILTERS = ['SDXL', 'Flux', 'Kling', 'ComfyUI'];

function fmt(n) {
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return '' + n;
}

Object.assign(window, { I18N, tr, CATEGORIES, ARTWORKS, MODELS, BASE_FILTERS, mesh, fmt });
