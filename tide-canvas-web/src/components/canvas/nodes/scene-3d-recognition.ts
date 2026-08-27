import type { CharacterPresetKey } from "./scene-3d-director-presets";

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
    "坐标规则：画面左侧为负x、右侧为正x；前景为正z、远景为负z；props的x/z范围-8到8，尺寸0.05到10米。",
    "识别8到30个主要物体（家具、墙面构件、大型陈设、绿植），忽略细小杂物；桌椅沙发等落地家具必须落地，尺寸符合常识（桌高约0.75米、座面约0.45米）。",
    "characters规则：preset只能是 standard-male、standard-female、athletic、slim、teen、child、broad、chibi；x/z范围-4到4；画面中没有人物时characters返回空数组，不要虚构。",
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
