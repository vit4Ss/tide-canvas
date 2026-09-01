"use client";

/**
 * 手绘标注弹层:在节点当前图片上自由画笔圈选/盖序号标记(位置 A/B 之类的布局
 * 指令),保存时输出全分辨率合成图,由调用方上传并创建派生节点(与裁剪/旋转
 * 同一条链路)。
 *
 * 源图经后端下载代理加载(loadImageViaProxy),规避 OSS 无 CORS 头时的 canvas
 * 污染;笔画坐标存图片像素系,显示尺寸缩放不影响输出精度。
 *
 * 双层画布:底层 = 源图 + 已落定标注(仅提交/撤销/清空时重绘),顶层 = 进行中
 * 的一笔(每帧只清绘这一条)——4K 源图拖笔时不再整图重绘,不卡帧。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser, Loader2, MapPin, PenLine, Undo2, X } from "lucide-react";
import { loadImageViaProxy, type RasterTransformResult } from "@/lib/image-slice";

type AnnotateItem =
  | {
      kind: "stroke";
      color: string;
      /** 线宽,图片像素系(落笔时按当前档位 × 图片尺寸换算固定下来) */
      size: number;
      points: { x: number; y: number }[];
    }
  | {
      kind: "stamp";
      color: string;
      size: number;
      x: number;
      y: number;
      label: string;
    };

/** 标注色板:红/蓝为主(圈选惯用),白/黑兜底深浅底图。 */
const ANNOTATE_COLORS = ["#EF4444", "#3B82F6", "#F59E0B", "#22C55E", "#FFFFFF", "#111111"] as const;

const COLOR_NAMES: Record<string, string> = {
  "#EF4444": "红",
  "#3B82F6": "蓝",
  "#F59E0B": "琥珀",
  "#22C55E": "绿",
  "#FFFFFF": "白",
  "#111111": "黑",
};

/** 笔宽档位,按 1000px 参考边换算(小图不至于糊成一团,大图不至于细不可见)。 */
const BRUSH_SIZES = [
  { key: "fine", label: "细", base: 4 },
  { key: "medium", label: "中", base: 9 },
  { key: "bold", label: "粗", base: 16 },
] as const;

type BrushKey = (typeof BRUSH_SIZES)[number]["key"];

// 同一画布会话里反复标注很常见:工具偏好跨弹层记忆(模块级,刷新即回默认)。
let lastColor: string = ANNOTATE_COLORS[0];
let lastBrush: BrushKey = "medium";

/** 浅色(白/琥珀)底盘上的字要用深色才可读。 */
function stampInkFor(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#FFFFFF";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#1A1A1A" : "#FFFFFF";
}

/** 下一枚序号章的字母(A、B、C…,按现存章数循环)。撤销后序列自动接续。 */
function nextStampLabel(items: AnnotateItem[]): string {
  const count = items.filter((item) => item.kind === "stamp").length;
  return String.fromCharCode(65 + (count % 26));
}

/** 贴边点击时把章心往回收,保证圆盘完整可见(位置偏移最多一个半径,可接受)。 */
function clampStampCenter(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
  radius: number,
): { x: number; y: number } {
  const pad = radius + 2;
  return {
    x: Math.min(Math.max(point.x, pad), Math.max(pad, canvas.width - pad)),
    y: Math.min(Math.max(point.y, pad), Math.max(pad, canvas.height - pad)),
  };
}

function drawItem(ctx: CanvasRenderingContext2D, item: AnnotateItem) {
  if (item.kind === "stamp") {
    const radius = item.size * 2.1;
    ctx.beginPath();
    ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = item.color;
    ctx.fill();
    // 对比环:圆盘颜色与底图接近时仍能辨认(深色盘白环,浅色盘深环)。
    ctx.lineWidth = Math.max(1.5, radius * 0.1);
    ctx.strokeStyle = stampInkFor(item.color);
    ctx.stroke();
    ctx.fillStyle = stampInkFor(item.color);
    ctx.font = `600 ${Math.round(radius * 1.15)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.label, item.x, item.y + radius * 0.06);
    return;
  }
  const points = item.points;
  if (!points.length) return;
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, item.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export default function ImageAnnotateModal({
  src,
  sourceMimeType,
  onClose,
  onSave,
}: {
  src: string;
  sourceMimeType?: string;
  onClose: () => void;
  /** 返回 true 表示上传成功、弹层关闭;false 保留标注供重试。 */
  onSave: (result: RasterTransformResult) => Promise<boolean>;
}) {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const itemsRef = useRef<AnnotateItem[]>([]);
  const activeStrokeRef = useRef<Extract<AnnotateItem, { kind: "stroke" }> | null>(null);
  const activePointerRef = useRef<number | null>(null);
  /** 标记模式的悬停幽灵章位置(图片像素系);只画在顶层,永不进入导出。 */
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  const mimeRef = useRef<string>(sourceMimeType || "");

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [itemCount, setItemCount] = useState(0);
  const [color, setColor] = useState<string>(lastColor);
  const [brush, setBrush] = useState<BrushKey>(lastBrush);
  const [tool, setTool] = useState<"brush" | "stamp">("brush");
  const [saving, setSaving] = useState(false);

  // src 变化(节点在标注途中重新生成)时在渲染期重置 state(项目惯例,避免
  // effect 内同步 setState 的级联渲染):旧标注基于旧图尺寸,叠新图必然错位。
  const [renderedSrc, setRenderedSrc] = useState(src);
  if (renderedSrc !== src) {
    setRenderedSrc(src);
    setItemCount(0);
    setLoadState("loading");
  }

  /** 底层:源图 + 已落定标注。只在提交/撤销/清空/加载时调用,不进拖笔热路径。 */
  const redrawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const img = imgRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !img || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const item of itemsRef.current) drawItem(ctx, item);
  }, []);

  const brushSizeFor = useCallback((canvas: HTMLCanvasElement) => {
    const reference = Math.max(canvas.width, canvas.height) / 1000;
    const base = BRUSH_SIZES.find((item) => item.key === brush)?.base ?? 9;
    return Math.max(2, base * reference);
  }, [brush]);

  /** 顶层:进行中的一笔 + 标记模式的悬停幽灵章。拖笔期间每帧只清绘这一层,
   *  与源图尺寸无关;幽灵章只存在于顶层,导出(底层)天然不含它。 */
  const redrawLive = useCallback(() => {
    const canvas = liveCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const active = activeStrokeRef.current;
    if (active) {
      drawItem(ctx, active);
      return;
    }
    const ghost = ghostRef.current;
    if (tool === "stamp" && ghost && !saving) {
      const size = brushSizeFor(canvas);
      const { x, y } = clampStampCenter(canvas, ghost, size * 2.1);
      ctx.globalAlpha = 0.55;
      drawItem(ctx, { kind: "stamp", color, size, x, y, label: nextStampLabel(itemsRef.current) });
      ctx.globalAlpha = 1;
    }
  }, [brushSizeFor, color, saving, tool]);

  const scheduleLiveRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      redrawLive();
    });
  }, [redrawLive]);

  /** 把进行中的一笔落定到底层(收笔/保存前兜底共用)。 */
  const commitActiveStroke = useCallback(() => {
    const active = activeStrokeRef.current;
    if (!active) return;
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    itemsRef.current.push(active);
    setItemCount(itemsRef.current.length);
    redrawBase();
    redrawLive();
  }, [redrawBase, redrawLive]);

  // 源图加载(代理通道);卸载时 revoke objUrl 并取消挂起的 rAF。
  // src 变化时标注随之作废(state 部分已在渲染期重置,ref 在此同步清空)。
  useEffect(() => {
    let disposed = false;
    let objUrl = "";
    itemsRef.current = [];
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    ghostRef.current = null;
    // MIME 与源图同步复位:换图后残留上一张的类型会让透明保留/压缩格式判断错位
    // (如上一张是 PNG、这张是 JPEG,导出仍按 PNG 走)。
    mimeRef.current = sourceMimeType || "";
    void (async () => {
      try {
        const loaded = await loadImageViaProxy(src);
        if (disposed) {
          URL.revokeObjectURL(loaded.objUrl);
          return;
        }
        objUrl = loaded.objUrl;
        imgRef.current = loaded.img;
        if (!mimeRef.current) mimeRef.current = loaded.mimeType;
        for (const canvas of [baseCanvasRef.current, liveCanvasRef.current]) {
          if (canvas) {
            canvas.width = loaded.img.naturalWidth;
            canvas.height = loaded.img.naturalHeight;
          }
        }
        setLoadState("ready");
        redrawBase();
      } catch {
        if (!disposed) setLoadState("error");
      }
    })();
    return () => {
      disposed = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [redrawBase, sourceMimeType, src]);

  const undoItem = useCallback(() => {
    if (saving || !itemsRef.current.length) return;
    itemsRef.current.pop();
    setItemCount(itemsRef.current.length);
    redrawBase();
  }, [redrawBase, saving]);

  // 键盘:Ctrl/Cmd+Z 撤销;Escape 仅在尚无标注且不在保存中时关闭(防误按丢标注)。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoItem();
        return;
      }
      if (event.key !== "Escape") return;
      if (saving || itemsRef.current.length > 0) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving, undoItem]);

  const toImagePoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = liveCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const beginStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (loadState !== "ready" || saving) return;
    // 已有进行中的笔画(多点触控的第二根手指)直接忽略,避免覆盖丢笔。
    if (activeStrokeRef.current) return;
    const point = toImagePoint(event);
    const canvas = liveCanvasRef.current;
    if (!point || !canvas) return;

    if (tool === "stamp") {
      // 序号章:点一下落一个,字母随已有章数自增(A、B、C …);贴边自动收进。
      const size = brushSizeFor(canvas);
      const center = clampStampCenter(canvas, point, size * 2.1);
      itemsRef.current.push({
        kind: "stamp",
        color,
        size,
        x: center.x,
        y: center.y,
        label: nextStampLabel(itemsRef.current),
      });
      setItemCount(itemsRef.current.length);
      redrawBase();
      // 幽灵章的字母已随章数前进,立即刷新顶层预览。
      scheduleLiveRedraw();
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = {
      kind: "stroke",
      color,
      size: brushSizeFor(canvas),
      points: [point],
    };
    scheduleLiveRedraw();
  }, [brushSizeFor, color, loadState, redrawBase, saving, scheduleLiveRedraw, toImagePoint, tool]);

  const extendStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = activeStrokeRef.current;
    if (!active || event.pointerId !== activePointerRef.current) return;
    const point = toImagePoint(event);
    if (!point) return;
    const last = active.points[active.points.length - 1];
    // 距离过滤:笔画点距小于 ~1.5 显示像素的忽略,控制点数并让曲线平滑。
    const canvas = liveCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const minDist = canvas && rect?.width ? (canvas.width / rect.width) * 1.5 : 2;
    if (Math.hypot(point.x - last.x, point.y - last.y) < minDist) return;
    active.points.push(point);
    scheduleLiveRedraw();
  }, [scheduleLiveRedraw, toImagePoint]);

  const endStroke = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    // 只有开笔的那根指针才能收笔——多点触控下另一根手指抬起不得截断进行中的笔画。
    if (!activeStrokeRef.current || event.pointerId !== activePointerRef.current) return;
    commitActiveStroke();
  }, [commitActiveStroke]);

  // 标记模式:悬停处实时预览下一枚章(半透明,含即将使用的字母);移动时顺带
  // 驱动进行中笔画的延伸。
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "stamp" && !activeStrokeRef.current && loadState === "ready" && !saving) {
      ghostRef.current = toImagePoint(event);
      scheduleLiveRedraw();
    }
    extendStroke(event);
  }, [extendStroke, loadState, saving, scheduleLiveRedraw, toImagePoint, tool]);

  const handlePointerLeave = useCallback(() => {
    if (!ghostRef.current) return;
    ghostRef.current = null;
    scheduleLiveRedraw();
  }, [scheduleLiveRedraw]);

  // 工具/颜色/笔宽切换时刷新顶层(擦掉或更新幽灵章)——redrawLive 的身份随这些
  // state 变化,依赖它即可覆盖所有档位组合。
  useEffect(() => {
    scheduleLiveRedraw();
  }, [scheduleLiveRedraw]);

  const clearItems = useCallback(() => {
    if (saving || !itemsRef.current.length) return;
    itemsRef.current = [];
    setItemCount(0);
    redrawBase();
  }, [redrawBase, saving]);

  const handleSave = useCallback(async () => {
    const canvas = baseCanvasRef.current;
    if (!canvas || saving) return;
    commitActiveStroke(); // 触屏边缘:另一根手指点保存时仍有进行中的笔,先落定。
    if (!itemsRef.current.length) return;
    setSaving(true);
    try {
      // 底层画布即最终合成(源图 + 全部标注);与 transformImageRaster 同一输出
      // 策略:有透明通道的源保 PNG,其余 JPEG。
      const preserveAlpha = ["image/png", "image/webp", "image/gif"].includes(mimeRef.current);
      const outputMimeType = preserveAlpha ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputMimeType, preserveAlpha ? undefined : 0.92),
      );
      if (!blob) throw new Error("encode failed");
      const ok = await onSave({
        blob,
        width: canvas.width,
        height: canvas.height,
        mimeType: outputMimeType,
        extension: preserveAlpha ? "png" : "jpg",
      });
      if (ok) {
        onClose();
        return;
      }
    } catch {
      // 上传失败已由调用方 toast;保留标注供重试。
    }
    setSaving(false);
  }, [commitActiveStroke, onClose, onSave, saving]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-6"
      data-canvas-modal="true"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="手绘标注"
    >
      <div className="flex max-h-full max-w-full flex-col overflow-hidden rounded-[14px] bg-white shadow-2xl ring-1 ring-neutral-200/80 dark:bg-[#29292b] dark:ring-white/8">
        <div className="flex items-center justify-between gap-6 px-5 py-3.5">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">手绘标注</h3>
            <span className="text-xs text-neutral-400 dark:text-white/40">画笔圈选或点按盖 A/B 序号章,保存生成标注图节点</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/80"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex min-h-[240px] min-w-[360px] items-center justify-center bg-neutral-100 dark:bg-[#1f1f21]">
          <div className={loadState === "ready" ? "relative inline-flex" : "hidden"}>
            <canvas ref={baseCanvasRef} className="block max-h-[64vh] max-w-[84vw] select-none" />
            <canvas
              ref={liveCanvasRef}
              className="absolute inset-0 h-full w-full cursor-crosshair select-none"
              style={{ touchAction: "none" }}
              onPointerDown={beginStroke}
              onPointerMove={handlePointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={handlePointerLeave}
            />
          </div>
          {loadState === "loading" && (
            <div className="flex items-center gap-2 px-16 py-20 text-sm text-neutral-400 dark:text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> 图片加载中…
            </div>
          )}
          {loadState === "error" && (
            <div className="px-16 py-20 text-sm text-neutral-400 dark:text-white/40">图片加载失败,请关闭后重试</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-white/6" role="radiogroup" aria-label="标注工具">
            {([
              { key: "brush", label: "画笔", icon: PenLine },
              { key: "stamp", label: "标记", icon: MapPin },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={tool === item.key}
                onClick={() => setTool(item.key)}
                title={item.key === "stamp" ? "点按图片盖 A/B/C 序号章" : "自由画笔"}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${tool === item.key ? "bg-white text-neutral-800 shadow-sm dark:bg-white/12 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:text-white/50 dark:hover:text-white/75"}`}
              >
                <item.icon className="h-3.5 w-3.5" /> {item.label}
              </button>
            ))}
          </div>
          <span className="h-5 w-px bg-neutral-200 dark:bg-white/10" />
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="画笔颜色">
            {ANNOTATE_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={color === item}
                onClick={() => { setColor(item); lastColor = item; }}
                className={`h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform dark:ring-white/15 ${color === item ? "scale-110 outline outline-2 outline-offset-2 outline-neutral-400 dark:outline-white/50" : "hover:scale-105"}`}
                style={{ backgroundColor: item }}
                title={COLOR_NAMES[item] ?? item}
                aria-label={COLOR_NAMES[item] ?? item}
              />
            ))}
          </div>
          <span className="h-5 w-px bg-neutral-200 dark:bg-white/10" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="画笔粗细">
            {BRUSH_SIZES.map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={brush === item.key}
                onClick={() => { setBrush(item.key); lastBrush = item.key; }}
                className={`rounded-lg px-2 py-1 text-xs transition-colors ${brush === item.key ? "bg-neutral-200/80 text-neutral-800 dark:bg-white/12 dark:text-white" : "text-neutral-500 hover:bg-neutral-100 dark:text-white/50 dark:hover:bg-white/8"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="h-5 w-px bg-neutral-200 dark:bg-white/10" />
          <button
            type="button"
            onClick={undoItem}
            disabled={saving || itemCount === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:text-white/50 dark:hover:bg-white/8"
            title="撤销上一步 (Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" /> 撤销
          </button>
          <button
            type="button"
            onClick={clearItems}
            disabled={saving || itemCount === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:text-white/50 dark:hover:bg-white/8"
            title="清空全部标注"
          >
            <Eraser className="h-3.5 w-3.5" /> 清空
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/8"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || itemCount === 0 || loadState !== "ready"}
              className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "保存中…" : "保存标注"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
