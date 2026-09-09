"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser, Loader2, Paintbrush, Undo2, X } from "lucide-react";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { fileApi, uploadFileSmart } from "@/lib/api";
import { loadImageViaProxy } from "@/lib/image-slice";
import { chooseInpaintModel, paintMask, renderMaskPreview, sourceBrushSize, type MaskStroke } from "@/lib/inpaint";
import { resolveImageToolPointCost } from "@/lib/price-matrix";
import { useAppUpdateGuard } from "@/hooks/use-app-update-guard";
import { useAuthStore } from "@/stores/use-auth-store";

const LOAD_TIMEOUT_MS = 30_000;

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
        setResolution(selected.config?.resolutions?.[0] ?? "");
        setQuality(selected.config?.qualities?.[0] ?? "");
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
      const uploaded=await uploadFileSmart(new File([blob],"inpaint-mask.png",{type:"image/png"}));
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
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-3" onPointerDown={(e)=>e.stopPropagation()} onWheel={(e)=>e.stopPropagation()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="局部修改" tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-auto rounded-2xl border border-neutral-700 bg-neutral-950 text-neutral-100 shadow-2xl"
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
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div><h3 className="font-semibold">局部修改</h3><p className="mt-1 text-xs text-neutral-400">涂抹修改区域，选区外保留原图。新增物体及阴影也需要包含在选区内。</p></div>
          <button aria-label="关闭局部修改" disabled={busy} onClick={()=>{if(!lock.current)onClose();}} className="rounded-lg p-2 hover:bg-neutral-800 disabled:opacity-40"><X size={18}/></button>
        </div>
        {loading && <p role="status" className="p-6 text-sm text-neutral-400">正在读取原图与蒙版模型…</p>}
        {source && <>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <button aria-pressed={!erase} disabled={busy} onClick={()=>setErase(false)} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${!erase?"bg-cyan-950 text-cyan-300":"bg-neutral-900"}`}><Paintbrush size={16}/>画笔</button>
            <button aria-pressed={erase} disabled={busy} onClick={()=>setErase(true)} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${erase?"bg-cyan-950 text-cyan-300":"bg-neutral-900"}`}><Eraser size={16}/>擦除</button>
            <label className="flex items-center gap-2">笔刷<input aria-label="笔刷大小" type="range" min="8" max="180" value={size} disabled={busy} onChange={(e)=>setSize(Number(e.target.value))} className="w-28 accent-cyan-400"/></label>
            <button disabled={busy||!count} onClick={undo} className="flex items-center gap-2 p-2 disabled:opacity-40"><Undo2 size={16}/>撤销</button>
            <button disabled={busy||!count} onClick={()=>{if(lock.current)return;pointer.current=null;strokes.current=[];setCount(0);redraw();}} className="p-2 disabled:opacity-40">清空</button>
          </div>
          <div className="min-h-0 overflow-auto bg-black px-4 py-2">
            <div className="relative mx-auto w-fit max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.url} alt="待修改原图" draggable={false} className="block max-h-[48dvh] max-w-full object-contain"/>
              <canvas ref={canvas} width={Math.round(source.width*scale)} height={Math.round(source.height*scale)}
                aria-label="涂抹需要修改的区域" className="absolute inset-0 h-full w-full touch-none opacity-45" style={{cursor:busy?"wait":"crosshair"}}
                onPointerDown={(e)=>{if(lock.current||pointer.current!==null||e.button!==0)return; e.preventDefault();pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);strokes.current.push({erase,size:sourceBrushSize(size,source.width,e.currentTarget.getBoundingClientRect().width),points:[point(e)]});setCount(strokes.current.length);redraw();}}
                onPointerMove={(e)=>{if(pointer.current!==e.pointerId||lock.current)return; const p=point(e);const active=strokes.current.at(-1);const last=active?.points.at(-1);if(active&&last&&Math.hypot(p.x-last.x,p.y-last.y)>1){active.points.push(p);redraw();}}}
                onPointerUp={(e)=>{if(pointer.current===e.pointerId)pointer.current=null;}}
                onPointerCancel={()=>{pointer.current=null;}} onLostPointerCapture={()=>{pointer.current=null;}}/>
            </div>
          </div>
          <div className="space-y-3 px-5 py-4">
            <textarea aria-label="局部修改提示词" value={prompt} onChange={(e)=>setPrompt(e.target.value)} disabled={busy} maxLength={4000} rows={2}
              placeholder="例如：让人物手里握着一把斧子，保持原画风与光照"
              className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"/>
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
              <span>局部重绘模型：{model?.name}</span>
              {!!model?.config?.resolutions?.length && <select aria-label="输出清晰度" disabled={busy} value={resolution} onChange={(e)=>setResolution(e.target.value)} className="rounded bg-neutral-900 p-2">{model.config.resolutions.map(r=><option key={r}>{r}</option>)}</select>}
              {!!model?.config?.qualities?.length && <select aria-label="输出质量" disabled={busy} value={quality} onChange={(e)=>setQuality(e.target.value)} className="rounded bg-neutral-900 p-2">{model.config.qualities.map(q=><option key={q}>{q}</option>)}</select>}
              <button onClick={()=>void submit()} disabled={busy||!count||!prompt.trim()||!model}
                className="ml-auto flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 font-medium text-neutral-950 disabled:opacity-40">
                {busy&&<Loader2 size={14} className="animate-spin"/>}{busy?"正在提交…":`生成修改 · ${cost} 积分`}
              </button>
            </div>
          </div>
        </>}
        {error&&<p role="alert" className="px-5 pb-4 text-sm text-red-300">{error}</p>}
      </div>
    </div>, document.body,
  );
}
