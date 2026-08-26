/** 导演台场景环境设置。 */
export interface Scene3DEnv {
  /** 当前使用的全景图；缺省时允许导演台沿用已连接的场景图片。 */
  panoUrl?: string;
  /** 全景图在导演台中的展示名称。 */
  panoTitle?: string;
  /** 用于回显素材来源，不参与 three.js 渲染。 */
  panoSource?: "connected" | "upload" | "history" | "ai";
  /** 截图与机位构图使用的画幅；auto 跟随当前视口。 */
  frameAspect?: "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  /** 全景球水平旋转（角度 0~360）。 */
  panoRotY: number;
  /** 全景球半径（米）。 */
  panoRadius: number;
  /** 无全景时的天空颜色（#rrggbb）。 */
  skyColor: string;
  showLabels: boolean;
  showGround: boolean;
}

export const DEFAULT_ENV: Scene3DEnv = {
  frameAspect: "auto",
  panoRotY: 0,
  panoRadius: 50,
  skyColor: "#1e293b",
  showLabels: true,
  showGround: true,
};

const PANORAMA_SOURCES = new Set<NonNullable<Scene3DEnv["panoSource"]>>(["connected", "upload", "history", "ai"]);
const FRAME_ASPECTS = new Set<NonNullable<Scene3DEnv["frameAspect"]>>(["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);

/** 持久化数据可能来自旧版本或手工修改，进入渲染器前统一收敛环境属性。 */
export function normalizeScene3DEnv(value: unknown): Scene3DEnv {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Scene3DEnv>
    : {};
  const panoUrl = typeof raw.panoUrl === "string" && raw.panoUrl.trim() ? raw.panoUrl.trim() : undefined;
  const panoTitle = typeof raw.panoTitle === "string" && raw.panoTitle.trim()
    ? raw.panoTitle.trim().slice(0, 200)
    : undefined;
  const panoSource = typeof raw.panoSource === "string" && PANORAMA_SOURCES.has(raw.panoSource as NonNullable<Scene3DEnv["panoSource"]>)
    ? raw.panoSource as NonNullable<Scene3DEnv["panoSource"]>
    : undefined;
  const frameAspect = typeof raw.frameAspect === "string" && FRAME_ASPECTS.has(raw.frameAspect as NonNullable<Scene3DEnv["frameAspect"]>)
    ? raw.frameAspect as NonNullable<Scene3DEnv["frameAspect"]>
    : DEFAULT_ENV.frameAspect;
  const finite = (candidate: unknown, fallback: number, min: number, max: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, candidate))
      : fallback;
  return {
    panoRotY: finite(raw.panoRotY, DEFAULT_ENV.panoRotY, 0, 360),
    panoRadius: finite(raw.panoRadius, DEFAULT_ENV.panoRadius, 10, 200),
    skyColor: typeof raw.skyColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.skyColor)
      ? raw.skyColor
      : DEFAULT_ENV.skyColor,
    showLabels: typeof raw.showLabels === "boolean" ? raw.showLabels : DEFAULT_ENV.showLabels,
    showGround: typeof raw.showGround === "boolean" ? raw.showGround : DEFAULT_ENV.showGround,
    ...(panoUrl ? { panoUrl } : {}),
    ...(panoTitle ? { panoTitle } : {}),
    ...(panoSource ? { panoSource } : {}),
    ...(frameAspect ? { frameAspect } : {}),
  };
}
