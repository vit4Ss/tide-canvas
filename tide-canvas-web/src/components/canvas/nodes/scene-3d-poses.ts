/** 导演台角色姿势目录；顺序与右侧面板保持一致。 */
export const POSE_NAMES = [
  "站立", "T型", "行走", "跑步",
  "坐姿", "蹲下", "单膝跪", "双膝跪",
  "叉腰", "倚靠", "鞠躬", "思考",
  "格斗", "踢球", "投掷", "推进",
  "招手", "伸手", "抱臂", "看手机",
] as const;

export type Scene3DPoseName = (typeof POSE_NAMES)[number];

/**
 * 非动画姿势以“自然站立”为基底叠加语义关节角度（度）。键名与姿势调节滑杆共用，
 * 因此 XBot 与加载失败时的基础木偶能得到一致的动作含义。
 */
export const POSE_PARAM_PRESETS: Partial<Record<Scene3DPoseName, Record<string, number>>> = {
  "坐姿": {
    hipsPitch: -5, chestPitch: 4,
    legLFwd: -82, legRFwd: -82, kneeL: 95, kneeR: 95,
    armLFwd: -10, armRFwd: -10, elbowL: 28, elbowR: 28,
  },
  "蹲下": {
    hipsPitch: -16, chestPitch: -10,
    legLFwd: -58, legRFwd: -58, kneeL: 118, kneeR: 118,
    armLFwd: -30, armRFwd: -30, elbowL: 18, elbowR: 18,
  },
  "单膝跪": {
    hipsPitch: -8, chestYaw: 8,
    legLFwd: -56, kneeL: 88, legRFwd: 28, kneeR: 125,
    armLFwd: -12, armRFwd: -12, elbowL: 24, elbowR: 24,
  },
  "双膝跪": {
    hipsPitch: 6, chestPitch: -6,
    legLFwd: 28, legRFwd: 28, kneeL: 128, kneeR: 128,
    armLFwd: -8, armRFwd: -8, elbowL: 32, elbowR: 32,
  },
  "叉腰": {
    chestPitch: 4,
    armLFwd: 18, armRFwd: 18, armLAbd: -34, armRAbd: -34,
    armLTwist: 38, armRTwist: 38, elbowL: 112, elbowR: 112,
  },
  "倚靠": {
    hipsRoll: 14, chestRoll: -11, headRoll: 7,
    legLFwd: -12, legRAbd: 12, kneeL: 12, kneeR: 5,
    armLFwd: 8, armRFwd: -15, elbowL: 22, elbowR: 55,
  },
  "鞠躬": {
    hipsPitch: -36, chestPitch: -24, headPitch: 22,
    armLFwd: 10, armRFwd: 10, elbowL: 8, elbowR: 8,
  },
  "思考": {
    chestYaw: 10, headPitch: -10, headYaw: -12, headRoll: 8,
    armLFwd: -28, armRFwd: -58, armRAbd: -18,
    elbowL: 105, elbowR: 118,
  },
  "格斗": {
    hipsPitch: -8, chestYaw: -24, headYaw: 12,
    armLFwd: -70, armRFwd: -54, armLAbd: -20, armRAbd: -12,
    elbowL: 88, elbowR: 72,
    legLFwd: -18, legRFwd: 20, legLAbd: 14, legRAbd: 18, kneeL: 22, kneeR: 30,
  },
  "踢球": {
    hipsRoll: 8, chestRoll: -7,
    armLFwd: 18, armRFwd: -12, armLAbd: -38, armRAbd: -46,
    elbowL: 24, elbowR: 18,
    legLFwd: -88, kneeL: 18, legRFwd: 12, kneeR: 12,
  },
  "投掷": {
    hipsPitch: -6, chestYaw: -38, chestRoll: 8, headYaw: 18,
    armLFwd: -60, armLAbd: -20, elbowL: 22,
    armRFwd: 55, armRAbd: -42, armRTwist: 28, elbowR: 96,
    legLFwd: -18, legRFwd: 24, kneeL: 18, kneeR: 28,
  },
  "推进": {
    hipsPitch: -18, chestPitch: -18,
    armLFwd: -84, armRFwd: -84, armLAbd: -8, armRAbd: -8,
    elbowL: 14, elbowR: 14,
    legLFwd: -22, legRFwd: 24, kneeL: 22, kneeR: 32,
  },
  "招手": {
    chestYaw: 8, headYaw: 12,
    armRFwd: -25, armRAbd: -72, armRTwist: 18, elbowR: 104,
    armLFwd: -6, elbowL: 12,
  },
  "伸手": {
    chestYaw: 12, headYaw: 8,
    armRFwd: -88, armRAbd: -8, elbowR: 8,
    armLFwd: -8, elbowL: 16,
  },
  "抱臂": {
    armLFwd: -46, armRFwd: -46, armLAbd: -22, armRAbd: -22,
    armLTwist: 34, armRTwist: 34, elbowL: 124, elbowR: 124,
    headYaw: -6,
  },
  "看手机": {
    chestPitch: -8, headPitch: -24,
    armLFwd: -42, armRFwd: -42, armLAbd: -10, armRAbd: -10,
    elbowL: 108, elbowR: 108,
  },
};

/** XBot 自带的动作片段；其它姿势在 idle 帧之上应用上面的语义关节参数。 */
export const SKINNED_ANIMATION_POSES: Partial<Record<Scene3DPoseName, { clip: string; at: number }>> = {
  "站立": { clip: "idle", at: 0 },
  "行走": { clip: "walk", at: 0.45 },
  "跑步": { clip: "run", at: 0.3 },
};
