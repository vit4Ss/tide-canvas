import type { AiModelVO } from "@/types/ai";
import type { CharacterPresetKey } from "./scene-3d-director-presets";

/** 识图模型选择：后台配置的文本主模型（「AI 优化主模型」，全局唯一）优先——
 *  管理员显式指定的主力模型通常也是视觉理解最强的；未配置或主模型不支持
 *  skill_text_completion 时，交给调用方传入的回退挑选（分镜解析的启发式，
 *  显式视觉能力优先）。回退以参数注入，模块保持无别名依赖可被 Node 直测。 */
export function selectRecognitionModel(
  models: readonly AiModelVO[],
  fallback: (models: readonly AiModelVO[]) => AiModelVO | undefined,
): AiModelVO | undefined {
  const primary = models.find((candidate) => {
    if (candidate.type !== "text") return false;
    if (candidate.supportedHandlers?.length && !candidate.supportedHandlers.includes("skill_text_completion")) return false;
    try {
      return (JSON.parse(candidate.config || "{}") as { aiOptimizePrimary?: boolean }).aiOptimizePrimary === true;
    } catch {
      return false;
    }
  });
  return primary ?? fallback(models);
}

export interface RecognizedBlockingCharacter {
  name: string;
  preset: CharacterPresetKey;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

/** 白膜物体：模型给出米制真实尺寸与地面落点，导入时换算为道具几何的缩放。 */
export interface RecognizedWhiteboxProp {
  name: string;
  kind: "box" | "sphere" | "cylinder";
  x: number;
  /** 物体中心离地高度（米）；落地物体为 h/2。 */
  y: number;
  z: number;
  /** 绕竖直轴角度 */
  rotation: number;
  w: number;
  h: number;
  d: number;
}

export interface RecognizedBlocking {
  characters: RecognizedBlockingCharacter[];
  props?: RecognizedWhiteboxProp[];
  cameraPreset?: string;
}

const PRESETS = new Set<CharacterPresetKey>([
  "standard-male", "standard-female", "athletic", "slim", "teen", "child", "broad", "chibi",
]);

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseCharacterRows(value: unknown): RecognizedBlockingCharacter[] {
  const rows = Array.isArray(value) ? value.slice(0, 18) : [];
  return rows.flatMap((row, index): RecognizedBlockingCharacter[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const preset = typeof record.preset === "string" && PRESETS.has(record.preset as CharacterPresetKey)
      ? record.preset as CharacterPresetKey
      : "standard-male";
    return [{
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 40) : `角色${index + 1}`,
      preset,
      x: finite(record.x, 0, -4, 4),
      z: finite(record.z, 0, -4, 4),
      rotation: finite(record.rotation, 0, -180, 180),
      scale: finite(record.scale, 1, 0.5, 1.8),
    }];
  });
}

function parsePropRows(value: unknown): RecognizedWhiteboxProp[] {
  const rows = Array.isArray(value) ? value.slice(0, 40) : [];
  return rows.flatMap((row, index): RecognizedWhiteboxProp[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const kind = record.kind === "sphere" || record.kind === "cylinder" ? record.kind : "box";
    const h = finite(record.h, 0.5, 0.05, 10);
    return [{
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 40) : `物体${index + 1}`,
      kind,
      x: finite(record.x, 0, -8, 8),
      y: finite(record.y, h / 2, 0.02, 8),
      z: finite(record.z, 0, -8, 8),
      rotation: finite(record.rotation, 0, -180, 180),
      w: finite(record.w, 0.5, 0.05, 10),
      h,
      d: finite(record.d, 0.5, 0.05, 10),
    }];
  });
}

function cameraPresetField(raw: Record<string, unknown>): { cameraPreset?: string } {
  return typeof raw.cameraPreset === "string" ? { cameraPreset: raw.cameraPreset.slice(0, 50) } : {};
}

/** 从文本模型响应中提取安全、有限的站位数据。 */
export function parseRecognizedBlocking(text: string): RecognizedBlocking | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const characters = parseCharacterRows(raw.characters);
  if (!characters.length) return null;
  return { characters, ...cameraPresetField(raw) };
}

/** 白膜生成结果：允许纯物体的空场景，但物体和人物不能同时为空。 */
export function parseRecognizedWhitebox(text: string): RecognizedBlocking | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const characters = parseCharacterRows(raw.characters);
  const props = parsePropRows(raw.props);
  if (!characters.length && !props.length) return null;
  return { characters, props, ...cameraPresetField(raw) };
}

export function buildBlockingRecognitionPrompt(): string {
  return [
    "分析这张影视画面中的人物数量、相对站位、朝向和体型，生成3D导演台站位参考。",
    "只返回一个JSON对象，不要Markdown和解释。",
    "格式：{\"characters\":[{\"name\":\"角色A\",\"preset\":\"standard-male\",\"x\":-0.8,\"z\":0.2,\"rotation\":0,\"scale\":1}],\"cameraPreset\":\"front-medium\"}",
    "坐标规则：画面左侧为负x、右侧为正x；前景为正z、远景为负z；x/z范围-4到4。rotation为角度。",
    "若是360°等距柱状全景图（画面横向环绕一周、直线呈弧形弯曲）：观察点位于原点，人物按其在图中的水平位置换算方位角环绕摆放——水平中心为正前方(-z)，左右边缘为正后方(+z)，1/4处为左侧(-x)，3/4处为右侧(+x)。",
    "preset只能是 standard-male、standard-female、athletic、slim、teen、child、broad、chibi。",
    "最多识别18人；无法确认性别或体型时使用standard-male；不要虚构画面中不存在的人。",
  ].join("\n");
}

export function buildWhiteboxRecognitionPrompt(): string {
  return [
    "分析这张场景图，把画面中的主要物体简化为3D白膜体块（blockout），并提取人物站位，生成3D导演台场景。",
    "只返回一个JSON对象，不要Markdown和解释。",
    "格式：{\"props\":[{\"name\":\"沙发\",\"kind\":\"box\",\"x\":-1.2,\"y\":0.4,\"z\":0.6,\"rotation\":0,\"w\":2,\"h\":0.8,\"d\":0.9}],\"characters\":[{\"name\":\"角色A\",\"preset\":\"standard-male\",\"x\":-0.8,\"z\":0.2,\"rotation\":0,\"scale\":1}],\"cameraPreset\":\"front-medium\"}",
    "props是场景物体清单：kind只能是box、sphere、cylinder，用最接近的基本体近似复杂物体；w/h/d是物体真实尺寸（米），x/z是物体中心的地面坐标，y是物体中心离地高度（落地物体取h/2，挂墙物体按实际高度），rotation为绕竖直轴的角度。",
    "先判断图片类型再定坐标：",
    "A. 普通透视照片（观察者在场景一侧）：画面左侧为负x、右侧为正x；前景为正z、远景为负z。",
    "B. 360°等距柱状全景图（画面横向环绕一周、直线呈弧形弯曲、宽高比通常2:1或16:9）：观察点位于原点(0,0)，物体按其在图中的水平位置换算方位角环绕摆放；再用物体在图中的大小和地面透视估算它到观察点的距离（一般2到7米）；墙体、立柱、门要按方位角围绕原点围合出房间，不要摊平到同一侧。",
    "全景换算方法：水平位置u取0到1，方位角θ=(u-0.5)×360°，x=距离×sin(θ)，z=-距离×cos(θ)。算例：u=0.5、距离5米 → 正前方x=0、z=-5；u=0.75、距离4米 → 右侧x=4、z=0；u=0.25 → 左侧x为负；u接近0或1 → 身后z为正。按水平分段逐段清点物体（边缘=身后、1/4=左、中心=正前、3/4=右），不要漏掉画面边缘的身后区域。",
    "布局硬约束：体块之间不得穿插重叠；成排成组的小物（一排椅子、一组柜子）合并为一个体块；墙体厚度取0.1到0.3米；贴边的墙体、柜台、背景板长边沿环绕切线方向，rotation取负的方位角（右侧90°方位的墙 rotation=-90），同一面墙及其上物体用相同距离；场景中央留出人物活动空间。",
    "props的x/z范围-8到8，尺寸0.05到10米；识别8到30个主要物体（家具、墙面构件、大型陈设、绿植），忽略细小杂物；落地家具必须落地，尺寸符合常识（桌高约0.75米、座面约0.45米、门高约2.1米、室内墙高2.7到4米）。",
    "characters规则：preset只能是 standard-male、standard-female、athletic、slim、teen、child、broad、chibi；x/z范围-4到4，全景图时同样按方位角环绕摆放，rotation取人物实际朝向；画面中没有人物时characters返回空数组，不要虚构。",
  ].join("\n");
}

export function recognitionTaskText(resultMeta: unknown): string {
  let meta = resultMeta;
  if (typeof meta === "string") {
    try { meta = JSON.parse(meta) as unknown; } catch { return ""; }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const text = (meta as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}

/** 白膜统一浅灰白，避免识别导入后出现彩色积木感。 */
export const WHITEBOX_PROP_COLOR = 0xe8e6e1;

/** 道具基准几何尺寸（米），必须与编辑器 addPropInternal 创建的几何一致：
 *  box 0.8×0.8×0.8、sphere 直径0.9、cylinder 直径0.8×高0.9。 */
const PROP_BASE_SIZE: Record<RecognizedWhiteboxProp["kind"], [number, number, number]> = {
  box: [0.8, 0.8, 0.8],
  sphere: [0.9, 0.9, 0.9],
  cylinder: [0.8, 0.9, 0.8],
};

/** 把米制白膜体块换算为导演台道具的变换（缩放限幅与持久化解析一致）。 */
export function whiteboxPropPlacement(prop: RecognizedWhiteboxProp): {
  name: string;
  kind: RecognizedWhiteboxProp["kind"];
  color: number;
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
} {
  const base = PROP_BASE_SIZE[prop.kind];
  const axis = (size: number, reference: number) => Math.min(20, Math.max(0.05, size / reference));
  return {
    name: prop.name,
    kind: prop.kind,
    color: WHITEBOX_PROP_COLOR,
    pos: [prop.x, prop.y, prop.z],
    rot: [0, prop.rotation * Math.PI / 180, 0],
    scale: [axis(prop.w, base[0]), axis(prop.h, base[1]), axis(prop.d, base[2])],
  };
}
