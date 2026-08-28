// 生产导入 3 skill + AI 生成封面 + 回写封面（生产 & 测试）
const fs = require("fs"), path = require("path");
const PROD_TOKEN = process.env.PROD_TOKEN;
const TEST_TOKEN = process.env.TEST_TOKEN;
const LOCAL = "http://localhost:8080";
const TEST = "https://test-flowlight.tcmzhan.com";
const DIR = "D:/mbfczzzz/claude/canvas/skill";
const read = (n) => fs.readFileSync(path.join(DIR, n), "utf8");
const md = "text/markdown; charset=utf-8", txt = "text/plain; charset=utf-8";

const api = async (base, token, method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
};

function pkg(o){ return { title:o.title, description:o.description, category:o.category, authorName:"官方", status:1, sortOrder:o.sortOrder, kind:"agent", entryPoints:["canvas"], primaryOutputType:"text", outputTypes:o.outputTypes, inputSchema:{type:"object",properties:{}}, manifest:o.manifest, defaultParams:{}, bindings:[{surface:"canvas",targetType:"*",enabled:true,sortOrder:0,defaults:{}}], primaryFilePath:o.fileName, files:[{path:o.fileName,content:read(o.fileName),mimeType:o.mime}], publish:true }; }
const starter = (t)=>({kind:"agent",primaryOutputType:"text",outputTypes:t});
const daxi = { kind:"agent", primaryOutputType:"text", outputTypes:["text","image"], steps:[
 {key:"outline",title:"剧情简介与16格文字大纲",type:"text",handler:"skill_text_completion",prompt:"执行阶段一：基于用户输入与参考素材，锁定角色、服装、武器、能力与场景，输出 2-4 句剧情简介和 16 格文字镜头大纲（每格含建议时长、景别/机位、可见人物、画面动作、衔接作用）。本阶段只输出文字，不生成图像。",outputRole:"draft",registerWork:false},
 {key:"confirm_outline",title:"确认文字大纲",type:"approval",promotePrevious:true,message:"确认这版剧情与 16 格文字大纲后生成分镜图；需要调整请在下方写修改意见。"},
 {key:"storyboard",title:"生成 4×4 黑白分镜图",type:"generate",handler:"text_to_image",prompt:"严格按已确认的 16 格文字镜头大纲生成一张 4×4 黑白分镜图，逐格对应景别、机位、人物显隐与动作。已确认大纲：{{previous}}",outputType:"image",outputRole:"draft",registerWork:false},
 {key:"confirm_storyboard",title:"确认分镜图",type:"approval",promotePrevious:true,message:"确认分镜图后生成 16 条视频提示词；需要返修请在下方写修改意见。"},
 {key:"video_prompts",title:"生成 16 条视频提示词",type:"text",handler:"skill_text_completion",prompt:"执行阶段三：逐格读取已确认的分镜图与大纲，生成图片职责声明、统一视觉前缀、16 条视频提示词，并做连续性检查。",outputRole:"final",registerWork:true}
]};

const SKILLS = [
 { pkg: pkg({title:"全能动作导演 Pro · 番剧高燃（单图版）",description:"单图/纯文字反推角色，产出 15 秒日式番剧作画感高燃打斗连续篇章视频提示词：疯切分镜、瞬移跳位、速度线残影、敌人三阶递进。",category:"动漫游戏",sortOrder:0,outputTypes:["text"],manifest:starter(["text"]),fileName:"打戏单图版（建议25S-28S）.txt",mime:txt}),
   cover: "Anime sakuga action scene: Japanese TV anime style fight moment, a warrior dashing with motion blur and speed lines, energy aura bursting with glowing particles, dramatic low-angle composition, cel-shaded, vibrant, cinematic, no text, no watermark" },
 { pkg: pkg({title:"打戏分镜导演（多图版 · 16格）",description:"多张角色/场景参考图 + 简单剧情，先出 16 格文字大纲（确认后）生成 4×4 黑白分镜图（再确认后）逐格产出 16 条视频提示词。两道人工确认闸口。",category:"动漫游戏",sortOrder:1,outputTypes:["text","image"],manifest:daxi,fileName:"打戏多图版（25-28S）最好简单描述下剧情.md",mime:md}),
   cover: "Black and white manga storyboard: 4x4 grid of 16 ink-sketch panels showing an action fight sequence, dynamic camera angles, speed lines, cinematic panel composition, monochrome ink style, no text, no watermark" },
 { pkg: pkg({title:"文戏情绪导演（30S · 多角色分镜）",description:"30 秒单/双/三人文戏情绪表演分镜：50 情绪矩阵 + 肌肉动作到视觉结果，主角 4-5 状态情绪弧线，输出约 16-20 个有叙事作用的编号镜头与完整台词。",category:"短剧漫剧",sortOrder:2,outputTypes:["text"],manifest:starter(["text"]),fileName:"文戏30S（情绪版）最好简单描述下剧情.md",mime:md}),
   cover: "Cinematic emotional drama film still: two characters facing each other in soft rim light, subtle intense expressions, shallow depth of field, warm muted tones, atmospheric, photorealistic, no text, no watermark" },
];

const poll = async (id) => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await api(LOCAL, PROD_TOKEN, "GET", `/api/ai/tasks/${id}`);
    const t = r?.data;
    if (t?.status === 1) return t;
    if (t?.status === 2 || t?.status === 3) throw new Error(`task ${id} failed: ${t.errorMsg}`);
    process.stdout.write(".");
  }
  throw new Error(`task ${id} timeout`);
};

(async () => {
  // 1) 导入到生产
  const imp = await api(LOCAL, PROD_TOKEN, "POST", "/api/admin/skills/import", { skills: SKILLS.map((s) => s.pkg) });
  if (!imp?.success) { console.log("IMPORT FAILED", JSON.stringify(imp).slice(0, 400)); process.exit(1); }
  const prodIds = imp.data.map((v) => v.skillId);
  console.log("imported to prod:", prodIds.join(", "));

  // 2) 生成封面（生产 AI）
  for (let i = 0; i < SKILLS.length; i++) {
    const g = await api(LOCAL, PROD_TOKEN, "POST", "/api/ai/generate", {
      handler: "text_to_image",
      modelId: "gpt-image-2",
      input: { prompt: SKILLS[i].cover, aspectRatio: "16:9" },
    });
    if (!g?.success) { console.log(`GEN ${i} FAILED`, JSON.stringify(g).slice(0, 300)); continue; }
    process.stdout.write(`gen ${i} task ${g.data.id} `);
    const t = await poll(g.data.id);
    const url = t.resultUrl || t.resultMeta?.url;
    console.log(` -> ${url}`);
    SKILLS[i].coverUrl = url;
  }

  // 3) 回写封面：生产（update 端点）+ 测试（同 URL）
  for (let i = 0; i < SKILLS.length; i++) {
    if (!SKILLS[i].coverUrl) continue;
    const cur = await api(LOCAL, PROD_TOKEN, "GET", `/api/admin/skills/${prodIds[i]}`);
    const dto = { ...cur.data, coverUrl: SKILLS[i].coverUrl };
    const up = await api(LOCAL, PROD_TOKEN, "PUT", `/api/admin/skills/${prodIds[i]}`, dto);
    console.log(`prod cover ${i}:`, up?.success ? "ok" : JSON.stringify(up).slice(0, 200));
  }
  // 测试环境：按标题找到 id 再更新
  const tl = await api(TEST, TEST_TOKEN, "GET", "/api/admin/skills?pageSize=20");
  const byTitle = Object.fromEntries((tl?.data?.records || []).map((r) => [r.title, r]));
  for (const s of SKILLS) {
    if (!s.coverUrl) continue;
    const row = byTitle[s.pkg.title];
    if (!row) continue;
    const cur = await api(TEST, TEST_TOKEN, "GET", `/api/admin/skills/${row.id}`);
    const up = await api(TEST, TEST_TOKEN, "PUT", `/api/admin/skills/${row.id}`, { ...cur.data, coverUrl: s.coverUrl });
    console.log(`test cover [${s.pkg.title}]:`, up?.success ? "ok" : JSON.stringify(up).slice(0, 200));
  }
  console.log("DONE");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
