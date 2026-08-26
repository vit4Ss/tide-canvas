import type { CharacterPresetKey } from "./scene-3d-director-presets";

export interface RecognizedBlockingCharacter {
  name: string;
  preset: CharacterPresetKey;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export interface RecognizedBlocking {
  characters: RecognizedBlockingCharacter[];
  cameraPreset?: string;
}

const PRESETS = new Set<CharacterPresetKey>([
  "standard-male", "standard-female", "athletic", "slim", "teen", "child", "broad", "chibi",
]);

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** 从文本模型响应中提取安全、有限的站位数据。 */
export function parseRecognizedBlocking(text: string): RecognizedBlocking | null {
  const source = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
    const rows = Array.isArray(raw.characters) ? raw.characters.slice(0, 18) : [];
    const characters = rows.flatMap((value, index): RecognizedBlockingCharacter[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      const preset = typeof row.preset === "string" && PRESETS.has(row.preset as CharacterPresetKey)
        ? row.preset as CharacterPresetKey
        : "standard-male";
      return [{
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : `角色${index + 1}`,
        preset,
        x: finite(row.x, 0, -4, 4),
        z: finite(row.z, 0, -4, 4),
        rotation: finite(row.rotation, 0, -180, 180),
        scale: finite(row.scale, 1, 0.5, 1.8),
      }];
    });
    if (!characters.length) return null;
    return {
      characters,
      ...(typeof raw.cameraPreset === "string" ? { cameraPreset: raw.cameraPreset.slice(0, 50) } : {}),
    };
  } catch {
    return null;
  }
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

export function recognitionTaskText(resultMeta: unknown): string {
  let meta = resultMeta;
  if (typeof meta === "string") {
    try { meta = JSON.parse(meta) as unknown; } catch { return ""; }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const text = (meta as Record<string, unknown>).text;
  return typeof text === "string" ? text : "";
}
