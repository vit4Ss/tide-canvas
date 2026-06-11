import type * as THREE_NS from "three";

/** 角色（一具可摆姿的人物） */
export interface Scene3DCharacter {
  id: string;
  name: string;
  /** 身体颜色（hex 整数） */
  color: number;
  pos: [number, number, number];
  /** 朝向（绕 Y 弧度） */
  rotY: number;
  /** 整体等比缩放（0.3~3），缺省 1 */
  scale?: number;
  /** 模型类型：缺省视为 mannequin（兼容旧存档） */
  model?: "mannequin" | "xbot";
  /** 关节欧拉角 XYZ(弧度)：木偶用标准关节名，皮肤模型用骨骼名 */
  joints: Record<string, [number, number, number]>;
}

/** 机位（保存的拍摄视角） */
export interface Scene3DRig {
  id: string;
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/** 场景环境设置 */
export interface Scene3DEnv {
  /** 全景球水平旋转（角度 0~360） */
  panoRotY: number;
  /** 全景球半径（米） */
  panoRadius: number;
  /** 无全景时的天空颜色（#rrggbb） */
  skyColor: string;
  showLabels: boolean;
  showGround: boolean;
}

export const DEFAULT_ENV: Scene3DEnv = {
  panoRotY: 0,
  panoRadius: 50,
  skyColor: "#1e293b",
  showLabels: true,
  showGround: true,
};

/** 角色配色（按添加顺序轮换；与参考产品一致蓝/红/绿打头） */
export const CHARACTER_COLORS = [0x4f7df7, 0xef4444, 0x22c55e, 0xf59e0b, 0xa855f7, 0xec4899, 0x14b8a6, 0x94a3b8];

/** 按序号取角色名：角色A、角色B…（超过 26 个后接数字） */
export function characterNameByIndex(i: number): string {
  return i < 26 ? `角色${String.fromCharCode(65 + i)}` : `角色${i + 1}`;
}

/** 导演台持久化状态 v2（存进 CanvasNode.scene3d 的 JSON）：多角色 + 机位 + 环境 */
export interface Scene3DState {
  v: 2;
  characters: Scene3DCharacter[];
  rigs: Scene3DRig[];
  /** 导演视角相机（球坐标） */
  camera: { theta: number; phi: number; radius: number; target: [number, number, number] };
  light: { azimuth: number; elevation: number; intensity: number; ambient: number; preset: string };
  env: Scene3DEnv;
}

/** 旧版（单角色）状态，parseState 时自动迁移 */
interface Scene3DStateV1 {
  v: 1;
  joints: Record<string, [number, number, number]>;
  camera: { theta: number; phi: number; radius: number; target: [number, number, number] };
  light: { azimuth: number; elevation: number; intensity: number; ambient: number; preset: string };
}

/** 可点选/摆姿的关节（含中文标签，供 UI 显示） */
export const SELECTABLE_JOINTS = [
  "hips", "spine", "chest", "neck", "head",
  "upperArmL", "forearmL", "handL",
  "upperArmR", "forearmR", "handR",
  "thighL", "shinL", "footL",
  "thighR", "shinR", "footR",
] as const;
export type JointName = (typeof SELECTABLE_JOINTS)[number];
const SELECTABLE = new Set<string>(SELECTABLE_JOINTS);

export const JOINT_LABELS: Record<string, string> = {
  hips: "胯部", spine: "腰", chest: "胸", neck: "颈", head: "头",
  upperArmL: "左大臂", forearmL: "左小臂", handL: "左手",
  upperArmR: "右大臂", forearmR: "右小臂", handR: "右手",
  thighL: "左大腿", shinL: "左小腿", footL: "左脚",
  thighR: "右大腿", shinR: "右小腿", footR: "右脚",
};

interface BoneDef {
  name: string;
  parent: string | null;
  offset: [number, number, number];
  bone?: { to: [number, number, number]; radius: number };
  /** 附加体量（sphere 配 scale 即椭球；box 保留兼容）。 */
  shape?: { type: "sphere" | "box"; size: number | [number, number, number]; pos?: [number, number, number]; scale?: [number, number, number] };
}

// 静止姿态 = T-Pose：手臂沿 ±X 水平、躯干竖直、腿竖直向下。单位约等于米，整体高约 1.65。
// 造型走「素体人偶」风：椭球骨盆/胸肩/头，胶囊四肢 + 关节处球体过渡，手脚为圆润椭球。
const SKELETON: BoneDef[] = [
  { name: "hips", parent: null, offset: [0, 0.94, 0], shape: { type: "sphere", size: 0.125, pos: [0, 0.01, 0], scale: [1.1, 0.78, 0.72] } },
  { name: "spine", parent: "hips", offset: [0, 0.09, 0], bone: { to: [0, 0.15, 0], radius: 0.082 } },
  { name: "chest", parent: "spine", offset: [0, 0.15, 0], bone: { to: [0, 0.19, 0], radius: 0.1 }, shape: { type: "sphere", size: 0.108, pos: [0, 0.16, 0], scale: [1.32, 0.78, 0.74] } },
  { name: "neck", parent: "chest", offset: [0, 0.21, 0], bone: { to: [0, 0.07, 0], radius: 0.042 } },
  { name: "head", parent: "neck", offset: [0, 0.07, 0], shape: { type: "sphere", size: 0.104, pos: [0, 0.105, 0], scale: [0.92, 1.14, 0.98] } },

  { name: "upperArmL", parent: "chest", offset: [0.185, 0.16, 0], bone: { to: [0.26, 0, 0], radius: 0.05 } },
  { name: "forearmL", parent: "upperArmL", offset: [0.26, 0, 0], bone: { to: [0.24, 0, 0], radius: 0.043 } },
  { name: "handL", parent: "forearmL", offset: [0.24, 0, 0], shape: { type: "sphere", size: 0.048, pos: [0.06, 0, 0], scale: [1.45, 0.6, 0.88] } },

  { name: "upperArmR", parent: "chest", offset: [-0.185, 0.16, 0], bone: { to: [-0.26, 0, 0], radius: 0.05 } },
  { name: "forearmR", parent: "upperArmR", offset: [-0.26, 0, 0], bone: { to: [-0.24, 0, 0], radius: 0.043 } },
  { name: "handR", parent: "forearmR", offset: [-0.24, 0, 0], shape: { type: "sphere", size: 0.048, pos: [-0.06, 0, 0], scale: [1.45, 0.6, 0.88] } },

  { name: "thighL", parent: "hips", offset: [0.10, -0.05, 0], bone: { to: [0, -0.42, 0], radius: 0.072 } },
  { name: "shinL", parent: "thighL", offset: [0, -0.42, 0], bone: { to: [0, -0.40, 0], radius: 0.058 } },
  { name: "footL", parent: "shinL", offset: [0, -0.40, 0], shape: { type: "sphere", size: 0.054, pos: [0, -0.042, 0.075], scale: [0.82, 0.56, 2.2] } },

  { name: "thighR", parent: "hips", offset: [-0.10, -0.05, 0], bone: { to: [0, -0.42, 0], radius: 0.072 } },
  { name: "shinR", parent: "thighR", offset: [0, -0.42, 0], bone: { to: [0, -0.40, 0], radius: 0.058 } },
  { name: "footR", parent: "shinR", offset: [0, -0.40, 0], shape: { type: "sphere", size: 0.054, pos: [0, -0.042, 0.075], scale: [0.82, 0.56, 2.2] } },
];

export interface Mannequin {
  root: THREE_NS.Group;
  joints: Map<string, THREE_NS.Group>;
  jointBalls: THREE_NS.Mesh[];
  dispose: () => void;
}

/** 用基础几何体搭一个带关节层级的木偶（FK 摆姿用）。THREE 由调用方动态 import 后传入。 */
export function buildMannequin(THREE: typeof THREE_NS, color = 0xc7d2dc): Mannequin {
  const root = new THREE.Group();
  const joints = new Map<string, THREE_NS.Group>();
  const jointBalls: THREE_NS.Mesh[] = [];
  const geos: THREE_NS.BufferGeometry[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 });
  const ballMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.4, emissive: 0x1e3a8a, emissiveIntensity: 0.25 });
  const ballGeo = new THREE.SphereGeometry(0.038, 16, 12);
  geos.push(ballGeo);
  const up = new THREE.Vector3(0, 1, 0);

  for (const d of SKELETON) {
    const g = new THREE.Group();
    g.name = d.name;
    g.position.set(d.offset[0], d.offset[1], d.offset[2]);
    (d.parent ? joints.get(d.parent)! : root).add(g);
    joints.set(d.name, g);

    if (d.bone) {
      const to = new THREE.Vector3(d.bone.to[0], d.bone.to[1], d.bone.to[2]);
      const len = to.length();
      const cap = new THREE.CapsuleGeometry(d.bone.radius, Math.max(len - 2 * d.bone.radius, 0.001), 8, 16);
      geos.push(cap);
      const m = new THREE.Mesh(cap, bodyMat);
      m.castShadow = true;
      m.position.copy(to.clone().multiplyScalar(0.5));
      m.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, to.clone().normalize()));
      m.userData.joint = d.name;
      g.add(m);
      // 关节原点处补一颗球：肢体转动时衔接圆润，不露缝
      const jointGeo = new THREE.SphereGeometry(d.bone.radius * 1.02, 14, 12);
      geos.push(jointGeo);
      const js = new THREE.Mesh(jointGeo, bodyMat);
      js.castShadow = true;
      js.userData.joint = d.name;
      g.add(js);
    }
    if (d.shape) {
      let geo: THREE_NS.BufferGeometry;
      if (d.shape.type === "sphere") geo = new THREE.SphereGeometry(d.shape.size as number, 24, 18);
      else { const s = d.shape.size as [number, number, number]; geo = new THREE.BoxGeometry(s[0], s[1], s[2]); }
      geos.push(geo);
      const m = new THREE.Mesh(geo, bodyMat);
      m.castShadow = true;
      if (d.shape.pos) m.position.set(d.shape.pos[0], d.shape.pos[1], d.shape.pos[2]);
      if (d.shape.scale) m.scale.set(d.shape.scale[0], d.shape.scale[1], d.shape.scale[2]);
      m.userData.joint = d.name;
      g.add(m);
    }
    if (SELECTABLE.has(d.name)) {
      const ball = new THREE.Mesh(ballGeo, ballMat);
      ball.userData.joint = d.name;
      jointBalls.push(ball);
      g.add(ball);
    }
  }

  const dispose = () => {
    for (const geo of geos) geo.dispose();
    bodyMat.dispose();
    ballMat.dispose();
  };
  return { root, joints, jointBalls, dispose };
}

/** 姿态预设：关节欧拉角(弧度)。未列出的关节归零。可用 gizmo 进一步微调。 */
export const POSE_PRESETS: Record<string, Record<string, [number, number, number]>> = {
  "T-Pose": {},
  "站立": {
    upperArmL: [0, 0, -1.45], upperArmR: [0, 0, 1.45],
    forearmL: [0, 0, -0.12], forearmR: [0, 0, 0.12],
  },
  "行走": {
    spine: [0, 0.06, 0],
    thighL: [0.5, 0, 0], shinL: [-0.35, 0, 0],
    thighR: [-0.5, 0, 0], shinR: [-0.1, 0, 0],
    upperArmL: [-0.5, 0, -1.4], forearmL: [-0.3, 0, -0.1],
    upperArmR: [0.5, 0, 1.4], forearmR: [-0.3, 0, 0.1],
  },
  "坐": {
    thighL: [-1.5, 0, 0.05], shinL: [1.5, 0, 0],
    thighR: [-1.5, 0, -0.05], shinR: [1.5, 0, 0],
    upperArmL: [0, 0, -1.3], forearmL: [-0.5, 0, -0.1],
    upperArmR: [0, 0, 1.3], forearmR: [-0.5, 0, 0.1],
  },
};

export const POSE_NAMES = ["站立", "行走", "坐", "T-Pose"] as const;

/** 应用姿态预设到关节（未列出的归零）。 */
export function applyPose(joints: Map<string, THREE_NS.Group>, name: string) {
  const preset = POSE_PRESETS[name] || {};
  for (const j of SELECTABLE_JOINTS) {
    const g = joints.get(j);
    if (!g) continue;
    const r = preset[j] || [0, 0, 0];
    g.rotation.set(r[0], r[1], r[2]);
  }
}

export const LIGHT_PRESETS: Record<string, { ambient: number; intensity: number; azimuth: number; elevation: number; bg: number }> = {
  "自然光": { ambient: 0.55, intensity: 1.15, azimuth: 0.7, elevation: 0.9, bg: 0x1e293b },
  "工作室": { ambient: 0.8, intensity: 1.0, azimuth: 0.5, elevation: 1.0, bg: 0x111827 },
  "戏剧": { ambient: 0.12, intensity: 1.7, azimuth: 1.3, elevation: 0.5, bg: 0x0a0a0a },
  "黄昏": { ambient: 0.4, intensity: 1.35, azimuth: 2.4, elevation: 0.28, bg: 0x2a1b2e },
  "夜晚": { ambient: 0.22, intensity: 0.85, azimuth: 1.9, elevation: 0.7, bg: 0x0b1220 },
};

export const LIGHT_NAMES = ["自然光", "工作室", "戏剧", "黄昏", "夜晚"] as const;

/** 由方位角(az)、仰角(el)、半径(r) 求方向光位置 */
export function lightPositionFromAngles(THREE: typeof THREE_NS, az: number, el: number, r = 6): THREE_NS.Vector3 {
  return new THREE.Vector3(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
}

// ===== 统一角色接口：木偶（程序几何）与 Mixamo 皮肤模型双实现 =====

export interface Figure {
  root: THREE_NS.Group;
  model: "mannequin" | "xbot";
  /** 标准关节名 → 可旋转对象（木偶为 Group，皮肤模型为骨骼） */
  joints: Map<string, THREE_NS.Object3D>;
  jointBalls: THREE_NS.Mesh[];
  /** 可点选的身体网格（皮肤模型用隐形代理胶囊，raycast 稳定且便宜） */
  meshes: THREE_NS.Mesh[];
  poseNames: string[];
  applyPosePreset: (name: string) => void;
  resetPose: () => void;
  /** 语义姿势滑杆：以最近一次预设/还原为基底叠加角度（度） */
  setPoseParam: (key: string, deg: number) => void;
  getPoseParams: () => Record<string, number>;
  /** 采集当前关节旋转（键即存档键） */
  collectRotations: () => Record<string, [number, number, number]>;
  /** 应用存档旋转，返回成功匹配的关节数（0 = 键完全不匹配，如旧木偶存档套皮肤模型） */
  applyRotations: (rec: Record<string, [number, number, number]>) => number;
  dispose: () => void;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

// ===== 语义姿势滑杆（参考竞品「姿势调节」面板）：按部位分组，轴为绑定期世界方向 =====
// 角色绑定朝向 +Z（正面）、上方 +Y、左手侧 +X；木偶与 Mixamo 骨架同约定，共用一张表。

export interface PoseSliderDef {
  key: string;
  label: string;
  /** 标准关节名（Figure.joints 的键） */
  joint: string;
  /** 语义旋转轴（绑定期世界方向，构建时换算为父骨骼局部轴） */
  axis: [number, number, number];
  min: number;
  max: number;
}

export interface PoseSliderGroup {
  title: string;
  items: PoseSliderDef[];
}

// 前/后语义统一约定：负值向前、正值向后（前倾/点头/前举/前抬的轴均按此取向）。
export const POSE_SLIDER_GROUPS: PoseSliderGroup[] = [
  { title: "身体", items: [
    { key: "hipsPitch", label: "前倾", joint: "hips", axis: [-1, 0, 0], min: -45, max: 45 },
    { key: "hipsRoll", label: "侧倾", joint: "hips", axis: [0, 0, 1], min: -30, max: 30 },
  ] },
  { title: "躯干", items: [
    { key: "chestPitch", label: "前倾", joint: "chest", axis: [-1, 0, 0], min: -45, max: 45 },
    { key: "chestYaw", label: "扭转", joint: "chest", axis: [0, 1, 0], min: -60, max: 60 },
    { key: "chestRoll", label: "侧倾", joint: "chest", axis: [0, 0, 1], min: -30, max: 30 },
  ] },
  { title: "头部", items: [
    { key: "headPitch", label: "点头", joint: "head", axis: [-1, 0, 0], min: -40, max: 40 },
    { key: "headYaw", label: "转头", joint: "head", axis: [0, 1, 0], min: -70, max: 70 },
    { key: "headRoll", label: "歪头", joint: "head", axis: [0, 0, 1], min: -30, max: 30 },
  ] },
  { title: "左肩", items: [
    { key: "armLFwd", label: "前举", joint: "upperArmL", axis: [0, 1, 0], min: -90, max: 90 },
    { key: "armLAbd", label: "外展", joint: "upperArmL", axis: [0, 0, 1], min: -90, max: 45 },
    { key: "armLTwist", label: "扭转", joint: "upperArmL", axis: [1, 0, 0], min: -80, max: 80 },
  ] },
  { title: "右肩", items: [
    { key: "armRFwd", label: "前举", joint: "upperArmR", axis: [0, -1, 0], min: -90, max: 90 },
    { key: "armRAbd", label: "外展", joint: "upperArmR", axis: [0, 0, -1], min: -90, max: 45 },
    { key: "armRTwist", label: "扭转", joint: "upperArmR", axis: [-1, 0, 0], min: -80, max: 80 },
  ] },
  { title: "左肘", items: [
    { key: "elbowL", label: "弯曲", joint: "forearmL", axis: [0, -1, 0], min: 0, max: 140 },
  ] },
  { title: "右肘", items: [
    { key: "elbowR", label: "弯曲", joint: "forearmR", axis: [0, 1, 0], min: 0, max: 140 },
  ] },
  { title: "左腿", items: [
    { key: "legLFwd", label: "前抬", joint: "thighL", axis: [1, 0, 0], min: -90, max: 45 },
    { key: "legLAbd", label: "外展", joint: "thighL", axis: [0, 0, 1], min: -20, max: 60 },
    { key: "legLTwist", label: "扭转", joint: "thighL", axis: [0, -1, 0], min: -45, max: 45 },
  ] },
  { title: "右腿", items: [
    { key: "legRFwd", label: "前抬", joint: "thighR", axis: [1, 0, 0], min: -90, max: 45 },
    { key: "legRAbd", label: "外展", joint: "thighR", axis: [0, 0, -1], min: -20, max: 60 },
    { key: "legRTwist", label: "扭转", joint: "thighR", axis: [0, 1, 0], min: -45, max: 45 },
  ] },
  { title: "左膝", items: [
    { key: "kneeL", label: "弯曲", joint: "shinL", axis: [1, 0, 0], min: 0, max: 140 },
  ] },
  { title: "右膝", items: [
    { key: "kneeR", label: "弯曲", joint: "shinR", axis: [1, 0, 0], min: 0, max: 140 },
  ] },
];

/**
 * 姿势滑杆引擎：构建期（绑定姿势）把每条语义世界轴换算为「父骨骼局部空间」常量轴，
 * 之后 newLocal = Π旋转(axisP, 角度) × 基底Local。轴固定在父级局部空间 ——
 * 父骨骼后续转动时子关节语义轴自然跟随（肩抬起后肘部「弯曲」仍沿手臂方向）。
 * 基底 = 最近一次预设/重置/存档还原时的姿势，滑杆在其上叠加。
 */
function makePoseEngine(THREE: typeof THREE_NS, joints: Map<string, THREE_NS.Object3D>) {
  interface Entry { def: PoseSliderDef; bone: THREE_NS.Object3D; axisP: THREE_NS.Vector3 }
  const entries: Entry[] = [];
  const q = new THREE.Quaternion();
  for (const g of POSE_SLIDER_GROUPS) {
    for (const def of g.items) {
      const bone = joints.get(def.joint);
      if (!bone || !bone.parent) continue;
      bone.parent.getWorldQuaternion(q);
      const axisP = new THREE.Vector3(...def.axis).applyQuaternion(q.clone().invert()).normalize();
      entries.push({ def, bone, axisP });
    }
  }
  let base = new Map<THREE_NS.Object3D, THREE_NS.Quaternion>();
  const params: Record<string, number> = {};
  const captureBase = () => {
    base = new Map();
    for (const { bone } of entries) {
      if (!base.has(bone)) base.set(bone, bone.quaternion.clone());
    }
    for (const k of Object.keys(params)) params[k] = 0;
  };
  const apply = () => {
    const byBone = new Map<THREE_NS.Object3D, THREE_NS.Quaternion>();
    for (const { def, bone, axisP } of entries) {
      if (!byBone.has(bone)) byBone.set(bone, new THREE.Quaternion());
      const a = THREE.MathUtils.degToRad(params[def.key] ?? 0);
      if (a) byBone.get(bone)!.multiply(new THREE.Quaternion().setFromAxisAngle(axisP, a));
    }
    for (const [bone, rq] of byBone) {
      const b = base.get(bone);
      if (b) bone.quaternion.copy(rq).multiply(b);
    }
  };
  return {
    captureBase,
    setParam: (key: string, deg: number) => { params[key] = deg; apply(); },
    getParams: () => ({ ...params }),
  };
}

/** 木偶 Figure：包装 buildMannequin + 欧拉姿态预设表 */
export function buildMannequinFigure(THREE: typeof THREE_NS, color?: number): Figure {
  const man = buildMannequin(THREE, color);
  const joints = new Map<string, THREE_NS.Object3D>(man.joints);
  const meshes: THREE_NS.Mesh[] = [];
  man.root.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (m.isMesh && !man.jointBalls.includes(m)) meshes.push(m);
  });
  const engine = makePoseEngine(THREE, joints);
  engine.captureBase();
  return {
    root: man.root,
    model: "mannequin",
    joints,
    jointBalls: man.jointBalls,
    meshes,
    poseNames: [...POSE_NAMES],
    applyPosePreset: (name) => { applyPose(man.joints, name); engine.captureBase(); },
    resetPose: () => { applyPose(man.joints, "T-Pose"); engine.captureBase(); },
    setPoseParam: engine.setParam,
    getPoseParams: engine.getParams,
    collectRotations: () => {
      const rec: Record<string, [number, number, number]> = {};
      for (const j of SELECTABLE_JOINTS) {
        const g = man.joints.get(j);
        if (g) rec[j] = [round4(g.rotation.x), round4(g.rotation.y), round4(g.rotation.z)];
      }
      return rec;
    },
    applyRotations: (rec) => {
      let applied = 0;
      for (const [k, r] of Object.entries(rec)) {
        if (!isFiniteEuler(r)) continue;
        const g = man.joints.get(k);
        if (g) { g.rotation.set(r[0], r[1], r[2]); applied++; }
      }
      engine.captureBase();
      return applied;
    },
    dispose: man.dispose,
  };
}

/** 历史坏存档可能混入 NaN/Infinity，应用前过滤 */
function isFiniteEuler(r?: [number, number, number]): r is [number, number, number] {
  return !!r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2]);
}

/** 标准关节名 → Mixamo 骨骼名（实际骨骼可能带 mixamorig:/mixamorig 前缀，索引时已剥掉） */
const MIXAMO_JOINT_MAP: Record<string, string> = {
  hips: "Hips", spine: "Spine", chest: "Spine2", neck: "Neck", head: "Head",
  upperArmL: "LeftArm", forearmL: "LeftForeArm", handL: "LeftHand",
  upperArmR: "RightArm", forearmR: "RightForeArm", handR: "RightHand",
  thighL: "LeftUpLeg", shinL: "LeftLeg", footL: "LeftFoot",
  thighR: "RightUpLeg", shinR: "RightLeg", footR: "RightFoot",
};

/** 皮肤模型姿态预设：采样模型内置动画的某一帧（Xbot 自带 idle/walk/run/sad_pose/sneak_pose） */
const SKINNED_POSE_PRESETS: Record<string, { clip: string; at: number }> = {
  "站立": { clip: "idle", at: 0 },
  "行走": { clip: "walk", at: 0.45 },
  "奔跑": { clip: "run", at: 0.3 },
  "低落": { clip: "sad_pose", at: 0.5 },
  "潜行": { clip: "sneak_pose", at: 0.5 },
};

export interface SkinnedAsset {
  scene: THREE_NS.Group;
  animations: THREE_NS.AnimationClip[];
}

/**
 * Mixamo 皮肤模型 Figure：克隆模板（SkeletonUtils.clone 由调用方传入）→ 按角色染色 →
 * 关节球挂骨骼（按世界缩放反补偿大小、关深度测试避免埋进身体）→ 动画帧采样当姿态预设。
 * 几何体/骨架与模板共享，由编辑器统一释放模板；本实例只释放克隆出的材质与代理体。
 */
export function buildSkinnedFigure(
  THREE: typeof THREE_NS,
  cloneFn: (root: THREE_NS.Object3D) => THREE_NS.Object3D,
  asset: SkinnedAsset,
  color = 0xc7d2dc,
): Figure {
  const root = new THREE.Group();
  const model = cloneFn(asset.scene) as THREE_NS.Group;
  root.add(model);

  // 骨骼索引（剥掉 mixamorig 前缀）
  const bones = new Map<string, THREE_NS.Bone>();
  model.traverse((o) => {
    const b = o as THREE_NS.Bone;
    if (b.isBone) bones.set(b.name.replace(/^mixamorig:?/i, ""), b);
  });

  // 统一身高 ~1.7m：用头顶骨的世界 Y 测真实渲染身高。
  // 不能用几何包围盒（Box3.setFromObject）——蒙皮网格的包围盒取自绑定空间顶点，
  // 与骨骼驱动的实际渲染尺寸无关，会量出离谱的"身高"导致模型缩放失控。
  root.updateMatrixWorld(true);
  const headTop = bones.get("HeadTop_End") ?? bones.get("Head");
  if (headTop) {
    const v = new THREE.Vector3();
    headTop.getWorldPosition(v);
    if (v.y > 0.1) model.scale.setScalar(1.7 / v.y);
  }
  const joints = new Map<string, THREE_NS.Object3D>();
  for (const [ours, mix] of Object.entries(MIXAMO_JOINT_MAP)) {
    const b = bones.get(mix);
    if (b) joints.set(ours, b);
  }

  // 材质克隆 + 染色（关节件压暗保留机械结构感）
  const clonedMats: THREE_NS.Material[] = [];
  const tint = new THREE.Color(color);
  model.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false; // 骨骼动画包围盒不准，避免误剔除
    const src = m.material as THREE_NS.MeshStandardMaterial;
    const mat = src.clone();
    mat.color = mat.name.toLowerCase().includes("joint") ? tint.clone().multiplyScalar(0.35) : tint.clone();
    clonedMats.push(mat);
    m.material = mat;
  });

  // 绑定姿势快照（位置+旋转+缩放）：重置 / 采样后归位用
  const bindPose = new Map<THREE_NS.Bone, { p: THREE_NS.Vector3; q: THREE_NS.Quaternion; s: THREE_NS.Vector3 }>();
  for (const b of bones.values()) bindPose.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });

  // 关节球
  root.updateMatrixWorld(true);
  const ballGeo = new THREE.SphereGeometry(1, 12, 10);
  const ballMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false, transparent: true, opacity: 0.9 });
  const jointBalls: THREE_NS.Mesh[] = [];
  const ws = new THREE.Vector3();
  for (const [ours, bone] of joints) {
    bone.getWorldScale(ws);
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.scale.setScalar(0.03 / Math.max(ws.x, 1e-6));
    ball.renderOrder = 998;
    ball.userData.joint = ours;
    jointBalls.push(ball);
    bone.add(ball);
  }

  // 隐形代理胶囊：整体点选目标（视觉不可见但可被 raycast）
  const proxyGeo = new THREE.CapsuleGeometry(0.32, 1.05, 4, 8);
  const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.position.y = 0.88;
  root.add(proxy);

  // 动画帧采样：每次用一次性 mixer 写入目标帧后直接丢弃 ——
  // 刻意不调 stop()/uncache()（停用动作可能触发绑定还原“原始状态”，把姿势部分回滚成畸形），
  // 采样后恢复骨骼位置与缩放（行走等剪辑带髋部位移，个别导出还带缩放轨），只保留旋转。
  const restoreBindPosScale = () => {
    for (const [b, bp] of bindPose) { b.position.copy(bp.p); b.scale.copy(bp.s); }
  };
  const engine = makePoseEngine(THREE, joints);
  engine.captureBase();
  const applyPosePreset = (name: string) => {
    const def = SKINNED_POSE_PRESETS[name];
    const clip = def ? asset.animations.find((c) => c.name === def.clip) : null;
    if (!def || !clip) return;
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixer.update(clip.duration * def.at);
    restoreBindPosScale();
    engine.captureBase();
  };
  const resetPose = () => {
    for (const [b, bp] of bindPose) { b.position.copy(bp.p); b.quaternion.copy(bp.q); b.scale.copy(bp.s); }
    engine.captureBase();
  };

  return {
    root,
    model: "xbot",
    joints,
    jointBalls,
    meshes: [proxy],
    poseNames: Object.keys(SKINNED_POSE_PRESETS),
    applyPosePreset,
    resetPose,
    setPoseParam: engine.setParam,
    getPoseParams: engine.getParams,
    collectRotations: () => {
      const rec: Record<string, [number, number, number]> = {};
      for (const [key, b] of bones) rec[key] = [round4(b.rotation.x), round4(b.rotation.y), round4(b.rotation.z)];
      return rec;
    },
    applyRotations: (rec) => {
      let applied = 0;
      for (const [k, r] of Object.entries(rec)) {
        if (!isFiniteEuler(r)) continue;
        // 只认骨骼名（皮肤模型存档）。旧木偶存档的关节键不迁移：两套骨架轴系不同，硬套会出畸形姿势，
        // 跳过即保持绑定姿势，位置/朝向/颜色仍按存档还原（调用方按返回 0 兜底应用默认站姿）。
        const target = bones.get(k.replace(/^mixamorig:?/i, ""));
        if (target) { target.rotation.set(r[0], r[1], r[2]); applied++; }
      }
      engine.captureBase();
      return applied;
    },
    dispose: () => {
      for (const m of clonedMats) m.dispose();
      ballGeo.dispose();
      ballMat.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
    },
  };
}

/** 头顶名字标签（Canvas 纹理 Sprite，始终面向相机、不被遮挡） */
export function makeLabelSprite(THREE: typeof THREE_NS, text: string): { sprite: THREE_NS.Sprite; dispose: () => void } {
  const canvas = document.createElement("canvas");
  const measure = canvas.getContext("2d")!;
  const font = "600 40px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width) + 28;
  const h = 60;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 8;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const H = 0.17; // 世界高度（米）
  sprite.scale.set((H * w) / h, H, 1);
  sprite.renderOrder = 999;
  return { sprite, dispose: () => { tex.dispose(); mat.dispose(); } };
}

/** 防御性解析持久化状态：v2 原样返回，v1 自动迁移为单角色 v2，其他返回 null */
export function parseState(json?: string): Scene3DState | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json);
    if (!s || !s.camera || !s.light) return null;
    if (s.v === 2 && Array.isArray(s.characters) && Array.isArray(s.rigs)) {
      return { ...s, env: { ...DEFAULT_ENV, ...(s.env ?? {}) } } as Scene3DState;
    }
    if (s.v === 1 && s.joints) {
      const v1 = s as Scene3DStateV1;
      return {
        v: 2,
        characters: [{
          id: "c_legacy",
          name: characterNameByIndex(0),
          color: CHARACTER_COLORS[0],
          pos: [0, 0, 0],
          rotY: 0,
          joints: v1.joints,
        }],
        rigs: [],
        camera: v1.camera,
        light: v1.light,
        env: { ...DEFAULT_ENV },
      };
    }
    return null;
  } catch {
    return null;
  }
}
