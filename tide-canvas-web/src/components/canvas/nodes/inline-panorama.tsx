"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type * as THREE_NS from "three";
import { fetchWithAuth } from "@/lib/http";
import { panoramaCaptureSize } from "@/lib/panorama-capture";

const CAPTURE_ENCODE_TIMEOUT_MS = 30_000;
const TEXTURE_DECODE_TIMEOUT_MS = 30_000;

function encodePanoramaPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("全景截图编码超时，请重试"));
    }, CAPTURE_ENCODE_TIMEOUT_MS);
    try {
      canvas.toBlob((blob) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (blob) resolve(blob);
        else reject(new Error("全景截图编码失败，请重试"));
      }, "image/png");
    } catch (error) {
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    }
  });
}

export interface PanoramaCapture {
  blob: Blob;
  width: number;
  height: number;
}

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
    let cleanup = () => {};
    let pendingBlobURL = "";
    const controller = new AbortController();
    (async () => {
      try {
        const THREE = await import("three");
        const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(src)}`, { signal: controller.signal });
        if (!resp.ok) throw new Error("全景加载失败");
        const buf = await resp.arrayBuffer();
        if (disposed) return;
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: resp.headers.get("Content-Type") || "application/octet-stream" }));
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

        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(74, w / h, 0.1, 1100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        // Keep the always-running card preview cheap. A separate dense sphere is
        // swapped in only for the capture render: 60×40 triangles become visible
        // at 2K+, while rendering 256×128 every animation frame would multiply
        // the cost of every panorama node on the infinite canvas.
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        let captureGeometry: THREE_NS.SphereGeometry | null = null;
        geometry.scale(-1, 1, 1);
        const denseCaptureGeometry = () => {
          if (captureGeometry) return captureGeometry;
          captureGeometry = new THREE.SphereGeometry(500, 256, 128);
          captureGeometry.scale(-1, 1, 1);
          return captureGeometry;
        };
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const panoramaMesh = new THREE.Mesh(geometry, material);
        scene.add(panoramaMesh);

        let lon = 180, lat = 0, fov = 74;
        let capturing = false;
        let captureQueue: Promise<void> = Promise.resolve();
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
        };
        const onUp = (e: PointerEvent) => {
          down = false;
          if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
        };
        const onWheel = (e: WheelEvent) => {
          e.stopPropagation(); e.preventDefault();
          fov = Math.max(30, Math.min(100, fov + e.deltaY * 0.04));
          camera.fov = fov; camera.updateProjectionMatrix();
        };
        dom.addEventListener("pointerdown", onDown);
        dom.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        dom.addEventListener("wheel", onWheel, { passive: false });

        const onResize = () => {
          if (capturing) return;
          const nw = mount.clientWidth || 1, nh = mount.clientHeight || 1;
          camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(mount);

        const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
        const sourceWidth = image.naturalWidth || image.width || w;
        const sourceHeight = image.naturalHeight || image.height || h;
        const context = renderer.getContext();
        const maxRenderbufferSize = context.getParameter(context.MAX_RENDERBUFFER_SIZE) as number;
        const renderView = (yaw: number, pitch: number, requestedFov: number): Promise<PanoramaCapture | null> => {
          let captured: PanoramaCapture | null = null;
          const run = captureQueue.then(async () => {
            if (disposed) return;
            capturing = true;
            const viewportWidth = mount.clientWidth || w;
            const viewportHeight = mount.clientHeight || h;
            const previewPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            const size = panoramaCaptureSize({
              sourceWidth, sourceHeight, viewportWidth, viewportHeight,
              previewPixelRatio, verticalFov: requestedFov, maxRenderbufferSize,
            });
            try {
              panoramaMesh.geometry = denseCaptureGeometry();
              renderer.setPixelRatio(1);
              renderer.setSize(size.width, size.height, false);
              camera.aspect = size.width / size.height;
              camera.fov = requestedFov;
              camera.updateProjectionMatrix();
              const p = THREE.MathUtils.degToRad(90 - pitch);
              const t = THREE.MathUtils.degToRad(yaw);
              camera.lookAt(500 * Math.sin(p) * Math.cos(t), 500 * Math.cos(p), 500 * Math.sin(p) * Math.sin(t));
              renderer.render(scene, camera);
              const blob = await encodePanoramaPNG(renderer.domElement);
              if (!disposed) captured = { blob, ...size };
            } finally {
              panoramaMesh.geometry = geometry;
              capturing = false;
              if (!disposed) {
                const currentWidth = mount.clientWidth || w;
                const currentHeight = mount.clientHeight || h;
                renderer.setSize(currentWidth, currentHeight, false);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                camera.aspect = currentWidth / currentHeight;
                camera.fov = fov;
                camera.updateProjectionMatrix();
              }
            }
          });
          captureQueue = run.then(() => undefined, () => undefined);
          return run.then(() => captured);
        };
        if (apiRef) apiRef.current = {
          reset: () => { lon = 180; lat = 0; fov = 74; camera.fov = 74; camera.updateProjectionMatrix(); },
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

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          const phi = THREE.MathUtils.degToRad(90 - lat);
          const theta = THREE.MathUtils.degToRad(lon);
          camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
          if (!capturing) renderer.render(scene, camera);
          if (gizmoRef.current) gizmoRef.current.style.transform = `rotateX(${-lat}deg) rotateY(${lon}deg)`;
          if (readoutRef.current) {
            const yaw = Math.round(((lon % 360) + 360) % 360);
            readoutRef.current.textContent = `镜 ${yaw}° · 仰 ${Math.round(lat)}°  ·  缩度 ${Math.round(fov)}°`;
          }
        };
        animate();
        if (!disposed) setLoading(false);

        cleanup = () => {
          cancelAnimationFrame(raf);
          dom.removeEventListener("pointerdown", onDown);
          dom.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          dom.removeEventListener("wheel", onWheel);
          ro.disconnect();
          geometry.dispose(); captureGeometry?.dispose(); material.dispose(); texture.dispose(); renderer.dispose();
          (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
          if (dom.parentNode) dom.parentNode.removeChild(dom);
          if (apiRef) apiRef.current = null;
        };
      } catch (e) {
        if (!disposed) { setError(e instanceof Error ? e.message : "全景加载失败"); setLoading(false); }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
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
