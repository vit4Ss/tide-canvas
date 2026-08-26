export type CharacterPresetKey =
  | "standard-male"
  | "standard-female"
  | "athletic"
  | "slim"
  | "teen"
  | "child"
  | "broad"
  | "chibi";

export interface CharacterPresetDefinition {
  key: CharacterPresetKey;
  label: string;
  /** 只改变人物体型，角色节点本身仍保持可统一缩放。 */
  bodyScale: [number, number, number];
  defaultScale: number;
  color: number;
}

export const CHARACTER_PRESETS: readonly CharacterPresetDefinition[] = [
  { key: "standard-male", label: "标准男性", bodyScale: [1, 1, 1], defaultScale: 1, color: 0x4f7df7 },
  { key: "standard-female", label: "标准女性", bodyScale: [0.9, 1, 0.9], defaultScale: 0.98, color: 0xec4899 },
  { key: "athletic", label: "健硕", bodyScale: [1.12, 1.02, 1.06], defaultScale: 1.02, color: 0x22c55e },
  { key: "slim", label: "纤细", bodyScale: [0.82, 1.03, 0.84], defaultScale: 1, color: 0xa855f7 },
  { key: "teen", label: "少年", bodyScale: [0.9, 0.94, 0.9], defaultScale: 0.92, color: 0x14b8a6 },
  { key: "child", label: "儿童", bodyScale: [0.86, 0.82, 0.88], defaultScale: 0.78, color: 0xf59e0b },
  { key: "broad", label: "宽厚", bodyScale: [1.2, 1, 1.1], defaultScale: 1.02, color: 0xef4444 },
  { key: "chibi", label: "二头身", bodyScale: [1.22, 0.7, 1.12], defaultScale: 0.72, color: 0x8b5cf6 },
] as const;

export function characterPreset(key?: string): CharacterPresetDefinition {
  return CHARACTER_PRESETS.find((preset) => preset.key === key) ?? CHARACTER_PRESETS[0];
}

export interface CameraPresetDefinition {
  key: string;
  label: string;
  /** 当前视角不提供固定坐标，直接复制正在查看的相机。 */
  position?: [number, number, number];
  target?: [number, number, number];
  fov: number;
  roll?: number;
}

const CENTER: [number, number, number] = [0, 1, 0];

export const CAMERA_PRESETS: readonly CameraPresetDefinition[] = [
  { key: "current", label: "当前视角", fov: 50 },
  { key: "front-medium", label: "正面中景", position: [0, 1.35, 3.1], target: CENTER, fov: 48 },
  { key: "front-close", label: "正面特写", position: [0, 1.48, 1.7], target: [0, 1.35, 0], fov: 42 },
  { key: "front-wide", label: "正面全景", position: [0, 1.55, 5.4], target: CENTER, fov: 55 },
  { key: "side-follow", label: "侧面跟拍", position: [3.4, 1.35, 0.7], target: CENTER, fov: 48 },
  { key: "side-close", label: "侧面近景", position: [2, 1.45, 0], target: [0, 1.25, 0], fov: 40 },
  { key: "back-medium", label: "背面中景", position: [0, 1.35, -3.1], target: CENTER, fov: 48 },
  { key: "top-wide", label: "俯拍全景", position: [0, 5.2, 3.8], target: CENTER, fov: 52 },
  { key: "top-45", label: "45° 俯拍", position: [3.4, 4.2, 3.4], target: CENTER, fov: 48 },
  { key: "low-up", label: "低角度仰拍", position: [0, 0.35, 2.5], target: [0, 1.35, 0], fov: 45 },
  { key: "low-wide", label: "低角度广角", position: [0, 0.3, 3.5], target: [0, 1.2, 0], fov: 75 },
  { key: "over-shoulder-left", label: "过肩镜头", position: [1.2, 1.55, 2], target: [-0.45, 1.25, 0], fov: 42 },
  { key: "over-shoulder-right", label: "过肩镜头（右）", position: [-1.2, 1.55, 2], target: [0.45, 1.25, 0], fov: 42 },
  { key: "bird-eye", label: "鸟瞰", position: [0.1, 7.5, 0.1], target: [0, 0, 0], fov: 48 },
  { key: "dutch", label: "荷兰角", position: [2.6, 1.7, 3], target: CENTER, fov: 48, roll: Math.PI / 12 },
] as const;

export const FRAME_ASPECTS = [
  { key: "auto", label: "自适应", value: 0, iconRatio: 1 },
  { key: "21:9", label: "21:9", value: 21 / 9, iconRatio: 21 / 9 },
  { key: "16:9", label: "16:9", value: 16 / 9, iconRatio: 16 / 9 },
  { key: "4:3", label: "4:3", value: 4 / 3, iconRatio: 4 / 3 },
  { key: "1:1", label: "1:1", value: 1, iconRatio: 1 },
  { key: "3:4", label: "3:4", value: 3 / 4, iconRatio: 3 / 4 },
  { key: "9:16", label: "9:16", value: 9 / 16, iconRatio: 9 / 16 },
] as const;

export type FrameAspectKey = (typeof FRAME_ASPECTS)[number]["key"];

export function frameAspect(key?: string) {
  return FRAME_ASPECTS.find((option) => option.key === key) ?? FRAME_ASPECTS[0];
}
