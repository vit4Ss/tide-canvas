export interface CanvasConnectionEndpoint {
  type: string;
}

export interface CanvasConnectionRule {
  allowed: boolean;
  reason?: string;
}

/** 拒绝文案里的节点中文名；未登记的类型回退显示原始 type。 */
const NODE_LABEL: Record<string, string> = {
  image: "图片",
  character: "角色",
  scene: "场景",
  scene_3d: "3D场景",
  video: "视频",
  audio: "音频",
  text: "文本",
  "3d": "3D",
  script: "脚本",
  video_breakdown: "逐帧拉片",
  video_compose: "片段合成",
  style_reference: "风格引用",
};

const IMAGE_FAMILY = ["image", "character", "scene"] as const;

/**
 * 每类目标节点「实际会消费」的入边类型——逐项对照各节点组件的读取逻辑登记，
 * 连不上的组合从连线层就拒绝，不再出现「连上了却被静默忽略」的死连线：
 *
 *  - 图片族（image/character/scene 同一组件）：入边图片族与导演台截图（scene_3d）
 *    进 imageList，文本进 prompt，风格引用切换风格。视频/音频不参与图片生成
 *    （2026-08 用户定稿：从连线层禁止；存量画布里已有的旧视频入边仍被提交逻辑兼容）。
 *  - video：图片族 + scene_3d、视频/音频（全能参考）、文本。风格引用只有图片族消费。
 *  - 3d：读入边 imageSrc 作图生 3D 参考——图片族与导演台。
 *  - scene_3d：入边图片/场景作全景与背景（组件明确排除角色节点与视频），入边 3d
 *    节点提供白模 GLB / Marble SPZ。
 *  - video_breakdown：仅视频（拉片来源）。
 *  - audio / text / script / video_compose / style_reference：组件不读取任何入边
 *    （script 的剧本存在 node.prompt 里，目前也没有任何下游消费它——若要让脚本
 *    像文本节点一样喂给视频/图片，先给消费端加读取逻辑再来这里放行）。
 *
 * 不在表里的目标类型不设限——新节点类型先放行，接入入边消费逻辑时再来登记。
 * 该规则只拦截手动拉线与快捷添加；程序化 addConnection（截帧、全景、衍生节点等
 * 自动布线）是各功能自己校验过的，不经过这里。
 */
const ACCEPTED_INCOMING: Record<string, ReadonlySet<string>> = {
  image: new Set([...IMAGE_FAMILY, "scene_3d", "text", "style_reference"]),
  character: new Set([...IMAGE_FAMILY, "scene_3d", "text", "style_reference"]),
  scene: new Set([...IMAGE_FAMILY, "scene_3d", "text", "style_reference"]),
  video: new Set([...IMAGE_FAMILY, "scene_3d", "video", "audio", "text"]),
  "3d": new Set([...IMAGE_FAMILY, "scene_3d"]),
  scene_3d: new Set(["image", "scene", "3d"]),
  video_breakdown: new Set(["video"]),
  audio: new Set(),
  text: new Set(),
  script: new Set(),
  video_compose: new Set(),
  style_reference: new Set(),
};

/** 不接受任何（或仅接受特定）入边的目标，给一句固定说明比拼接文案更明白。 */
const TARGET_REJECT_REASON: Record<string, string> = {
  video_breakdown: "逐帧拉片仅支持连接视频节点",
  audio: "音频节点暂不支持输入连线",
  text: "文本节点暂不支持输入连线",
  script: "脚本节点暂不支持输入连线",
  video_compose: "片段合成节点暂不支持输入连线",
  style_reference: "风格引用节点只能作为素材来源使用",
};

function labelOf(type: string): string {
  return NODE_LABEL[type] ?? type;
}

/** Keep canvas wiring honest for nodes with a strict input contract. */
export function canvasConnectionRule(
  source: CanvasConnectionEndpoint,
  target: CanvasConnectionEndpoint,
): CanvasConnectionRule {
  const accepted = ACCEPTED_INCOMING[target.type];
  if (!accepted || accepted.has(source.type)) {
    return { allowed: true };
  }
  const fixed = TARGET_REJECT_REASON[target.type];
  if (fixed) {
    return { allowed: false, reason: fixed };
  }
  // 图片族 × 视频给出可操作的替代路径：视频节点自带「截图」能产出图片节点。
  if (source.type === "video" && (IMAGE_FAMILY as readonly string[]).includes(target.type)) {
    return { allowed: false, reason: "图片节点不支持视频参考，可先在视频节点上截取画面帧，再连接生成的图片节点" };
  }
  return { allowed: false, reason: `${labelOf(target.type)}节点不支持连接${labelOf(source.type)}节点` };
}
