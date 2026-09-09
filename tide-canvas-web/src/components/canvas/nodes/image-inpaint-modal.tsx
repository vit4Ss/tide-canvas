"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Eraser, Loader2, Paintbrush, Trash2, Undo2, X } from "lucide-react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { loadImageViaProxy } from "@/lib/image-slice";
import { chooseInpaintModel, defaultInpaintQuality, defaultInpaintResolution, paintMask, renderMaskPreview, sourceBrushSize, type MaskStroke } from "@/lib/inpaint";
import { resolveImageToolPointCost } from "@/lib/price-matrix";
import { useAppUpdateGuard } from "@/hooks/use-app-update-guard";
import { useAuthStore } from "@/stores/use-auth-store";

const LOAD_TIMEOUT_MS = 30_000;
const MAX_MASK_UPLOAD_BYTES = 32 * 1024 * 1024;

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), LOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function ImageInpaintModal({ src, onClose, onApply }: {
  src: string;
  onClose: () => void;
  onApply: (model: StudioModelVO, input: Record<string, unknown>) => Promise<void> | void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const strokes = useRef<MaskStroke[]>([]);
  const pointer = useRef<number | null>(null);
  const frame = useRef(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const [source, setSource] = useState<{url:string;width:number;height:number}|null>(null);
  const [model, setModel] = useState<StudioModelVO|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [size, setSize] = useState(40);
  const [erase, setErase] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState("");
  const [quality, setQuality] = useState("");
  // A selection is an unsaved document while this editor is open.
  useAppUpdateGuard(true, () => {});

  useEffect(() => {
    let disposed = false;
    let objectURL = "";
    const loadController = new AbortController();
    let imageTimeout: ReturnType<typeof setTimeout> | undefined;
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void (async () => {
      try {
        const catalog = await withTimeout(
          marketApi.studioModels("image"),
          "蒙版模型读取超时，请关闭后重试",
        );
        if (!catalog.success) throw new Error(catalog.message || "模型读取失败");
        const selected = chooseInpaintModel(catalog.data ?? []);
        if (!selected) throw new Error("管理员尚未配置可用的蒙版模型，请联系管理员开启“支持蒙版”");
        if (disposed) return;
        setModel(selected);
        setResolution(defaultInpaintResolution(selected.config?.resolutions));
        setQuality(defaultInpaintQuality(selected.config?.qualities));
        imageTimeout = setTimeout(() => loadController.abort(), LOAD_TIMEOUT_MS);
        const loaded = await loadImageViaProxy(src, loadController.signal);
        clearTimeout(imageTimeout);
        imageTimeout = undefined;
        objectURL = loaded.objUrl;
        if (disposed) { URL.revokeObjectURL(objectURL); return; }
        const sourceType=loaded.mimeType.toLowerCase().split(";",1)[0].trim();
        if(sourceType.startsWith("image/")&&!new Set(["image/png","image/jpeg","image/webp"]).has(sourceType))
          throw new Error("局部修改目前支持 PNG、JPEG 和 WebP 原图");
        const width = loaded.img.naturalWidth, height = loaded.img.naturalHeight;
        if (width * height > 20_000_000) throw new Error("原图超过 2000 万像素，请缩小后再局部修改");
        setSource({url:objectURL,width,height});
      } catch (e) { if (!disposed) setError(loadController.signal.aborted ? "原图读取超时，请关闭后重试" : e instanceof Error ? e.message : "图片读取失败"); }
      finally { if (imageTimeout) clearTimeout(imageTimeout); if (!disposed) setLoading(false); }
    })();
    return () => {
      disposed = true; alive.current = false;
      if (imageTimeout) clearTimeout(imageTimeout);
      loadController.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
      cancelAnimationFrame(frame.current);
      previous?.focus();
    };
  }, [src]);

  const redraw = () => {
    if (!source || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const c = canvas.current;
      if (c) renderMaskPreview(c,source.width,source.height,strokes.current);
    });
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x:Math.max(0,Math.min(source!.width,(event.clientX-rect.left)*source!.width/rect.width)),
      y:Math.max(0,Math.min(source!.height,(event.clientY-rect.top)*source!.height/rect.height)) };
  };
  const undo = () => { if (lock.current || pointer.current !== null) return; strokes.current.pop(); setCount(strokes.current.length); redraw(); };
  const cost = model ? resolveImageToolPointCost(model.config,{resolution,quality},model.pointCost) : 0;

  const submit = async () => {
    if (lock.current || !model || !source || !prompt.trim() || !count) return;
    lock.current = true; pointer.current = null; setBusy(true); setError("");
    let uploadedMask: { id: string; reused?: boolean } | null = null;
    let accepted = false;
    try {
      const owner = useAuthStore.getState().user?.id;
      if (!owner) throw new Error("请先登录后再生成");
      // An erased selection must be rejected before uploading or charging.
      const preview=canvas.current;
      const previewContext=preview && renderMaskPreview(preview,source.width,source.height,strokes.current);
      if (!preview || !previewContext) throw new Error("蒙版尚未准备好");
      const alpha=previewContext.getImageData(0,0,preview.width,preview.height).data;
      let selected=false;
      for(let i=3;i<alpha.length;i+=4) if(alpha[i]>0){selected=true;break;}
      if(!selected) throw new Error("请先涂抹需要修改的区域");
      const mask = document.createElement("canvas"); mask.width=source.width; mask.height=source.height;
      let blob: Blob | null;
      try {
        const ctx=mask.getContext("2d"); if (!ctx) throw new Error("蒙版导出失败");
        ctx.fillStyle="#000"; ctx.fillRect(0,0,mask.width,mask.height);
        paintMask(ctx,strokes.current,true);
        blob=await new Promise<Blob|null>((resolve)=>mask.toBlob(resolve,"image/png"));
      } finally { mask.width=0; mask.height=0; }
      if(!blob) throw new Error("蒙版导出失败");
      const uploaded=await uploadFileSmart(
        new File([blob],"inpaint-mask.png",{type:"image/png"}),
        undefined,
        { maxBytes: MAX_MASK_UPLOAD_BYTES, label: "蒙版" },
      );
      if(!uploaded.success || !uploaded.data?.fileUrl) throw new Error(uploaded.message || "蒙版上传失败");
      uploadedMask={id:uploaded.data.id,reused:uploaded.data.reused};
      if(!alive.current){if(!uploadedMask.reused)await fileApi.delete(uploadedMask.id).catch(()=>undefined);return;}
      if (useAuthStore.getState().user?.id !== owner) throw new Error("账号已变化，请重新打开局部修改");
      let a=source.width,b=source.height;
      while(b){const remainder=a%b;a=b;b=remainder;}
      const ratio=`${source.width/a}:${source.height/a}`;
      await onApply(model,{
        prompt:prompt.trim(),sourceImage:src,imageList:[src],maskImage:uploaded.data.fileUrl,
        resolution,clarity:resolution,quality,batchCount:1,
        expectedPointCost:cost,
        expectedMaskModelId:model.id,
        aspectRatio:ratio,aspect_ratio:ratio,
      });
      accepted=true;
      if(alive.current) onClose();
    } catch(e) {
      if(uploadedMask&&!uploadedMask.reused&&!accepted) await fileApi.delete(uploadedMask.id).catch(()=>undefined);
      if(alive.current) setError(e instanceof Error?e.message:"局部重绘提交失败，请重试");
    }
    finally { lock.current=false; if(alive.current) setBusy(false); }
  };

  const scale=source?Math.min(1,1280/Math.max(source.width,source.height)):1;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      data-canvas-modal="true"
      onPointerDown={(e)=>e.stopPropagation()}
      onWheel={(e)=>e.stopPropagation()}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="局部修改" tabIndex={-1}
        className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[18px] border border-neutral-200/90 bg-white text-neutral-900 shadow-[0_24px_80px_rgba(15,23,42,0.24)] dark:border-white/10 dark:bg-[#29292b] dark:text-white dark:shadow-black/55"
        onKeyDown={(e)=>{
          e.stopPropagation();
          if(e.key==="Escape" && !lock.current){e.preventDefault();onClose();}
          if((e.ctrlKey||e.metaKey)&&e.key==="z"&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();undo();}
          if(e.key==="Tab"){
            const els=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled)')??[]);
            if(!els.length) return;
            if(e.shiftKey&&(document.activeElement===els[0]||document.activeElement===dialog.current)){e.preventDefault();els.at(-1)?.focus();}
            else if(!e.shiftKey&&(document.activeElement===els.at(-1)||document.activeElement===dialog.current)){e.preventDefault();els[0].focus();}
          }
        }}>
        <div className="flex items-center justify-between gap-5 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-900">
              <Paintbrush className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-tight">局部修改</h3>
              <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-white/45">涂抹需要变化的区域，选区外保留原图</p>
            </div>
          </div>
          <button type="button" aria-label="关闭局部修改" disabled={busy} onClick={()=>{if(!lock.current)onClose();}}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/80">
            <X className="h-4 w-4"/>
          </button>
        </div>
        {loading && (
          <div role="status" className="flex min-h-[360px] flex-col items-center justify-center gap-3 border-t border-neutral-200/80 text-sm text-neutral-400 dark:border-white/8 dark:text-white/40">
            <Loader2 className="h-5 w-5 animate-spin"/>
            正在准备原图与局部修改模型…
          </div>
        )}
        {!loading && !source && error && (
          <div role="alert" className="flex min-h-[320px] flex-col items-center justify-center gap-3 border-t border-neutral-200/80 px-8 text-center dark:border-white/8">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-300"><CircleAlert className="h-5 w-5"/></span>
            <div><p className="text-sm font-medium">无法打开局部修改</p><p className="mt-1 text-xs text-neutral-500 dark:text-white/45">{error}</p></div>
          </div>
        )}
        {source && <>
          <div className="flex flex-wrap items-center gap-3 border-y border-neutral-200/80 px-5 py-2.5 text-xs dark:border-white/8">
            <div className="flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-white/6" role="group" aria-label="蒙版工具">
              <button type="button" aria-pressed={!erase} disabled={busy} onClick={()=>setErase(false)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${!erase?"bg-white text-neutral-900 shadow-sm dark:bg-white/12 dark:text-white":"text-neutral-500 hover:text-neutral-800 dark:text-white/45 dark:hover:text-white/75"}`}>
                <Paintbrush className="h-3.5 w-3.5"/>画笔
              </button>
              <button type="button" aria-pressed={erase} disabled={busy} onClick={()=>setErase(true)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${erase?"bg-white text-neutral-900 shadow-sm dark:bg-white/12 dark:text-white":"text-neutral-500 hover:text-neutral-800 dark:text-white/45 dark:hover:text-white/75"}`}>
                <Eraser className="h-3.5 w-3.5"/>擦除
              </button>
            </div>
            <span className="hidden h-5 w-px bg-neutral-200 sm:block dark:bg-white/10"/>
            <label className="flex items-center gap-2 text-neutral-500 dark:text-white/50">
              <span>笔刷</span>
              <input aria-label="笔刷大小" type="range" min="8" max="180" value={size} disabled={busy} onChange={(e)=>setSize(Number(e.target.value))}
                className="h-1.5 w-28 cursor-pointer accent-neutral-900 disabled:cursor-not-allowed dark:accent-white"/>
              <span className="w-7 text-right tabular-nums text-neutral-400 dark:text-white/35">{size}</span>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" disabled={busy||!count} onClick={undo}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-35 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/75">
                <Undo2 className="h-3.5 w-3.5"/>撤销
              </button>
              <button type="button" disabled={busy||!count} onClick={()=>{if(lock.current)return;pointer.current=null;strokes.current=[];setCount(0);redraw();}}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-35 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white/75">
                <Trash2 className="h-3.5 w-3.5"/>清空
              </button>
            </div>
          </div>
          <div className="min-h-[220px] flex-1 overflow-auto bg-neutral-100 p-3 dark:bg-[#1f1f21] sm:p-4">
            <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-neutral-200/60 shadow-sm ring-1 ring-black/5 dark:bg-black/20 dark:ring-white/8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.url} alt="待修改原图" draggable={false} className="block max-h-[54dvh] max-w-full object-contain"/>
              <canvas ref={canvas} width={Math.round(source.width*scale)} height={Math.round(source.height*scale)}
                aria-label="涂抹需要修改的区域" className="absolute inset-0 h-full w-full touch-none opacity-50" style={{cursor:busy?"wait":"crosshair"}}
                onPointerDown={(e)=>{if(lock.current||pointer.current!==null||e.button!==0)return; e.preventDefault();pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);strokes.current.push({erase,size:sourceBrushSize(size,source.width,e.currentTarget.getBoundingClientRect().width),points:[point(e)]});setCount(strokes.current.length);redraw();}}
                onPointerMove={(e)=>{if(pointer.current!==e.pointerId||lock.current)return; const p=point(e);const active=strokes.current.at(-1);const last=active?.points.at(-1);if(active&&last&&Math.hypot(p.x-last.x,p.y-last.y)>1){active.points.push(p);redraw();}}}
                onPointerUp={(e)=>{if(pointer.current===e.pointerId)pointer.current=null;}}
                onPointerCancel={()=>{pointer.current=null;}} onLostPointerCapture={()=>{pointer.current=null;}}/>
            </div>
          </div>
          <div className="shrink-0 space-y-3 px-5 py-4">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 dark:text-white/35">
              <span>描述选区内需要生成的内容</span>
              <span>新增物体与阴影请完整包含在选区内</span>
            </div>
            <textarea aria-label="局部修改提示词" value={prompt} onChange={(e)=>setPrompt(e.target.value)} disabled={busy} maxLength={4000} rows={2}
              placeholder="例如：让人物手里握着一把斧子，保持原画风与光照"
              className="w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm leading-6 text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/25 dark:focus:bg-white/[0.06]"/>
            {error&&(
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700 dark:border-red-400/15 dark:bg-red-400/[0.07] dark:text-red-300">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{error}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-white/45">
              <span>本次消耗</span>
              <strong className="tabular-nums text-neutral-900 dark:text-white">{cost} 积分</strong>
              <button type="button" onClick={()=>void submit()} disabled={busy||!count||!prompt.trim()||!model}
                className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-xs font-medium text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                {busy&&<Loader2 className="h-3.5 w-3.5 animate-spin"/>}{busy?"正在提交…":"生成修改"}
              </button>
            </div>
          </div>
        </>}
      </div>
    </div>, document.body,
  );
}
