export type VideoPresetKind = "effect" | "camera";

export interface VideoCreativePreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

/** Original, provider-neutral prompt guidance; no proprietary templates or assets. */
export const VIDEO_CAMERA_PRESETS: readonly VideoCreativePreset[] = [
  { id: "camera-fixed", label: "固定镜头", description: "机位保持不动，呈现主体动作", prompt: "摄影机保持固定机位，构图稳定，不平移、不推拉，让主体在画面中自然运动。" },
  { id: "camera-follow", label: "跟随镜头", description: "保持与主体的距离，持续跟拍", prompt: "摄影机平稳跟随主体移动，保持一致的拍摄距离和主体构图，运动连续自然。" },
  { id: "camera-pan-left", label: "向左摇镜", description: "机位不动，镜头水平转向左侧", prompt: "摄影机机位保持不动，镜头缓慢向左水平转动，连续展示左侧环境。" },
  { id: "camera-pan-right", label: "向右摇镜", description: "机位不动，镜头水平转向右侧", prompt: "摄影机机位保持不动，镜头缓慢向右水平转动，连续展示右侧环境。" },
  { id: "camera-tilt-up", label: "向上摇镜", description: "从低处向上展开画面", prompt: "摄影机机位保持不动，镜头从低处平稳向上仰拍，逐步展开上方空间。" },
  { id: "camera-tilt-down", label: "向下摇镜", description: "从高处向下展开画面", prompt: "摄影机机位保持不动，镜头从高处平稳向下俯拍，逐步展开下方空间。" },
  { id: "camera-truck-left", label: "向左横移", description: "摄影机向左移动，形成空间视差", prompt: "摄影机保持朝向并平稳向左横向移动，呈现自然的前后景视差，主体保持清晰。" },
  { id: "camera-truck-right", label: "向右横移", description: "摄影机向右移动，形成空间视差", prompt: "摄影机保持朝向并平稳向右横向移动，呈现自然的前后景视差，主体保持清晰。" },
  { id: "camera-dolly-in", label: "镜头推进", description: "摄影机靠近主体，强调细节", prompt: "摄影机平稳向主体靠近，保持焦距不变，让主体自然变大并逐步呈现细节。" },
  { id: "camera-dolly-out", label: "镜头拉远", description: "摄影机远离主体，显露环境", prompt: "摄影机平稳向后远离主体，保持焦距不变，逐步展现主体周围的完整环境。" },
  { id: "camera-orbit", label: "环绕镜头", description: "以主体为中心，沿弧线移动", prompt: "摄影机以主体为中心沿平缓弧线环绕移动，保持拍摄距离和主体构图稳定，呈现不同侧面。" },
  { id: "camera-crane-up", label: "升降镜头·上升", description: "摄影机垂直升高，展开空间", prompt: "摄影机平稳垂直上升，逐步扩大空间视野，运动连贯，避免突然改变角度。" },
  { id: "camera-crane-down", label: "升降镜头·下降", description: "摄影机垂直下降，靠近场景", prompt: "摄影机平稳垂直下降，从较高视角逐渐接近主体所在空间，运动连贯。" },
  { id: "camera-zoom-in", label: "变焦放大", description: "机位不动，通过焦距放大主体", prompt: "摄影机机位保持不动，通过平稳增加镜头焦距放大主体，画面中心保持稳定。" },
  { id: "camera-zoom-out", label: "变焦缩小", description: "机位不动，通过焦距扩大视野", prompt: "摄影机机位保持不动，通过平稳减小镜头焦距扩大视野，主体保持在画面中心。" },
  { id: "camera-handheld", label: "手持镜头", description: "轻微自然晃动，带来现场感", prompt: "采用克制的手持摄影，只有轻微自然的呼吸感晃动，保持主体可辨识，避免剧烈抖动。" },
  { id: "camera-drone", label: "航拍镜头", description: "高位缓慢飞行，展现全景", prompt: "采用高位航拍视角，摄影机缓慢平稳飞行，展现环境全景与清晰空间关系。" },
];

export const VIDEO_EFFECT_PRESETS: readonly VideoCreativePreset[] = [
  { id: "effect-slow-motion", label: "慢动作", description: "放慢动作，突出瞬间细节", prompt: "采用自然流畅的慢动作，突出动作过程中的细节，保持物体形态和运动方向一致。" },
  { id: "effect-timelapse", label: "延时摄影", description: "加速环境变化，表现时间流逝", prompt: "采用延时摄影表现时间流逝，让环境中的自然变化加快，保持主体结构和画面连贯。" },
  { id: "effect-light-particles", label: "微光粒子", description: "少量细小光点，增加空间层次", prompt: "在环境中加入少量细小、柔和的漂浮光点，随景深自然虚化，不遮挡主体。" },
  { id: "effect-mist", label: "薄雾氛围", description: "薄雾缓慢流动，保留主体细节", prompt: "在场景中加入轻薄且缓慢流动的雾气，保持主体轮廓和关键细节清晰可见。" },
  { id: "effect-rain", label: "雨景", description: "自然雨丝与细微水面涟漪", prompt: "呈现自然连续的雨丝，并在适当的表面形成轻微水滴与涟漪，保持光线与原场景一致。" },
  { id: "effect-snow", label: "飘雪", description: "不同景深的雪花缓慢落下", prompt: "加入自然缓慢飘落的雪花，前后景大小和虚实有所区别，不遮挡主体面部或关键细节。" },
  { id: "effect-product-light-sweep", label: "产品扫光", description: "柔和光线掠过表面，展现材质", prompt: "让一道柔和的光线缓慢掠过主体表面，呈现真实材质与轮廓，避免过曝并保留细节。" },
  { id: "effect-warm-backlight", label: "暖色逆光", description: "温暖边缘光，营造柔和氛围", prompt: "采用自然温暖的逆光，在主体边缘形成柔和轮廓光，保留主体细节和真实色彩。" },
  { id: "effect-film-grain", label: "胶片颗粒", description: "细腻颗粒与轻微色调变化", prompt: "加入细腻克制的胶片颗粒和柔和的明暗过渡，保持画面清晰，避免明显噪点和闪烁。" },
  { id: "effect-motion-trails", label: "运动拖影", description: "运动处带有轻微、连续的拖影", prompt: "在快速运动的边缘加入轻微连续的运动拖影，保持主体身份、轮廓和运动轨迹清楚。" },
];

export function videoPresetsFor(kind: VideoPresetKind): readonly VideoCreativePreset[] {
  return kind === "effect" ? VIDEO_EFFECT_PRESETS : VIDEO_CAMERA_PRESETS;
}

export function findVideoPreset(kind: VideoPresetKind, id?: string): VideoCreativePreset | undefined {
  return id ? videoPresetsFor(kind).find((preset) => preset.id === id) : undefined;
}

/** Compose from the saved, unmodified user prompt on every request. Changing or
 * clearing an ID therefore replaces/removes guidance without mutating the editor. */
export function buildVideoCreativePrompt(base: string, effectId?: string, cameraId?: string): string {
  const additions: string[] = [];
  const camera = findVideoPreset("camera", cameraId);
  const effect = findVideoPreset("effect", effectId);
  for (const [label, preset] of [["镜头运动", camera], ["视觉效果", effect]] as const) {
    if (preset && !base.includes(preset.prompt)) additions.push(`${label}：${preset.prompt}`);
  }
  if (!additions.length) return base;
  return [base, ...additions].filter((part) => part.trim()).join("\n\n");
}
