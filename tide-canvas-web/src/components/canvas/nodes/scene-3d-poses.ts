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
    hipsPitch: -4, chestPitch: 3,
    legLFwd: -85, legRFwd: -85, legLAbd: 5, legRAbd: 5, kneeL: 88, kneeR: 88,
    armLFwd: -10, armRFwd: -10, elbowL: 34, elbowR: 34,
  },
  "蹲下": {
    hipsPitch: -6, chestPitch: -16,
    legLFwd: -84, legRFwd: -84, legLAbd: 12, legRAbd: 12, kneeL: 132, kneeR: 132,
    armLFwd: -30, armRFwd: -30, elbowL: 30, elbowR: 30,
  },
  "单膝跪": {
    chestPitch: -6,
    legLFwd: -88, kneeL: 90, legRFwd: 10, kneeR: 100,
    armLFwd: -14, armRFwd: -6, elbowL: 28, elbowR: 12,
  },
  "双膝跪": {
    chestPitch: -3,
    legLFwd: 8, legRFwd: 8, kneeL: 78, kneeR: 78,
    armLFwd: -6, armRFwd: -6, elbowL: 22, elbowR: 22,
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
    // hipsPitch 会把腿一起转倒，弯腰只用胸椎
    chestPitch: -42, headPitch: 16,
    armLFwd: 6, armRFwd: 6, elbowL: 8, elbowR: 8,
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
 * 姿势的髋部下沉量（米）：坐/蹲/跪这类姿势必须整体降低身体才能落地，
 * 姿势引擎只旋转关节，下沉由 Figure 单独应用（并随存档往返）。
 * 木偶与 XBot 身高相近（1.65 / 1.7m），共用一张表。
 */
export const POSE_ROOT_DROP: Partial<Record<Scene3DPoseName, number>> = {
  // 按 XBot 实测校准：站立时脚踝自然高度 0.081m，以下取值让接触点正好贴地
  "坐姿": 0.37,
  "蹲下": 0.54,
  "单膝跪": 0.44,
  "双膝跪": 0.47,
};

/**
 * XBot 专用静态姿势参数。
 *
 * XBot 的默认绑定姿势是 T/A 姿，且右臂的镜像扭转方向与木偶不同。
 * 这些值以 XBot 绑定姿势为基准，保证按钮名称对应实际的人体动作；
 * “行走”和“跑步”仍使用模型自带动画，不走这张表。
 *
 * 调参须知（引擎按 前举∘外展∘扭转 复合，轴固定在绑定期父骨骼空间）：
 * - 手臂垂下（armAbd ≈ -75）后 armFwd 近似绕体轴自旋，几乎抬不起手臂；
 *   想把手抬到胸前用「垂臂 + 大肘弯 + 扭转对中」的组合。
 * - hipsPitch 转的是根骨，腿会跟着一起倒——弯腰用 chestPitch，
 *   hipsPitch 只在弓步/冲刺里给全身小角度前倾。
 */
export const SKINNED_POSE_PARAM_PRESETS: Partial<Record<Scene3DPoseName, Record<string, number>>> = {
  "站立": {
    // 放松站姿：肘部微弯、肩膀不锁死，避免立正僵直
    armLAbd: -76, armRAbd: -76, armLFwd: -6, armRFwd: -6,
    elbowL: 9, elbowR: 9,
  },
  "坐姿": {
    // 椅面高度坐姿（配合下沉 0.37m 落地），双手搭在大腿上
    hipsPitch: -4, chestPitch: 3,
    legLFwd: -85, legRFwd: -85, legLAbd: 5, legRAbd: 5, kneeL: 88, kneeR: 88,
    armLAbd: -72, armRAbd: -72, armLFwd: -12, armRFwd: -12,
    armLTwist: 12, armRTwist: -12, elbowL: 42, elbowR: 42,
  },
  "蹲下": {
    // 深蹲（下沉 0.54m），膝盖外开、前臂搭膝
    hipsPitch: -6, chestPitch: -16,
    legLFwd: -84, legRFwd: -84, legLAbd: 15, legRAbd: 15, kneeL: 132, kneeR: 132,
    armLAbd: -56, armRAbd: -56, armLFwd: -32, armRFwd: -32,
    elbowL: 46, elbowR: 46, headPitch: 6,
  },
  "单膝跪": {
    // 右膝着地、左大腿近水平前脚踩实（下沉 0.44m）
    chestPitch: -6,
    legLFwd: -88, kneeL: 90, legRFwd: 10, kneeR: 100,
    armLAbd: -66, armLFwd: -16, elbowL: 34, armLTwist: 10,
    armRAbd: -76, armRFwd: -6, elbowR: 12,
  },
  "双膝跪": {
    // 直身跪（下沉 0.47m）：大腿近垂直、膝弯放平小腿贴地
    chestPitch: -3,
    legLFwd: 8, legRFwd: 8, kneeL: 78, kneeR: 78,
    armLAbd: -76, armRAbd: -76, armLFwd: -6, armRFwd: -6,
    elbowL: 22, elbowR: 22,
  },
  "叉腰": {
    // 扫描定稿：手掌正落在胯骨两侧，肘部外开（扭转再大手会滑到腹前合拢）
    chestPitch: 3,
    armLFwd: 10, armRFwd: 10, armLAbd: -48, armRAbd: -48,
    armLTwist: 35, armRTwist: -35, elbowL: 88, elbowR: 88,
  },
  "倚靠": {
    hipsRoll: 14, chestRoll: -11, headRoll: 7,
    legLFwd: -12, legRAbd: 14, kneeL: 14, kneeR: 5,
    armLAbd: -78, armRAbd: -74, armLFwd: 6, armRFwd: -12,
    elbowL: 18, elbowR: 62,
  },
  "鞠躬": {
    // 弯腰只用胸椎：hipsPitch 会把腿一起转倒
    chestPitch: -42, headPitch: 14,
    armLAbd: -78, armRAbd: -78, elbowL: 6, elbowR: 6,
  },
  "思考": {
    // 左臂横在腹前托肘、右手折到下巴下方，低头触手（扫描定稿）
    chestYaw: 6, headPitch: -14, headYaw: -8, headRoll: 5,
    armLAbd: -68, armLFwd: -14, armLTwist: 18, elbowL: 74,
    armRAbd: -65, armRFwd: -30, armRTwist: -8, elbowR: 138,
  },
  "格斗": {
    // 拳架：双拳收到下巴前、肘部下沉护肋，步子前后分立
    hipsPitch: -4, chestYaw: -22, headYaw: 10,
    armLAbd: -54, armRAbd: -54, armLFwd: -14, armRFwd: -14,
    armLTwist: 16, armRTwist: -16, elbowL: 126, elbowR: 126,
    legLFwd: -18, legRFwd: 20, legLAbd: 12, legRAbd: 16, kneeL: 24, kneeR: 30,
  },
  "踢球": {
    // 左腿踢出微屈膝，躯干后仰、双臂一前一后配平
    hipsRoll: 6, chestRoll: -6, chestPitch: 10, headPitch: -14,
    armLAbd: -35, armLFwd: 25, elbowL: 18,
    armRAbd: -50, armRFwd: -35, elbowR: 20,
    legLFwd: -72, kneeL: 32, legRFwd: 6, kneeR: 18,
  },
  "投掷": {
    // 蓄力相：右臂上举后引屈肘，左臂指向目标，重心在后腿
    hipsPitch: -4, chestYaw: -34, chestRoll: 6, headYaw: 16,
    armLFwd: -55, armLAbd: -30, elbowL: 15,
    armRAbd: 8, armRFwd: 30, armRTwist: -40, elbowR: 96,
    legLFwd: -20, kneeL: 15, legRFwd: 18, legRAbd: 10, kneeR: 25,
  },
  "推进": {
    // 前推：躯干前压、双臂前伸微屈、弓步蹬地
    hipsPitch: -6, chestPitch: -16, headPitch: 4,
    armLFwd: -68, armRFwd: -68, armLAbd: -14, armRAbd: -14,
    elbowL: 26, elbowR: 26,
    legLFwd: -26, legRFwd: 22, kneeL: 24, kneeR: 34,
  },
  "招手": {
    // 手举到头侧挥动（上臂 40° 上扬 + 小臂立起），不折到头顶
    chestYaw: 6, headYaw: 10, headRoll: -4,
    armLAbd: -76, armLFwd: -4, elbowL: 10,
    armRAbd: 42, armRFwd: -12, armRTwist: 30, elbowR: 68,
  },
  "伸手": {
    chestYaw: 10, chestPitch: -6, headYaw: 6,
    armLAbd: -74, armLFwd: 6, elbowL: 14,
    armRFwd: -82, armRAbd: -6, elbowR: 10,
    legLFwd: 10, kneeL: 6, legRFwd: -12, kneeR: 8,
  },
  "抱臂": {
    chestPitch: 3, headYaw: -5,
    armLFwd: -38, armRFwd: -38, armLAbd: -34, armRAbd: -34,
    armLTwist: 40, armRTwist: -40, elbowL: 126, elbowR: 126,
  },
  "看手机": {
    // 上臂贴身垂下、小臂折起把手机举到胸前，低头看屏
    chestPitch: -6, headPitch: -28,
    armLAbd: -62, armRAbd: -62, armLFwd: -12, armRFwd: -12,
    armLTwist: 28, armRTwist: -28, elbowL: 118, elbowR: 118,
  },
};

/** XBot 自带的步行动画片段；静态姿势统一以绑定姿势为基准。 */
export const SKINNED_ANIMATION_POSES: Partial<Record<Scene3DPoseName, { clip: string; at: number }>> = {
  "行走": { clip: "walk", at: 0.45 },
  "跑步": { clip: "run", at: 0.3 },
};
