export type Scene3DMotionEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface Scene3DCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface Scene3DMotionKeyframe extends Scene3DCameraPose {
  id: string;
  name: string;
  /** 关键帧在镜头中的时间，单位秒。 */
  time: number;
}

export interface Scene3DMotionState {
  duration: number;
  easing: Scene3DMotionEasing;
  loop: boolean;
  showPath: boolean;
  keyframes: Scene3DMotionKeyframe[];
}

export type Scene3DMotionPreset =
  | "pushIn"
  | "pullOut"
  | "truckLeft"
  | "truckRight"
  | "orbitLeft"
  | "orbitRight"
  | "craneUp";

export const DEFAULT_SCENE_3D_MOTION: Scene3DMotionState = {
  duration: 5,
  easing: "easeInOut",
  loop: false,
  showPath: true,
  keyframes: [],
};

const MIN_DURATION = 0.5;
const MAX_DURATION = 60;
const MAX_COORDINATE = 10_000;
const MAX_KEYFRAME_NAME_LENGTH = 80;
const MAX_KEYFRAME_ID_LENGTH = 120;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tuple3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [
    clamp(finite(value[0], fallback[0]), -MAX_COORDINATE, MAX_COORDINATE),
    clamp(finite(value[1], fallback[1]), -MAX_COORDINATE, MAX_COORDINATE),
    clamp(finite(value[2], fallback[2]), -MAX_COORDINATE, MAX_COORDINATE),
  ];
}

function validEasing(value: unknown): Scene3DMotionEasing {
  return value === "linear" || value === "easeIn" || value === "easeOut" || value === "easeInOut"
    ? value
    : DEFAULT_SCENE_3D_MOTION.easing;
}

/** 读取旧存档或外部 JSON 时收紧数值，避免坏关键帧把相机送到 NaN。 */
export function normalizeScene3DMotion(value: unknown): Scene3DMotionState {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCENE_3D_MOTION, keyframes: [] };
  const raw = value as Partial<Scene3DMotionState>;
  const duration = clamp(finite(raw.duration, DEFAULT_SCENE_3D_MOTION.duration), MIN_DURATION, MAX_DURATION);
  const seenIds = new Set<string>();
  const keyframes = (Array.isArray(raw.keyframes) ? raw.keyframes : [])
    .slice(0, 120)
    .map((entry, index): Scene3DMotionKeyframe | null => {
      if (!entry || typeof entry !== "object") return null;
      const frame = entry as Partial<Scene3DMotionKeyframe>;
      const rawId = typeof frame.id === "string" && frame.id.trim() ? frame.id.trim() : `motion_${index}`;
      const requestedId = rawId.slice(0, MAX_KEYFRAME_ID_LENGTH);
      let id = requestedId;
      let suffix = index;
      while (seenIds.has(id)) {
        const suffixText = `_${suffix}`;
        id = `${requestedId.slice(0, MAX_KEYFRAME_ID_LENGTH - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      seenIds.add(id);
      const rawName = typeof frame.name === "string" ? frame.name.trim() : "";
      return {
        id,
        name: (rawName || `镜头 ${index + 1}`).slice(0, MAX_KEYFRAME_NAME_LENGTH),
        time: clamp(finite(frame.time, index === 0 ? 0 : duration), 0, duration),
        position: tuple3(frame.position, [0, 1.5, 4]),
        target: tuple3(frame.target, [0, 1, 0]),
        fov: clamp(finite(frame.fov, 50), 15, 120),
      };
    })
    .filter((frame): frame is Scene3DMotionKeyframe => !!frame)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  return {
    duration,
    easing: validEasing(raw.easing),
    loop: raw.loop === true,
    showPath: raw.showPath !== false,
    keyframes,
  };
}

function ease(value: number, easing: Scene3DMotionEasing): number {
  const t = clamp(value, 0, 1);
  if (easing === "easeIn") return t * t;
  if (easing === "easeOut") return 1 - (1 - t) * (1 - t);
  if (easing === "easeInOut") return t * t * (3 - 2 * t);
  return t;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function interpolateTuple(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  t: number,
  smooth: boolean,
): [number, number, number] {
  if (!smooth) {
    return [
      p1[0] + (p2[0] - p1[0]) * t,
      p1[1] + (p2[1] - p1[1]) * t,
      p1[2] + (p2[2] - p1[2]) * t,
    ];
  }
  return [
    catmullRom(p0[0], p1[0], p2[0], p3[0], t),
    catmullRom(p0[1], p1[1], p2[1], p3[1], t),
    catmullRom(p0[2], p1[2], p2[2], p3[2], t),
  ];
}

/** 已清洗状态的无分配入口，供每帧播放与路线采样使用。 */
export function normalizedScene3DMotionPoseAt(motion: Scene3DMotionState, seconds: number): Scene3DCameraPose | null {
  const frames = motion.keyframes;
  if (!frames.length) return null;
  if (frames.length === 1 || seconds <= frames[0].time) {
    const first = frames[0];
    return { position: [...first.position], target: [...first.target], fov: first.fov };
  }
  const last = frames[frames.length - 1];
  if (seconds >= last.time) return { position: [...last.position], target: [...last.target], fov: last.fov };

  let index = 0;
  for (let i = 0; i < frames.length - 1; i += 1) {
    if (seconds >= frames[i].time && seconds <= frames[i + 1].time) {
      index = i;
      break;
    }
  }
  const a = frames[index];
  const b = frames[index + 1];
  const span = Math.max(0.0001, b.time - a.time);
  const t = ease((seconds - a.time) / span, motion.easing);
  const before = frames[Math.max(0, index - 1)];
  const after = frames[Math.min(frames.length - 1, index + 2)];
  const smooth = frames.length > 2;
  return {
    position: interpolateTuple(before.position, a.position, b.position, after.position, t, smooth),
    target: interpolateTuple(before.target, a.target, b.target, after.target, t, smooth),
    fov: a.fov + (b.fov - a.fov) * t,
  };
}

/** 按关键帧时间插值相机；三帧以上使用平滑 Catmull-Rom 路径。 */
export function scene3DMotionPoseAt(motionValue: Scene3DMotionState, seconds: number): Scene3DCameraPose | null {
  return normalizedScene3DMotionPoseAt(normalizeScene3DMotion(motionValue), seconds);
}

export function sampleScene3DMotion(motion: Scene3DMotionState, count = 64): Scene3DCameraPose[] {
  const safe = normalizeScene3DMotion(motion);
  if (!safe.keyframes.length) return [];
  if (safe.keyframes.length === 1) {
    const pose = normalizedScene3DMotionPoseAt(safe, safe.keyframes[0].time);
    return pose ? [pose] : [];
  }
  const first = safe.keyframes[0].time;
  const last = safe.keyframes[safe.keyframes.length - 1].time;
  const steps = clamp(Math.round(finite(count, 64)), 2, 512);
  const poses: Scene3DCameraPose[] = [];
  for (let i = 0; i < steps; i += 1) {
    const pose = normalizedScene3DMotionPoseAt(safe, first + ((last - first) * i) / (steps - 1));
    if (pose) poses.push(pose);
  }
  return poses;
}

function rotatePointAroundY(
  point: [number, number, number],
  radians: number,
): [number, number, number] {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    point[0] * cosine + point[2] * sine,
    point[1],
    -point[0] * sine + point[2] * cosine,
  ];
}

/** Keep recorded camera paths in the same panorama-local coordinate frame. */
export function rotateScene3DMotionAroundY(
  motionValue: Scene3DMotionState,
  radians: number,
): Scene3DMotionState {
  const motion = normalizeScene3DMotion(motionValue);
  if (!Number.isFinite(radians) || Math.abs(radians) < 1e-12 || !motion.keyframes.length) return motion;
  return {
    ...motion,
    keyframes: motion.keyframes.map((frame) => ({
      ...frame,
      position: rotatePointAroundY(frame.position, radians),
      target: rotatePointAroundY(frame.target, radians),
    })),
  };
}

function add(a: [number, number, number], b: [number, number, number], scale = 1): [number, number, number] {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function normalized(
  from: [number, number, number],
  to: [number, number, number],
  fallback: [number, number, number],
): [number, number, number] {
  const x = to[0] - from[0], y = to[1] - from[1], z = to[2] - from[2];
  const length = Math.hypot(x, y, z);
  if (length < 1e-6) return [...fallback];
  return [x / length, y / length, z / length];
}

/** 从当前镜头生成常用影视运镜的起止姿态，供一键预设和后续手工微调。 */
export function scene3DMotionPresetPoses(preset: Scene3DMotionPreset, pose: Scene3DCameraPose): Scene3DCameraPose[] {
  const start: Scene3DCameraPose = {
    position: [...pose.position],
    target: [...pose.target],
    fov: pose.fov,
  };
  const forward = normalized(pose.position, pose.target, [0, 0, -1]);
  const distance = Math.max(0.75, Math.hypot(
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ));
  const amount = Math.min(2.5, Math.max(0.7, distance * 0.38));
  const right = normalized([0, 0, 0], [-forward[2], 0, forward[0]], [1, 0, 0]);
  let endPosition: [number, number, number] = [...pose.position];
  let endTarget: [number, number, number] = [...pose.target];

  if (preset === "pushIn") endPosition = add(endPosition, forward, amount);
  if (preset === "pullOut") endPosition = add(endPosition, forward, -amount);
  if (preset === "truckLeft" || preset === "truckRight") {
    const sign = preset === "truckLeft" ? -1 : 1;
    endPosition = add(endPosition, right, amount * sign);
    endTarget = add(endTarget, right, amount * sign);
  }
  if (preset === "craneUp") {
    endPosition = add(endPosition, [0, 1, 0], amount * 0.7);
    endTarget = add(endTarget, [0, 1, 0], amount * 0.25);
  }
  if (preset === "orbitLeft" || preset === "orbitRight") {
    const angle = (preset === "orbitLeft" ? 1 : -1) * Math.PI / 3;
    const x = pose.position[0] - pose.target[0];
    const z = pose.position[2] - pose.target[2];
    endPosition = [
      pose.target[0] + x * Math.cos(angle) - z * Math.sin(angle),
      pose.position[1],
      pose.target[2] + x * Math.sin(angle) + z * Math.cos(angle),
    ];
  }

  return [start, { position: endPosition, target: endTarget, fov: pose.fov }];
}
