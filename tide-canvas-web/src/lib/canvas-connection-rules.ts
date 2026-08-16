export interface CanvasConnectionEndpoint {
  type: string;
}

export interface CanvasConnectionRule {
  allowed: boolean;
  reason?: string;
}

/** Keep canvas wiring honest for nodes with a strict input contract. */
export function canvasConnectionRule(
  source: CanvasConnectionEndpoint,
  target: CanvasConnectionEndpoint,
): CanvasConnectionRule {
  if (target.type === "video_breakdown" && source.type !== "video") {
    return { allowed: false, reason: "逐帧拉片仅支持连接视频节点" };
  }
  return { allowed: true };
}
