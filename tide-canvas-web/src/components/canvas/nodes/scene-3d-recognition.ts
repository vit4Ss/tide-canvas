import type { AiModelVO } from "@/types/ai";
import type { CharacterPresetKey } from "./scene-3d-director-presets";

/** 识图模型选择：后台配置的文本主模型（「AI 优化主模型」，全局唯一）优先——
 *  管理员显式指定的主力模型通常也是视觉理解最强的；未配置或主模型不支持
 *  skill_text_completion 时，交给调用方传入的回退挑选（分镜解析的启发式，
 *  显式视觉能力优先）。回退以参数注入，模块保持无别名依赖可被 Node 直测。 */
export function selectRecognitionModel(
  models: readonly AiModelVO[],
  fallback: (models: readonly AiModelVO[]) => AiModelVO | undefined,
): AiModelVO | undefined {
  const primary = models.find((candidate) => {
    if (candidate.type !== "text") return false;
    if (candidate.supportedHandlers?.length && !candidate.supportedHandlers.includes("skill_text_completion")) return false;
    try {
      return (JSON.parse(candidate.config || "{}") as { aiOptimizePrimary?: boolean }).aiOptimizePrimary === true;
    } catch {
      return false;
    }
  });
  return primary ?? fallback(models);
}

export interface RecognizedBlockingCharacter {
  name: string;
  preset: CharacterPresetKey;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

/** 白膜物体：米制真实尺寸与放置变换，导入时换算为道具几何的缩放。 */
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

const DEG = Math.PI / 180;

function finite(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function wrap01(u: number): number {
  return ((u % 1) + 1) % 1;
}

function wrapDeg(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
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

function characterBase(record: Record<string, unknown>, index: number): {
  name: string;
  preset: CharacterPresetKey;
  scale: number;
} {
  const preset = typeof record.preset === "string" && PRESETS.has(record.preset as CharacterPresetKey)
    ? record.preset as CharacterPresetKey
    : "standard-male";
  return {
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 40) : `角色${index + 1}`,
    preset,
    scale: finite(record.scale, 1, 0.5, 1.8),
  };
}

function parseCharacterRows(value: unknown): RecognizedBlockingCharacter[] {
  const rows = Array.isArray(value) ? value.slice(0, 18) : [];
  return rows.flatMap((row, index): RecognizedBlockingCharacter[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    return [{
      ...characterBase(record, index),
      x: finite(record.x, 0, -4, 4),
      z: finite(record.z, 0, -4, 4),
      rotation: finite(record.rotation, 0, -180, 180),
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

// ===== 等距柱状全景反投影 =====
// 全景图的像素位置直接对应视线角度：水平 u → 方位角，垂直 v → 俯仰角。
// 已知相机离地高度后，任何接地点的水平距离都是解析解 d = h / tan(俯角)，
// 因此模型只负责在图上标归一化坐标，所有米数由这里的确定性几何计算。

const PANO_MIN_GROUND_PITCH = 3 * DEG; // 地平线附近距离发散，禁用
const PANO_MAX_PITCH = 85 * DEG;
const PANO_MIN_DISTANCE = 0.3;
const PANO_MAX_DISTANCE = 12;
const DEFAULT_CAMERA_HEIGHT = 1.6;
const DOOR_HEIGHT_METERS = 2.1;
const WALL_THICKNESS = 0.15;

/** u（0=最左）→ 方位角弧度；画面水平中心为正前方 -z。 */
function panoAzimuthRad(u: number): number {
  return (wrap01(u) - 0.5) * 2 * Math.PI;
}

/** v（0=顶）→ 俯角弧度（正=地平线以下）。 */
function panoPitchRad(v: number): number {
  const pitch = (v - 0.5) * Math.PI;
  return Math.min(PANO_MAX_PITCH, Math.max(-PANO_MAX_PITCH, pitch));
}

interface PanoGround { x: number; z: number; distance: number; azimuth: number }

/** 接地点反投影：v 必须在地平线以下（v>0.5+ε），否则返回 null。 */
function solvePanoGround(u: number, v: number, cameraHeight: number): PanoGround | null {
  const pitch = panoPitchRad(v);
  if (pitch < PANO_MIN_GROUND_PITCH) return null;
  const azimuth = panoAzimuthRad(u);
  const distance = Math.min(PANO_MAX_DISTANCE, Math.max(PANO_MIN_DISTANCE, cameraHeight / Math.tan(pitch)));
  return { x: distance * Math.sin(azimuth), z: -distance * Math.cos(azimuth), distance, azimuth };
}

/** 距观察点 distance 处、像素行 v 对应的离地高度（米）。 */
function panoHeightAt(v: number, distance: number, cameraHeight: number): number {
  return cameraHeight - distance * Math.tan(panoPitchRad(v));
}

/** 物体左右边缘（含跨接缝环绕）→ 中心 u 与水平张角（弧度）。 */
function panoSpan(u1: number, u2: number): { center: number; spanRad: number } {
  const a = wrap01(u1);
  let b = wrap01(u2);
  if (b < a) b += 1;
  const span = Math.min(0.5, Math.max(0.002, b - a));
  return { center: wrap01(a + span / 2), spanRad: span * 2 * Math.PI };
}

interface ShellVertex { x: number; z: number }
interface WallSegment { p: ShellVertex; q: ShellVertex }

/** 原点出发沿方位角的射线与墙段集合的最近交点距离。
 *  墙是分段的（开口处留空），射线落在开口方位时返回 null。 */
function shellDistanceAt(azimuth: number, segments: readonly WallSegment[]): number | null {
  const dirX = Math.sin(azimuth);
  const dirZ = -Math.cos(azimuth);
  let best: number | null = null;
  for (const { p, q } of segments) {
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const det = ex * dirZ - ez * dirX;
    if (Math.abs(det) < 1e-9) continue;
    const t = (ex * p.z - ez * p.x) / det;
    const s = (dirX * p.z - dirZ * p.x) / det;
    if (t > 0.05 && s >= -0.02 && s <= 1.02 && (best === null || t < best)) best = t;
  }
  return best;
}

function solveRunPoints(value: unknown, cameraHeight: number, sortByAzimuth: boolean): PanoGround[] {
  const rows = Array.isArray(value) ? value.slice(0, 20) : [];
  const solved: PanoGround[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const u = Number(record.u);
    const v = Number(record.v);
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const ground = solvePanoGround(u, v, cameraHeight);
    if (!ground || ground.distance < 1) continue;
    solved.push(ground);
  }
  if (!sortByAzimuth) return solved;
  solved.sort((a, b) => a.azimuth - b.azimuth);
  // 相邻方位角过近的点合并（保留更近的墙脚），避免退化墙段
  const merged: PanoGround[] = [];
  for (const point of solved) {
    const last = merged[merged.length - 1];
    if (last && point.azimuth - last.azimuth < 4 * DEG) {
      if (point.distance < last.distance) merged[merged.length - 1] = point;
      continue;
    }
    merged.push(point);
  }
  return merged;
}

/** 分段墙标注 → 墙段集合。每段连续实体墙是一组有序点（组内相邻点连线），
 *  组与组之间不连接也不闭合——走廊、门洞、玻璃开口处保持空白。
 *  兼容旧 floorLine：视为按方位角排序的单段（同样不再强行闭合）。 */
function solveWallSegments(room: Record<string, unknown>, cameraHeight: number): WallSegment[] {
  const runs: PanoGround[][] = [];
  if (Array.isArray(room.wallRuns)) {
    for (const run of room.wallRuns.slice(0, 8)) {
      const points = solveRunPoints(run, cameraHeight, false);
      if (points.length >= 2) runs.push(points);
    }
  }
  if (!runs.length && Array.isArray(room.floorLine)) {
    const legacy = solveRunPoints(room.floorLine, cameraHeight, true);
    if (legacy.length >= 2) runs.push(legacy);
  }
  const segments: WallSegment[] = [];
  for (const run of runs) {
    for (let index = 0; index < run.length - 1 && segments.length < 16; index += 1) {
      const p = run[index];
      const q = run[index + 1];
      if (Math.hypot(q.x - p.x, q.z - p.z) < 0.3) continue;
      segments.push({ p, q });
    }
  }
  return segments;
}

/** 墙段 → 墙体块（长度沿段方向，厚度统一）。 */
function shellWalls(segments: readonly WallSegment[], wallHeight: number): RecognizedWhiteboxProp[] {
  return segments.map(({ p, q }, index) => {
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    return {
      name: `墙${index + 1}`,
      kind: "box" as const,
      x: (p.x + q.x) / 2,
      y: wallHeight / 2,
      z: (p.z + q.z) / 2,
      // rotation.y=α 把体块局部 +x 转到 (cosα, -sinα)，对齐段方向需 α=atan2(-dz, dx)
      rotation: wrapDeg(Math.atan2(-dz, dx) / DEG),
      w: Math.hypot(dx, dz),
      h: wallHeight,
      d: WALL_THICKNESS,
    };
  });
}

/** 白膜地板由程序生成：覆盖所有体块占地范围的薄板（顶面略高于舞台地面，
 *  避免和阴影捕捉面/网格 z-fighting）。模型被禁止输出地面体块。 */
const FLOOR_SLAB_THICKNESS = 0.1;

function appendFloorSlab(props: RecognizedWhiteboxProp[]): RecognizedWhiteboxProp[] {
  if (!props.length) return props;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const prop of props) {
    const extent = Math.max(prop.w, prop.d) / 2;
    minX = Math.min(minX, prop.x - extent);
    maxX = Math.max(maxX, prop.x + extent);
    minZ = Math.min(minZ, prop.z - extent);
    maxZ = Math.max(maxZ, prop.z + extent);
  }
  const margin = 0.6;
  return [...props, {
    name: "地板",
    kind: "box",
    x: (minX + maxX) / 2,
    // 顶面高出舞台地面1厘米：盖住网格线又不会让人物脚踝陷进板里
    y: 0.01 - FLOOR_SLAB_THICKNESS / 2,
    z: (minZ + maxZ) / 2,
    rotation: 0,
    w: Math.min(26, Math.max(4, maxX - minX + margin * 2)),
    h: FLOOR_SLAB_THICKNESS,
    d: Math.min(26, Math.max(4, maxZ - minZ + margin * 2)),
  }];
}

interface AnnotatedObjectRow {
  record: Record<string, unknown>;
  kind: RecognizedWhiteboxProp["kind"];
  name: string;
  center: number;
  spanRad: number;
  vBottom: number;
  vTop: number;
  grounded: boolean;
  againstWall: boolean;
}

function readAnnotatedObjectRows(value: unknown): AnnotatedObjectRow[] {
  const rows = Array.isArray(value) ? value.slice(0, 25) : [];
  return rows.flatMap((row, index): AnnotatedObjectRow[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const u1 = Number(record.u1);
    const u2 = Number(record.u2);
    const vBottom = Number(record.vBottom);
    const vTop = Number(record.vTop);
    if (!Number.isFinite(u1) || !Number.isFinite(u2) || !Number.isFinite(vBottom) || !Number.isFinite(vTop)) return [];
    const { center, spanRad } = panoSpan(u1, u2);
    return [{
      record,
      kind: record.kind === "sphere" || record.kind === "cylinder" ? record.kind : "box",
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 40) : `物体${index + 1}`,
      center,
      spanRad,
      vBottom,
      vTop,
      grounded: record.grounded !== false,
      againstWall: record.againstWall === true,
    }];
  });
}

/** 用门高先验反推相机高度：解算出的门高与 2.1 米的比值即整体尺度误差。 */
function calibrateCameraHeight(objects: readonly AnnotatedObjectRow[], initialHeight: number): number {
  const factors: number[] = [];
  for (const row of objects) {
    if (!row.grounded || !/门/.test(row.name)) continue;
    const ground = solvePanoGround(row.center, row.vBottom, initialHeight);
    if (!ground) continue;
    const doorHeight = panoHeightAt(row.vTop, ground.distance, initialHeight);
    if (doorHeight > 0.8 && doorHeight < 6) factors.push(DOOR_HEIGHT_METERS / doorHeight);
  }
  if (!factors.length) return initialHeight;
  const factor = Math.min(1.35, Math.max(0.75, factors.reduce((sum, value) => sum + value, 0) / factors.length));
  return Math.min(2.4, Math.max(1.0, initialHeight * factor));
}

function solveAnnotatedObject(
  row: AnnotatedObjectRow,
  cameraHeight: number,
  shell: readonly WallSegment[],
): RecognizedWhiteboxProp | null {
  const azimuth = panoAzimuthRad(row.center);
  let distance: number | null = null;
  if (row.grounded) {
    const ground = solvePanoGround(row.center, row.vBottom, cameraHeight);
    if (ground) distance = ground.distance;
  }
  const wallDistance = row.againstWall && shell.length ? shellDistanceAt(azimuth, shell) : null;
  const depthHint = finite(row.record.depth, 0, 0.05, 10);
  // 贴墙物体吸附到墙内侧：把"同一面墙同一距离"变成结构保证；
  // 接地点被遮挡的物体只能靠墙距落位，没有墙就跳过。
  if (wallDistance !== null) {
    const depthGuess = depthHint || 0.6;
    distance = Math.min(PANO_MAX_DISTANCE, Math.max(PANO_MIN_DISTANCE, wallDistance - WALL_THICKNESS / 2 - depthGuess / 2 - 0.02));
  }
  if (distance === null) return null;
  const w = Math.min(10, Math.max(0.05, 2 * distance * Math.tan(row.spanRad / 2)));
  const depth = row.kind === "box"
    ? (depthHint || Math.min(1.5, Math.max(0.2, w * 0.45)))
    : w;
  let y: number;
  let h: number;
  if (row.grounded) {
    h = Math.min(10, Math.max(0.05, panoHeightAt(row.vTop, distance, cameraHeight)));
    y = h / 2;
  } else {
    const bottom = Math.max(0, panoHeightAt(row.vBottom, distance, cameraHeight));
    const top = panoHeightAt(row.vTop, distance, cameraHeight);
    h = Math.min(10, Math.max(0.05, top - bottom));
    y = Math.min(8, Math.max(0.02, bottom + h / 2));
  }
  return {
    name: row.name,
    kind: row.kind,
    x: distance * Math.sin(azimuth),
    y,
    z: -distance * Math.cos(azimuth),
    // 默认沿环绕切线（贴墙/长条物的自然朝向）；模型可用 rotation 字段覆盖
    rotation: finite(row.record.rotation, wrapDeg(-azimuth / DEG), -180, 180),
    w: row.kind === "box" ? w : Math.max(w, 0.05),
    h,
    d: depth,
  };
}

function parseAnnotatedCharacters(
  value: unknown,
  cameraHeight: number,
  shell: readonly WallSegment[],
): RecognizedBlockingCharacter[] {
  const rows = Array.isArray(value) ? value.slice(0, 18) : [];
  return rows.flatMap((row, index): RecognizedBlockingCharacter[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const u = Number(record.u);
    const v = Number(record.v);
    if (Number.isFinite(u) && Number.isFinite(v)) {
      const ground = solvePanoGround(u, v, cameraHeight);
      if (!ground) return [];
      // 脚点标注偏高会把距离解到墙外：有房间壳时把人物按住在墙内侧
      let distance = ground.distance;
      if (shell.length) {
        const wallDistance = shellDistanceAt(ground.azimuth, shell);
        if (wallDistance !== null) distance = Math.min(distance, Math.max(0.5, wallDistance - 0.6));
      }
      const x = Math.min(8, Math.max(-8, distance * Math.sin(ground.azimuth)));
      const z = Math.min(8, Math.max(-8, -distance * Math.cos(ground.azimuth)));
      return [{
        ...characterBase(record, index),
        x,
        z,
        // 缺省面向场景中心（全景观察点），模型可用 rotation 覆盖
        rotation: finite(record.rotation, wrapDeg(Math.atan2(-x, -z) / DEG), -180, 180),
      }];
    }
    // 防御：标注模式里混入 x/z 行时按直出规则读取
    return parseCharacterRows([record]);
  });
}

/** 标注模式解算：墙脚线→房间壳，物体包围框→反投影体块。 */
function solveAnnotatedScene(raw: Record<string, unknown>): RecognizedBlocking | null {
  const room = raw.room && typeof raw.room === "object" && !Array.isArray(raw.room)
    ? raw.room as Record<string, unknown>
    : {};
  const objects = readAnnotatedObjectRows(raw.objects);
  const initialHeight = finite(raw.cameraHeight, DEFAULT_CAMERA_HEIGHT, 1.0, 2.2);
  const cameraHeight = calibrateCameraHeight(objects, initialHeight);
  const shell = solveWallSegments(room, cameraHeight);
  const wallHeight = finite(room.wallHeight, 3.2, 2.5, 6);
  const props: RecognizedWhiteboxProp[] = shellWalls(shell, wallHeight);
  for (const row of objects) {
    const solved = solveAnnotatedObject(row, cameraHeight, shell);
    if (solved) props.push(solved);
  }
  const characters = parseAnnotatedCharacters(raw.characters, cameraHeight, shell);
  if (!characters.length && !props.length) return null;
  return {
    characters: resolveCharacterPropCollisions(characters, props),
    props: appendFloorSlab(props),
    ...cameraPresetField(raw),
  };
}

// ===== 人物与体块的碰撞消解 =====
// 识别结果里人物和家具经常落在同一位置，人物会被体块吞掉半个身子。
// 导入前把人物从占位体块的水平投影里推出去（只考虑与站立人物身高带
// 相交的体块：横梁下可以走人，地毯上可以站人）。

const CHARACTER_CLEARANCE = 0.35;

export function resolveCharacterPropCollisions(
  characters: readonly RecognizedBlockingCharacter[],
  props: readonly RecognizedWhiteboxProp[],
): RecognizedBlockingCharacter[] {
  const blockers = props.filter((prop) => prop.y + prop.h / 2 > 0.4 && prop.y - prop.h / 2 < 1.6);
  return characters.map((character) => {
    let { x, z } = character;
    for (let pass = 0; pass < 4; pass += 1) {
      let moved = false;
      for (const prop of blockers) {
        if (prop.kind === "box") {
          const alpha = prop.rotation * DEG;
          const cos = Math.cos(alpha);
          const sin = Math.sin(alpha);
          const worldX = x - prop.x;
          const worldZ = z - prop.z;
          // rotation.y=α 的逆变换：世界偏移 → 体块局部坐标
          const localX = worldX * cos - worldZ * sin;
          const localZ = worldX * sin + worldZ * cos;
          const halfW = prop.w / 2 + CHARACTER_CLEARANCE;
          const halfD = prop.d / 2 + CHARACTER_CLEARANCE;
          const penetrationX = halfW - Math.abs(localX);
          const penetrationZ = halfD - Math.abs(localZ);
          if (penetrationX <= 0 || penetrationZ <= 0) continue;
          // 沿穿透量小的轴推出到最近边缘
          let outX = localX;
          let outZ = localZ;
          if (penetrationX < penetrationZ) outX = (localX >= 0 ? 1 : -1) * halfW;
          else outZ = (localZ >= 0 ? 1 : -1) * halfD;
          x = prop.x + outX * cos + outZ * sin;
          z = prop.z - outX * sin + outZ * cos;
          moved = true;
        } else {
          const radius = Math.max(prop.w, prop.d) / 2 + CHARACTER_CLEARANCE;
          const dx = x - prop.x;
          const dz = z - prop.z;
          const dist = Math.hypot(dx, dz);
          if (dist >= radius) continue;
          const scale = dist < 1e-6 ? 0 : radius / dist;
          x = dist < 1e-6 ? prop.x + radius : prop.x + dx * scale;
          z = dist < 1e-6 ? prop.z : prop.z + dz * scale;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { ...character, x, z };
  });
}

/** 从文本模型响应中提取安全、有限的站位数据。 */
export function parseRecognizedBlocking(text: string): RecognizedBlocking | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const characters = parseCharacterRows(raw.characters);
  if (!characters.length) return null;
  return { characters, ...cameraPresetField(raw) };
}

/** 白膜生成结果：全景标注模式（objects/room）走几何反投影，
 *  透视直出模式（props）沿用米制直读；两种都允许纯物体的空人物场景。 */
export function parseRecognizedWhitebox(text: string): RecognizedBlocking | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  if (Array.isArray(raw.objects) || (raw.room && typeof raw.room === "object")) {
    return solveAnnotatedScene(raw);
  }
  const characters = parseCharacterRows(raw.characters);
  const props = parsePropRows(raw.props);
  if (!characters.length && !props.length) return null;
  return {
    characters: resolveCharacterPropCollisions(characters, props),
    props: appendFloorSlab(props),
    ...cameraPresetField(raw),
  };
}

export function buildBlockingRecognitionPrompt(): string {
  return [
    "分析这张影视画面中的人物数量、相对站位、朝向和体型，生成3D导演台站位参考。",
    "只返回一个JSON对象，不要Markdown和解释。",
    "格式：{\"characters\":[{\"name\":\"角色A\",\"preset\":\"standard-male\",\"x\":-0.8,\"z\":0.2,\"rotation\":0,\"scale\":1}],\"cameraPreset\":\"front-medium\"}",
    "坐标规则：画面左侧为负x、右侧为正x；前景为正z、远景为负z；x/z范围-4到4。rotation为角度。",
    "若是360°等距柱状全景图（画面横向环绕一周、直线呈弧形弯曲）：观察点位于原点，人物按其在图中的水平位置换算方位角环绕摆放——水平中心为正前方(-z)，左右边缘为正后方(+z)，1/4处为左侧(-x)，3/4处为右侧(+x)。",
    "preset只能是 standard-male、standard-female、athletic、slim、teen、child、broad、chibi。",
    "最多识别18人；无法确认性别或体型时使用standard-male；不要虚构画面中不存在的人。",
  ].join("\n");
}

export function buildWhiteboxRecognitionPrompt(): string {
  return [
    "分析这张场景图，把画面中的主要物体简化为3D白膜体块（blockout），并提取人物站位，生成3D导演台场景。",
    "只返回一个JSON对象，不要Markdown和解释。先判断图片类型，两种类型使用不同的返回格式。",
    "类型A·360°等距柱状全景图（画面横向环绕一周、直线呈弧形弯曲，宽高比约2:1或16:9）——使用标注模式：只在图上标归一化坐标（u:0=最左、1=最右；v:0=顶、1=底），不要自己估算米数，三维坐标由程序按全景几何解算。返回：",
    "{\"imageType\":\"panorama\",\"cameraHeight\":1.6,\"room\":{\"wallHeight\":3.5,\"wallRuns\":[[{\"u\":0.03,\"v\":0.58},{\"u\":0.15,\"v\":0.60}]]},\"objects\":[{\"name\":\"接待台\",\"kind\":\"box\",\"u1\":0.68,\"u2\":0.79,\"vBottom\":0.62,\"vTop\":0.47,\"grounded\":true,\"againstWall\":true,\"depth\":0.6}],\"characters\":[{\"name\":\"角色A\",\"preset\":\"standard-male\",\"u\":0.3,\"v\":0.7}],\"cameraPreset\":\"front-medium\"}",
    "wallRuns：只在真实存在连续实体墙面的地方标墙段——每一段连续墙作为一组，组内沿墙脚（墙面与地面交线）按顺序标2到8个点（拐角必须有点，v必须大于0.55）；走廊、门洞、电梯口、通道、大面积玻璃开口处不要标，留空，组与组之间不要连接闭合；没有明显实体墙时wallRuns为空数组。wallHeight为墙高（米）。",
    "objects：标8到25个主要物体（立柱、家具、门、大型陈设、绿植）。每根立柱单独标一个体块（kind用cylinder或box），不要把多根柱子并成一面墙。u1/u2为物体左右边缘；vBottom为接地点（物体与地面接触处的v，标点务必精确，它决定距离）；vTop为顶部；grounded为接地点是否可见（被遮挡标false）；againstWall为是否贴墙；depth为进深米数（可凭常识估）。",
    "characters：图中真实人物脚下接地点的u/v。",
    "类型B·普通透视照片——使用直出模式，返回：",
    "{\"imageType\":\"perspective\",\"props\":[{\"name\":\"沙发\",\"kind\":\"box\",\"x\":-1.2,\"y\":0.4,\"z\":0.6,\"rotation\":0,\"w\":2,\"h\":0.8,\"d\":0.9}],\"characters\":[{\"name\":\"角色A\",\"preset\":\"standard-male\",\"x\":-0.8,\"z\":0.2,\"rotation\":0,\"scale\":1}],\"cameraPreset\":\"front-medium\"}",
    "直出模式坐标：画面左侧为负x、右侧为正x；前景为正z、远景为负z；x/z范围-8到8；w/h/d为真实尺寸（米），y为中心离地高度（落地取h/2），rotation为绕竖直轴角度。",
    "通用规则：kind只能是box、sphere、cylinder，圆柱仅用于立柱、圆桌等真圆物；地板由程序自动生成，不要输出地面、天花板、整铺地毯、灯带；空旷区域保持空白，不要用体块填充；成排成组的小物合并为一个体块；体块之间不得穿插重叠；尺寸符合常识（桌高约0.75米、座面约0.45米、门高约2.1米、层高2.7到4米）。",
    "characters的preset只能是 standard-male、standard-female、athletic、slim、teen、child、broad、chibi；画面中没有人物时characters返回空数组，不要虚构。",
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
