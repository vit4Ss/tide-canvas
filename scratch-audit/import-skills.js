// 导入 3 个 skill 到测试库（走后台 /api/admin/skills/import，与导入弹窗同逻辑）
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.ADMIN_TOKEN;
const API = "http://localhost:8080/api/admin/skills/import";
const DIR = "D:/mbfczzzz/claude/canvas/skill";

const read = (name) => fs.readFileSync(path.join(DIR, name), "utf8");

const md = "text/markdown; charset=utf-8";
const txt = "text/plain; charset=utf-8";

function pkg({ title, description, category, sortOrder, outputTypes, manifest, fileName, mime }) {
  return {
    title,
    description,
    category,
    authorName: "官方",
    status: 1, // 直接上架（用户要求立即可用）
    sortOrder,
    kind: "agent",
    entryPoints: ["canvas"], // agent 被约束为仅画布入口
    primaryOutputType: "text",
    outputTypes,
    inputSchema: { type: "object", properties: {} },
    manifest,
    defaultParams: {},
    bindings: [{ surface: "canvas", targetType: "*", enabled: true, sortOrder: 0, defaults: {} }],
    primaryFilePath: fileName,
    files: [{ path: fileName, content: read(fileName), mimeType: mime }],
    publish: true,
  };
}

const starterManifest = (outputTypes) => ({ kind: "agent", primaryOutputType: "text", outputTypes });

// 打戏多图版：三阶段 + 两道 approval 闸口（校验：approval 无 handler/outputRole/registerWork；
// generate 必须 outputType 且在 outputTypes 内；agent 必须有 final 且含 primaryOutputType）
const daxiManifest = {
  kind: "agent",
  primaryOutputType: "text",
  outputTypes: ["text", "image"],
  steps: [
    {
      key: "outline",
      title: "剧情简介与16格文字大纲",
      type: "text",
      handler: "skill_text_completion",
      prompt: "执行阶段一：基于用户输入与参考素材，锁定角色、服装、武器、能力与场景，输出 2-4 句剧情简介和 16 格文字镜头大纲（每格含建议时长、景别/机位、可见人物、画面动作、衔接作用）。本阶段只输出文字，不生成图像。",
      outputRole: "draft",
      registerWork: false,
    },
    {
      key: "confirm_outline",
      title: "确认文字大纲",
      type: "approval",
      promotePrevious: true,
      message: "确认这版剧情与 16 格文字大纲后生成分镜图；需要调整请在下方写修改意见。",
    },
    {
      key: "storyboard",
      title: "生成 4×4 黑白分镜图",
      type: "generate",
      handler: "text_to_image",
      prompt: "严格按已确认的 16 格文字镜头大纲生成一张 4×4 黑白分镜图，逐格对应景别、机位、人物显隐与动作。已确认大纲：{{previous}}",
      outputType: "image",
      outputRole: "draft",
      registerWork: false,
    },
    {
      key: "confirm_storyboard",
      title: "确认分镜图",
      type: "approval",
      promotePrevious: true,
      message: "确认分镜图后生成 16 条视频提示词；需要返修请在下方写修改意见。",
    },
    {
      key: "video_prompts",
      title: "生成 16 条视频提示词",
      type: "text",
      handler: "skill_text_completion",
      prompt: "执行阶段三：逐格读取已确认的分镜图与大纲，生成图片职责声明、统一视觉前缀、16 条视频提示词，并做连续性检查。",
      outputRole: "final",
      registerWork: true,
    },
  ],
};

const skills = [
  pkg({
    title: "全能动作导演 Pro · 番剧高燃（单图版）",
    description: "单图/纯文字反推角色，产出 15 秒日式番剧作画感高燃打斗连续篇章视频提示词：疯切分镜、瞬移跳位、速度线残影、敌人三阶递进。",
    category: "动漫游戏",
    sortOrder: 0,
    outputTypes: ["text"],
    manifest: starterManifest(["text"]),
    fileName: "打戏单图版（建议25S-28S）.txt",
    mime: txt,
  }),
  pkg({
    title: "打戏分镜导演（多图版 · 16格）",
    description: "多张角色/场景参考图 + 简单剧情，先出 16 格文字大纲（确认后）生成 4×4 黑白分镜图（再确认后）逐格产出 16 条视频提示词。两道人工确认闸口。",
    category: "动漫游戏",
    sortOrder: 1,
    outputTypes: ["text", "image"],
    manifest: daxiManifest,
    fileName: "打戏多图版（25-28S）最好简单描述下剧情.md",
    mime: md,
  }),
  pkg({
    title: "文戏情绪导演（30S · 多角色分镜）",
    description: "30 秒单/双/三人文戏情绪表演分镜：50 情绪矩阵 + 肌肉动作到视觉结果，主角 4-5 状态情绪弧线，输出约 16-20 个有叙事作用的编号镜头与完整台词。",
    category: "短剧漫剧",
    sortOrder: 2,
    outputTypes: ["text"],
    manifest: starterManifest(["text"]),
    fileName: "文戏30S（情绪版）最好简单描述下剧情.md",
    mime: md,
  }),
];

(async () => {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ skills }),
  });
  const body = await res.json().catch(() => null);
  console.log("HTTP", res.status);
  console.log(JSON.stringify(body, null, 1).slice(0, 3000));
})();
