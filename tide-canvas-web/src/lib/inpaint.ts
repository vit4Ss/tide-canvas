import type { StudioModelVO } from "./market-api";

/** studio-models uses admin order, then usage and id for ties, matching the server. */
export function chooseInpaintModel(models: readonly StudioModelVO[]): StudioModelVO | null {
  return models.find((model) => {
    const config = model.config as (StudioModelVO["config"] & { supportedHandlers?: unknown });
    const raw = config?.supportedHandlers;
    const handlers = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim()).filter(Boolean);
    return model.type === "image" && !!model.modelKey?.trim()
      && config?.supportsMask === true
      && String(config.availabilityStatus ?? "").trim().toLowerCase() !== "maintenance"
      && (!handlers.length || handlers.includes("image_to_image"));
  }) ?? null;
}

function preferredConfiguredValue(values: readonly string[] | undefined, preferred: string, rank: readonly string[]): string {
  const configured = (values ?? []).filter((value): value is string => typeof value === "string" && !!value.trim());
  if (!configured.length) return preferred;
  const exact = configured.find((value) => value.trim().toLowerCase() === preferred);
  if (exact) return exact;
  return [...configured].sort((left, right) => {
    const leftRank = rank.indexOf(left.trim().toLowerCase());
    const rightRank = rank.indexOf(right.trim().toLowerCase());
    return (rightRank < 0 ? -1 : rightRank) - (leftRank < 0 ? -1 : leftRank);
  })[0];
}

/** The controls are intentionally hidden from end users. Prefer the requested
 * premium defaults, while still falling back to the highest configured value. */
export function defaultInpaintResolution(values?: readonly string[]): string {
  return preferredConfiguredValue(values, "4k", ["1k", "2k", "4k", "8k"]);
}

export function defaultInpaintQuality(values?: readonly string[]): string {
  return preferredConfiguredValue(values, "high", ["low", "medium", "high"]);
}

export type MaskStroke = { erase: boolean; size: number; points: { x: number; y: number }[] };

export function sourceBrushSize(visiblePixels: number, sourceWidth: number, visibleWidth: number): number {
  if (!Number.isFinite(visiblePixels) || !Number.isFinite(sourceWidth) || !Number.isFinite(visibleWidth)
    || visiblePixels <= 0 || sourceWidth <= 0 || visibleWidth <= 0) return 1;
  return Math.max(1, visiblePixels * sourceWidth / visibleWidth);
}

/** Render from authoritative strokes, including when a queued animation frame
 * has not run yet. The preview is small; the source image is never redrawn here. */
export function renderMaskPreview(canvas: HTMLCanvasElement, width: number, height: number, strokes: readonly MaskStroke[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / width, canvas.height / height);
  paintMask(ctx, strokes, false);
  return ctx;
}

/** Coordinates and brush width live in original pixels; scaling only affects preview. */
export function paintMask(ctx: CanvasRenderingContext2D, strokes: readonly MaskStroke[], exportMask: boolean) {
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.globalCompositeOperation = exportMask
      ? (stroke.erase ? "source-over" : "destination-out")
      : (stroke.erase ? "destination-out" : "source-over");
    ctx.fillStyle = exportMask ? "#000" : "#22d3ee";
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
      ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
}
