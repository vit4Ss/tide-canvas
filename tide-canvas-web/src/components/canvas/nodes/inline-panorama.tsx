"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type * as THREE_NS from "three";
import { fetchWithAuth } from "@/lib/http";
import { panoramaCaptureSize } from "@/lib/panorama-capture";
import { exportPanorama, type PanoramaCapture } from "@/lib/panorama-export";
export type { PanoramaCapture } from "@/lib/panorama-export";

const TEXTURE_DECODE_TIMEOUT_MS = 30_000;

export interface InlinePanoramaApi {
  reset: () => void;
  /** 按原始全景图的角度像素密度截取当前视角。 */
  capture: () => Promise<PanoramaCapture | null>;
  /** 逐张截取并交给调用方处理，避免同时持有四张高分辨率 PNG。 */
  capture4: (consume: (capture: PanoramaCapture, index: number) => Promise<void>) => Promise<void>;
}

interface Props {
  src: string;
  /** 三分网格叠加（由节点上方工具栏控制） */
  gridOn?: boolean;
  /** 暴露复位/截图能力给节点上方工具栏 */
  apiRef?: MutableRefObject<InlinePanoramaApi | null>;
  /** 是否进入环视交互（选中后才拦截拖拽做环视；未选中时让位给节点选中/移动） */
  interactive?: boolean;
}

/**
 * 节点内嵌 720° 全景查看器：等距柱状图贴到球内壁，拖动环视、滚轮缩放（FOV）。
 * 右下角方位陀螺仪显示 镜(yaw)/仰(pitch)/缩度(FOV)。工具栏(网格/复位/全屏)由父节点在卡片上方渲染。
 * 经后端代理取同源 blob 贴图，规避 WebGL 跨域污染。指针/鼠标事件隔离，避免误触画布平移/缩放/节点拖拽。
 */
export function InlinePanorama({ src, gridOn = false, apiRef, interactive = true }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- a changed src starts a new external texture lifecycle; stale loading/error state belongs to the previous source. */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    let disposed = false;
    const disposers: (() => void)[] = [];
    const cleanup = () => {
      for (const release of disposers.splice(0).reverse()) {
        try { release(); } catch { /* Release the remaining resources too. */ }
      }
    };
    let pendingBlobURL = "";
    const controller = new AbortController();
    const networkTimeout = window.setTimeout(() => controller.abort(), 120_000);
    const captureController = new AbortController();
    (async () => {
      try {
        const THREE = await import("three");
        const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(src)}`, { signal: controller.signal });
        if (!resp.ok) throw new Error("全景加载失败");
        const blob = await resp.blob();
        window.clearTimeout(networkTimeout);
        if (disposed) return;
        const blobUrl = URL.createObjectURL(blob);
        pendingBlobURL = blobUrl;
        let texture: THREE_NS.Texture;
        try {
          texture = await new Promise<THREE_NS.Texture>((resolve, reject) => {
            let settled = false;
            const timer = window.setTimeout(() => {
              if (settled) return;
              settled = true;
              reject(new Error("全景贴图解析超时"));
            }, TEXTURE_DECODE_TIMEOUT_MS);
            new THREE.TextureLoader().load(blobUrl, (loaded) => {
              if (settled) { loaded.dispose(); return; }
              settled = true;
              window.clearTimeout(timer);
              resolve(loaded);
            }, undefined, () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              reject(new Error("贴图解析失败"));
            });
          });
        } catch (e) {
          URL.revokeObjectURL(blobUrl); // reject 路径也回收 blob,避免泄漏
          if (pendingBlobURL === blobUrl) pendingBlobURL = "";
          throw e;
        }
        URL.revokeObjectURL(blobUrl);
        if (pendingBlobURL === blobUrl) pendingBlobURL = "";
        const mount = mountRef.current;
        if (disposed || !mount) { texture.dispose(); return; }
        disposers.push(() => texture.dispose());

        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(74, w / h, 0.1, 1100);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        disposers.push(() => {
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        // Preview stays cheap. Export samples the decoded original in a worker.
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        disposers.push(() => geometry.dispose());
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ map: texture });
        disposers.push(() => material.dispose());
        const panoramaMesh = new THREE.Mesh(geometry, material);
        scene.add(panoramaMesh);

        let lon = 180, lat = 0, fov = 74;
        let invalidate = () => {};
        let down = false, downX = 0, downY = 0, downLon = 0, downLat = 0;
        const dom = renderer.domElement;
        const onDown = (e: PointerEvent) => {
          e.stopPropagation();
          down = true; downX = e.clientX; downY = e.clientY; downLon = lon; downLat = lat;
          dom.setPointerCapture?.(e.pointerId);
        };
        const onMove = (e: PointerEvent) => {
          if (!down) return;
          e.stopPropagation(); e.preventDefault();
          lon = downLon - (e.clientX - downX) * 0.12;
          lat = Math.max(-85, Math.min(85, downLat + (e.clientY - downY) * 0.12));
          invalidate();
        };
        const onUp = (e: PointerEvent) => {
          down = false;
          if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
        };
        const onWheel = (e: WheelEvent) => {
          e.stopPropagation(); e.preventDefault();
          fov = Math.max(30, Math.min(100, fov + e.deltaY * 0.04));
          camera.fov = fov; camera.updateProjectionMatrix();
          invalidate();
        };
        dom.addEventListener("pointerdown", onDown);
        dom.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        dom.addEventListener("wheel", onWheel, { passive: false });
        disposers.push(() => {
          dom.removeEventListener("pointerdown", onDown);
          dom.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          dom.removeEventListener("wheel", onWheel);
        });

        const onResize = () => {
          const nw = mount.clientWidth || 1, nh = mount.clientHeight || 1;
          camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
          invalidate();
        };
        const ro = new ResizeObserver(onResize);
        disposers.push(() => ro.disconnect());
        ro.observe(mount);

        const image = texture.image as HTMLImageElement;
        const sourceWidth = image.naturalWidth || image.width || w;
        const sourceHeight = image.naturalHeight || image.height || h;
        const renderView = (yaw: number, pitch: number, requestedFov: number): Promise<PanoramaCapture | null> => {
          if (disposed) return Promise.resolve(null);
          const size = panoramaCaptureSize({
            sourceWidth, sourceHeight,
            viewportWidth: mount.clientWidth || w, viewportHeight: mount.clientHeight || h,
            previewPixelRatio: Math.min(window.devicePixelRatio || 1, 2), verticalFov: requestedFov,
          });
          return exportPanorama(image, { ...size, yaw, pitch, verticalFov: requestedFov }, captureController.signal);
        };
        if (apiRef) apiRef.current = {
          reset: () => { lon = 180; lat = 0; fov = 74; camera.fov = 74; camera.updateProjectionMatrix(); invalidate(); },
          capture: () => renderView(lon, lat, fov),
          capture4: async (consume) => {
            const base = lon;
            const captureFov = fov;
            for (const [index, offset] of [0, 90, 180, 270].entries()) {
              const frame = await renderView(base + offset, 0, captureFov);
              if (frame) await consume(frame, index);
            }
          },
        };
        disposers.push(() => { if (apiRef) apiRef.current = null; });

        let raf = 0;
        const animate = () => {
          raf = 0;
          if (disposed) return;
          const phi = THREE.MathUtils.degToRad(90 - lat);
          const theta = THREE.MathUtils.degToRad(lon);
          camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
          renderer.render(scene, camera);
          if (gizmoRef.current) gizmoRef.current.style.transform = `rotateX(${-lat}deg) rotateY(${lon}deg)`;
          if (readoutRef.current) {
            const yaw = Math.round(((lon % 360) + 360) % 360);
            readoutRef.current.textContent = `镜 ${yaw}° · 仰 ${Math.round(lat)}°  ·  缩度 ${Math.round(fov)}°`;
          }
        };
        // An idle panorama is static: no permanent animation loop for every
        // card, especially while a high-resolution export is running.
        invalidate = () => { if (!raf && !disposed) raf = requestAnimationFrame(animate); };
        disposers.push(() => cancelAnimationFrame(raf));
        animate();
        if (!disposed) setLoading(false);

      } catch (e) {
        cleanup();
        if (!disposed) { setError(e instanceof Error ? e.message : "全景加载失败"); setLoading(false); }
      } finally {
        window.clearTimeout(networkTimeout);
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      captureController.abort();
      window.clearTimeout(networkTimeout);
      if (pendingBlobURL) { URL.revokeObjectURL(pendingBlobURL); pendingBlobURL = ""; }
      cleanup();
    };
  }, [src, apiRef]);

  const axis = "absolute left-1/2 top-1/2 origin-left";

  return (
    // 选中后(interactive)才拦 mousedown 防止拖动误移节点；未选中时让事件穿透到节点（点选/移动照常）
    <div className="relative h-full w-full bg-black" onMouseDown={interactive ? (e) => e.stopPropagation() : undefined}>
      <div ref={mountRef} className={`h-full w-full ${interactive ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`} />

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/70">全景加载中…</div>
      )}
      {error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/70">{error}</div>}

      {gridOn && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
        </div>
      )}

      {/* 右下角方位陀螺仪（display-only，pointer-events-none 让点击穿透） */}
      <div className="pointer-events-none absolute bottom-2.5 right-2.5 flex flex-col items-center gap-1 rounded-lg bg-black/55 px-2.5 py-2 backdrop-blur-md">
        <div className="relative h-10 w-10" style={{ perspective: "120px" }}>
          <div ref={gizmoRef} className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            <span className={`${axis} h-[2px] w-3.5 bg-red-500`} style={{ transform: "translate(-1px,-1px)" }} />
            <span className={`${axis} h-[2px] w-3.5 bg-green-500`} style={{ transform: "translate(-1px,-1px) rotateZ(-90deg)" }} />
            <span className={`${axis} h-[2px] w-3.5 bg-blue-500`} style={{ transform: "translate(-1px,-1px) rotateY(90deg)" }} />
          </div>
        </div>
        <div ref={readoutRef} className="whitespace-nowrap text-[10px] tabular-nums text-white/80">镜 180° · 仰 0°</div>
      </div>
    </div>
  );
}
