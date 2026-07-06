import type { AssistantPetSpriteAction, AssistantPetSpriteMeta } from "@/types/assistant";

const DEFAULT_SPRITE_FPS = 8;
const ACTION_NAMES = ["待机", "行走", "跑动", "挥手", "开心", "休息", "转身", "特效"];
const COMMON_GRID_COUNTS = [8, 6, 5, 4, 3, 2, 10, 12];

function asRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Math.round(finiteNumber(value, fallback));
  return Math.min(max, Math.max(min, number));
}

function actionName(index: number) {
  return ACTION_NAMES[index] ?? `动作 ${index + 1}`;
}

function createActions(rows: number, columns: number, fps = DEFAULT_SPRITE_FPS): AssistantPetSpriteAction[] {
  return Array.from({ length: rows }, (_, index) => ({
    id: `row-${index + 1}`,
    name: actionName(index),
    row: index,
    start: 0,
    count: columns,
    fps,
    loop: true,
  }));
}

export function createAssistantPetSpriteMeta(width: number, height: number, columns: number, rows: number): AssistantPetSpriteMeta {
  const safeColumns = Math.max(1, Math.round(columns));
  const safeRows = Math.max(1, Math.round(rows));
  return {
    kind: "spritesheet",
    frameWidth: Math.max(1, Math.round(width / safeColumns)),
    frameHeight: Math.max(1, Math.round(height / safeRows)),
    columns: safeColumns,
    rows: safeRows,
    fps: DEFAULT_SPRITE_FPS,
    defaultAction: "row-1",
    actions: createActions(safeRows, safeColumns),
  };
}

export function normalizeAssistantPetSpriteMeta(value: unknown): AssistantPetSpriteMeta | undefined {
  const record = asRecord(value);
  if (record.kind !== "spritesheet") return undefined;

  const columns = boundedInt(record.columns, 1, 1, 32);
  const rows = boundedInt(record.rows, 1, 1, 32);
  if (columns <= 1 || rows <= 1) return undefined;

  const fps = boundedInt(record.fps, DEFAULT_SPRITE_FPS, 1, 30);
  const frameWidth = boundedInt(record.frameWidth, 1, 1, 4096);
  const frameHeight = boundedInt(record.frameHeight, 1, 1, 4096);
  const rawActions = Array.isArray(record.actions) ? record.actions : [];
  const actions = rawActions
    .map((item, index) => {
      const action = asRecord(item);
      const row = boundedInt(action.row, index, 0, rows - 1);
      const start = boundedInt(action.start, 0, 0, columns - 1);
      const count = boundedInt(action.count, columns - start, 1, columns - start);
      return {
        id: stringValue(action.id) || `row-${row + 1}`,
        name: stringValue(action.name) || actionName(index),
        row,
        start,
        count,
        fps: boundedInt(action.fps, fps, 1, 30),
        loop: action.loop !== false,
      } satisfies AssistantPetSpriteAction;
    });

  const normalizedActions = actions.length ? actions : createActions(rows, columns, fps);
  const defaultAction = stringValue(record.defaultAction) || normalizedActions[0]?.id || "row-1";

  return {
    kind: "spritesheet",
    frameWidth,
    frameHeight,
    columns,
    rows,
    fps,
    defaultAction,
    actions: normalizedActions,
  };
}

export function isLikelyAssistantSpriteSheetName(value: string | undefined) {
  return /sprite|spritesheet|sheet|精灵|序列|动作|帧/i.test(value ?? "");
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function groupsFromProjection(projection: number[], maxGap: number, minSpan: number) {
  const max = Math.max(0, ...projection);
  const threshold = Math.max(1, Math.floor(max * 0.015));
  const groups: Array<{ start: number; end: number }> = [];
  let start = -1;
  let end = -1;
  let gap = 0;

  projection.forEach((count, index) => {
    if (count >= threshold) {
      if (start < 0) start = index;
      end = index;
      gap = 0;
      return;
    }
    if (start < 0) return;
    gap += 1;
    if (gap <= maxGap) return;
    groups.push({ start, end: Math.max(start, end - gap + 1) });
    start = -1;
    end = -1;
    gap = 0;
  });

  if (start >= 0) groups.push({ start, end });
  return groups.filter((group) => group.end - group.start + 1 >= minSpan);
}

function colorDistance(data: Uint8ClampedArray, offset: number, background: [number, number, number, number]) {
  return Math.abs(data[offset] - background[0]) +
    Math.abs(data[offset + 1] - background[1]) +
    Math.abs(data[offset + 2] - background[2]) +
    Math.abs(data[offset + 3] - background[3]);
}

function inferSpriteGridFromPixels(image: HTMLImageElement): AssistantPetSpriteMeta | undefined {
  if (typeof document === "undefined") return undefined;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (sourceWidth < 96 || sourceHeight < 96) return undefined;

  const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const cornerOffsets = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ];
  const background = cornerOffsets.reduce<[number, number, number, number]>((acc, offset) => [
    acc[0] + data[offset] / cornerOffsets.length,
    acc[1] + data[offset + 1] / cornerOffsets.length,
    acc[2] + data[offset + 2] / cornerOffsets.length,
    acc[3] + data[offset + 3] / cornerOffsets.length,
  ], [0, 0, 0, 0]);
  const transparentBackground = background[3] < 200;
  const xProjection = Array.from({ length: width }, () => 0);
  const yProjection = Array.from({ length: height }, () => 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const foreground = transparentBackground
        ? data[offset + 3] > 12
        : colorDistance(data, offset, background) > 34;
      if (!foreground) continue;
      xProjection[x] += 1;
      yProjection[y] += 1;
    }
  }

  const xGroups = groupsFromProjection(
    xProjection,
    Math.max(3, Math.round(width / 80)),
    Math.max(3, Math.round(width / 180))
  );
  const yGroups = groupsFromProjection(
    yProjection,
    Math.max(3, Math.round(height / 80)),
    Math.max(3, Math.round(height / 180))
  );
  const columns = xGroups.length;
  const rows = yGroups.length;
  if (columns < 2 || rows < 2 || columns > 16 || rows > 16) return undefined;

  const xCenters = xGroups.map((group) => (group.start + group.end) / 2);
  const yCenters = yGroups.map((group) => (group.start + group.end) / 2);
  const xSpacing = median(xCenters.slice(1).map((center, index) => center - xCenters[index]));
  const ySpacing = median(yCenters.slice(1).map((center, index) => center - yCenters[index]));
  const spacingRatio = xSpacing && ySpacing ? xSpacing / ySpacing : 1;
  if (spacingRatio < 0.45 || spacingRatio > 2.2) return undefined;

  return createAssistantPetSpriteMeta(sourceWidth, sourceHeight, columns, rows);
}

function inferSpriteGridFromSize(width: number, height: number, hint?: string): AssistantPetSpriteMeta | undefined {
  if (!isLikelyAssistantSpriteSheetName(hint) || width < 160 || height < 160) return undefined;

  let best: { columns: number; rows: number; score: number } | undefined;
  for (const columns of COMMON_GRID_COUNTS) {
    for (const rows of COMMON_GRID_COUNTS) {
      const frameWidth = width / columns;
      const frameHeight = height / rows;
      if (frameWidth < 24 || frameHeight < 24 || frameWidth > 256 || frameHeight > 256) continue;
      const aspectScore = Math.abs(Math.log(frameWidth / frameHeight));
      const gridScore = Math.abs(columns - 8) * 0.025 + Math.abs(rows - 8) * 0.025;
      const divisibilityScore = ((width % columns) + (height % rows)) / Math.max(width, height);
      const score = aspectScore + gridScore + divisibilityScore;
      if (!best || score < best.score) best = { columns, rows, score };
    }
  }

  return best ? createAssistantPetSpriteMeta(width, height, best.columns, best.rows) : undefined;
}

async function detectAssistantPetSprite(src: string, hint?: string) {
  const image = await loadImage(src);
  const sizeMeta = inferSpriteGridFromSize(image.naturalWidth, image.naturalHeight, hint);
  if (sizeMeta && isLikelyAssistantSpriteSheetName(hint)) {
    return sizeMeta;
  }
  try {
    const pixelMeta = inferSpriteGridFromPixels(image);
    if (pixelMeta) return pixelMeta;
  } catch {
    // Cross-origin images can be drawn but not read. Fall back to safe dimension heuristics.
  }
  return sizeMeta;
}

export async function detectAssistantPetSpriteFromFile(file: File): Promise<AssistantPetSpriteMeta | undefined> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await detectAssistantPetSprite(objectUrl, file.name);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function detectAssistantPetSpriteFromImageUrl(imageUrl: string, hint?: string): Promise<AssistantPetSpriteMeta | undefined> {
  const nameFromUrl = (() => {
    try {
      const url = new URL(imageUrl, window.location.href);
      return decodeURIComponent(url.pathname.split("/").pop() || "");
    } catch {
      return imageUrl.split("?")[0]?.split("/").pop() || "";
    }
  })();
  return detectAssistantPetSprite(imageUrl, [hint, nameFromUrl].filter(Boolean).join(" "));
}
