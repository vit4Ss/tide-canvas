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
 * 木偶姿势以“自然站立”为基底叠加语义关节角度（度）。
 *
 * XBot 的绑定姿势、局部骨骼轴和木偶并不相同，不能把这张表直接套到
 * XBot 上；XBot 使用下面单独校准过的 SKINNED_POSE_PARAM_PRESETS。
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

/**
 * XBot 专用静态姿势参数。
 *
 * XBot 的默认绑定姿势是 T/A 姿，且右臂的镜像扭转方向与木偶不同。
 * 这些值以 XBot 绑定姿势为基准，保证按钮名称对应实际的人体动作；
 * “行走”和“跑步”仍使用模型自带动画，不走这张表。
 */
export const SKINNED_POSE_PARAM_PRESETS: Partial<Record<Scene3DPoseName, Record<string, number>>> = {
  "站立": {
    armLAbd: -80, armRAbd: -80,
  },
  "坐姿": {
    hipsPitch: -5, chestPitch: 4,
    legLFwd: -82, legRFwd: -82, kneeL: 95, kneeR: 95,
    armLAbd: -80, armRAbd: -80, armLFwd: -10, armRFwd: -10,
    elbowL: 28, elbowR: 28,
  },
  "蹲下": {
    hipsPitch: -8, chestPitch: -8,
    legLFwd: -58, legRFwd: -58, kneeL: 90, kneeR: 90,
    armLAbd: -80, armRAbd: -80, armLFwd: -30, armRFwd: -30,
    elbowL: 18, elbowR: 18,
  },
  "单膝跪": {
    hipsPitch: -4, chestYaw: 8,
    legLFwd: -65, kneeL: 110, legRFwd: 0, kneeR: 0,
    armLAbd: -80, armRAbd: -80, armLFwd: -12, armRFwd: -12,
    elbowL: 24, elbowR: 24,
  },
  "双膝跪": {
    hipsPitch: 2, chestPitch: -5,
    legLFwd: -30, legRFwd: -30, kneeL: 0, kneeR: 0,
    armLAbd: -80, armRAbd: -80, armLFwd: -8, armRFwd: -8,
    elbowL: 32, elbowR: 32,
  },
  "叉腰": {
    chestPitch: 4,
    armLFwd: 20, armRFwd: 20, armLAbd: -60, armRAbd: -60,
    armLTwist: 35, armRTwist: -35, elbowL: 90, elbowR: 90,
  },
  "倚靠": {
    hipsRoll: 14, chestRoll: -11, headRoll: 7,
    legLFwd: -12, legRAbd: 12, kneeL: 12, kneeR: 5,
    armLAbd: -80, armRAbd: -80, armLFwd: 8, armRFwd: -15,
    elbowL: 22, elbowR: 55,
  },
  "鞠躬": {
    hipsPitch: -36, chestPitch: -24, headPitch: 22,
    armLAbd: -80, armRAbd: -80, armLFwd: 10, armRFwd: 10,
    elbowL: 8, elbowR: 8,
  },
  "思考": {
    chestYaw: 10, headPitch: -10, headYaw: -12, headRoll: 8,
    armLFwd: -28, armLAbd: -80, elbowL: 105,
    armRFwd: -58, armRAbd: -18, elbowR: 118,
  },
  "格斗": {
    hipsPitch: -8, chestYaw: -24, headYaw: 12,
    armLFwd: -70, armRFwd: -54, armLAbd: -20, armRAbd: -12,
    armLTwist: 0, armRTwist: 0, elbowL: 88, elbowR: 72,
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
    armLFwd: -60, armLAbd: -20, armLTwist: 0, elbowL: 22,
    armRFwd: 55, armRAbd: -42, armRTwist: -28, elbowR: 96,
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
    armLAbd: -80, armLFwd: 0, elbowL: 0,
    armRFwd: -20, armRAbd: 70, armRTwist: 0, elbowR: 100,
  },
  "伸手": {
    chestYaw: 12, headYaw: 8,
    armLAbd: -80, armLFwd: 0, elbowL: 0,
    armRFwd: -90, armRAbd: 0, armRTwist: 0, elbowR: 8,
  },
  "抱臂": {
    armLFwd: -46, armRFwd: -46, armLAbd: -22, armRAbd: -22,
    armLTwist: 34, armRTwist: -34, elbowL: 124, elbowR: 124,
    headYaw: -6,
  },
  "看手机": {
    chestPitch: -8, headPitch: -24,
    armLFwd: -42, armRFwd: -42, armLAbd: -10, armRAbd: -10,
    elbowL: 108, elbowR: 108,
  },
};

/** XBot 自带的步行动画片段；静态姿势统一以绑定姿势为基准。 */
export const SKINNED_ANIMATION_POSES: Partial<Record<Scene3DPoseName, { clip: string; at: number }>> = {
  "行走": { clip: "walk", at: 0.45 },
  "跑步": { clip: "run", at: 0.3 },
};
