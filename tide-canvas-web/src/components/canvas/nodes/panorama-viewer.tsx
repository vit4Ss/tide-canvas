"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCw, Compass, Download, Globe } from "lucide-react";
import { toast } from "@/components/shared/toast";
import { fetchWithAuth } from "@/lib/http";
import type * as THREE_NS from "three";

interface Props {
  src: string;
  title?: string;
  onClose: () => void;
}

type ViewMode = "sphere" | "planet";

const FOV_MIN = 30;
const FOV_MAX = 100;
const FOV_DEFAULT = 75;
const clampFov = (v: number) => Math.max(FOV_MIN, Math.min(FOV_MAX, v));
const PLANET_ZOOM_MIN = 0.4;
const PLANET_ZOOM_MAX = 3;
const PLANET_ZOOM_DEFAULT = 1.2;
const clampPlanet = (v: number) => Math.max(PLANET_ZOOM_MIN, Math.min(PLANET_ZOOM_MAX, v));

// 小行星：立体投影着色器（把等距柱状全景投影成漂浮的小星球）。直接采样「原样」贴图后直通输出，
// 颜色与球面模式一致。uZoom 越大 → 收进更多球面 → 星球越小、天空越多。
const PLANET_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
const PLANET_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D pano;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;
uniform float uAspect;
const float PI = 3.141592653589793;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uAspect;
  float r = length(p) * uZoom;
  float theta = 2.0 * atan(r);            // 距天底(俯视中心)的极角：中心=地面，外缘=天空
  float phi = atan(p.y, p.x) + uYaw;      // 方位角 + 水平自转
  vec3 dir = vec3(sin(theta) * cos(phi), -cos(theta), sin(theta) * sin(phi));
  float cp = cos(uPitch), sp = sin(uPitch); // 绕 X 轴俯仰，可侧看星球
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
  float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
  gl_FragColor = texture2D(pano, vec2(u, v));
}`;

/**
 * 360° 全景查看器，两种形态：
 * <ul>
 *   <li><b>球面环视</b>：图片贴到球体内壁，拖动环视、滚轮/双指缩放；带惯性、空闲自动缓旋。</li>
 *   <li><b>小行星 (Tiny Planet)</b>：立体投影把全景星球化，拖动旋转/俯仰、缩放控制星球大小。</li>
 * </ul>
 * 两形态共用经后端代理取回的<b>同源 blob</b> 贴图（规避 WebGL 跨域污染，无需上游 CORS）；
 * 球面用 sRGB 贴图走 three 色彩管理，小行星用「原样」贴图直通，二者颜色一致。three.js 动态加载。
 *
 * @author tidecanvas
 */
export function PanoramaViewer({ src, title, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  // 由 three 副作用内部填充的控制方法，供屏幕按钮调用
  const apiRef = useRef<{ zoom: (delta: number) => void; reset: () => void } | null>(null);
  // 状态镜像进 ref，供 rAF 循环 / 事件回调读取（切换时不重建场景）
  const autoRotateRef = useRef(true);
  const modeRef = useRef<ViewMode>("sphere");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [mode, setMode] = useState<ViewMode>("sphere");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import("three");
        // 后端代理 → 同源字节 → blob 贴图（避免跨域污染）
        const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(src)}`);
        if (!resp.ok) throw new Error("图片加载失败");
        const buf = await resp.arrayBuffer();
        if (disposed) return;
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        const loadTexture = () => new Promise<THREE_NS.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(blobUrl, resolve, undefined, () => reject(new Error("贴图解析失败")));
        });
        // 两份独立贴图：球面用 sRGB（走 three 色管），小行星用原样（着色器直通），二者上传格式互不影响
        const [texture, planetTex] = await Promise.all([loadTexture(), loadTexture()]);
        URL.revokeObjectURL(blobUrl);
        const mount = mountRef.current;
        if (disposed || !mount) { texture.dispose(); planetTex.dispose(); return; }

        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(w, h);
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        // —— 球面环视 ——
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(FOV_DEFAULT, w / h, 0.1, 1100);
        const geometry = new THREE.SphereGeometry(500, 64, 48);
        geometry.scale(-1, 1, 1); // 翻转法线，从球体内部观看
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);

        // —— 小行星（全屏四边形 + 立体投影着色器）——
        planetTex.colorSpace = THREE.NoColorSpace; // 原样上传，着色器直通输出，颜色对齐球面
        planetTex.wrapS = THREE.RepeatWrapping;
        planetTex.wrapT = THREE.ClampToEdgeWrapping;
        planetTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        planetTex.needsUpdate = true;
        const planetUniforms = {
          pano: { value: planetTex },
          uYaw: { value: 0 },
          uPitch: { value: 0 },
          uZoom: { value: PLANET_ZOOM_DEFAULT },
          uAspect: { value: w / h },
        };
        const planetMat = new THREE.ShaderMaterial({
          uniforms: planetUniforms,
          vertexShader: PLANET_VERT,
          fragmentShader: PLANET_FRAG,
          depthTest: false,
          depthWrite: false,
        });
        const planetQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), planetMat);
        planetQuad.frustumCulled = false;
        const planetScene = new THREE.Scene();
        planetScene.add(planetQuad);
        const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // ===== 交互状态（球面/小行星共用 lon/lat + 自动旋转 + 惯性）=====
        let lon = 180, lat = 0;        // 球面：经/纬；小行星：水平自转 / 俯仰
        let vLon = 0, vLat = 0;        // 角速度（惯性）
        let targetFov = FOV_DEFAULT;   // 球面缩放目标
        let planetZoom = PLANET_ZOOM_DEFAULT; // 小行星缩放
        let lastInteract = 0;
        const dom = renderer.domElement;
        const pointers = new Map<number, { x: number; y: number }>();
        let dragId = -1, downX = 0, downY = 0, downLon = 0, downLat = 0;
        let pinchDist = 0, pinchFov = FOV_DEFAULT, pinchZoom = PLANET_ZOOM_DEFAULT;

        const markInteract = () => { lastInteract = performance.now(); };
        const startDrag = (id: number, x: number, y: number) => {
          dragId = id; downX = x; downY = y; downLon = lon; downLat = lat; vLon = 0; vLat = 0;
        };
        const applyZoom = (toward: number) => {
          // toward<0 放大 / >0 缩小，正负与球面 FOV 语义一致
          if (modeRef.current === "planet") planetZoom = clampPlanet(planetZoom + toward * 0.03);
          else targetFov = clampFov(targetFov + toward);
          markInteract();
        };

        const onPointerDown = (e: PointerEvent) => {
          dom.setPointerCapture?.(e.pointerId);
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          markInteract();
          if (pointers.size === 1) {
            startDrag(e.pointerId, e.clientX, e.clientY);
          } else if (pointers.size === 2) {
            dragId = -1;
            const pts = [...pointers.values()];
            pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            pinchFov = targetFov;
            pinchZoom = planetZoom;
          }
        };
        const onPointerMove = (e: PointerEvent) => {
          if (!pointers.has(e.pointerId)) return;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          markInteract();
          if (pointers.size >= 2) {
            const pts = [...pointers.values()];
            const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            if (modeRef.current === "planet") planetZoom = clampPlanet(pinchZoom * (pinchDist / d));
            else targetFov = clampFov(pinchFov * (pinchDist / d));
          } else if (e.pointerId === dragId) {
            e.preventDefault();
            const nLon = downLon - (e.clientX - downX) * 0.1;
            const nLat = Math.max(-85, Math.min(85, downLat + (e.clientY - downY) * 0.1));
            vLon = nLon - lon; vLat = nLat - lat;
            lon = nLon; lat = nLat;
          }
        };
        const onPointerUp = (e: PointerEvent) => {
          pointers.delete(e.pointerId);
          if (dom.hasPointerCapture?.(e.pointerId)) dom.releasePointerCapture(e.pointerId);
          if (e.pointerId === dragId) dragId = -1;
          if (pointers.size === 1) {
            const [[id, p]] = [...pointers.entries()];
            startDrag(id, p.x, p.y);
          }
          markInteract();
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          if (modeRef.current === "planet") planetZoom = clampPlanet(planetZoom + e.deltaY * 0.0015);
          else targetFov = clampFov(targetFov + e.deltaY * 0.05);
          markInteract();
        };
        dom.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        dom.addEventListener("wheel", onWheel, { passive: false });

        const onResize = () => {
          const nw = mount.clientWidth || 1, nh = mount.clientHeight || 1;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          planetUniforms.uAspect.value = nw / nh;
          renderer.setSize(nw, nh);
        };
        window.addEventListener("resize", onResize);
        document.addEventListener("fullscreenchange", onResize);

        apiRef.current = {
          zoom: applyZoom,
          reset: () => { lon = 180; lat = 0; vLon = 0; vLat = 0; targetFov = FOV_DEFAULT; planetZoom = PLANET_ZOOM_DEFAULT; markInteract(); },
        };

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          const dragging = dragId !== -1 || pointers.size >= 2;
          if (!dragging) {
            lon += vLon;
            lat = Math.max(-85, Math.min(85, lat + vLat));
            vLon *= 0.92; vLat *= 0.92;
            if (Math.abs(vLon) < 0.001) vLon = 0;
            if (Math.abs(vLat) < 0.001) vLat = 0;
            if (autoRotateRef.current && vLon === 0 && vLat === 0 && performance.now() - lastInteract > 2000) {
              lon -= 0.06;
            }
          }
          if (modeRef.current === "planet") {
            planetUniforms.uYaw.value = THREE.MathUtils.degToRad(lon);
            planetUniforms.uPitch.value = THREE.MathUtils.degToRad(lat);
            planetUniforms.uZoom.value = planetZoom;
            renderer.render(planetScene, orthoCam);
          } else {
            if (Math.abs(targetFov - camera.fov) > 0.01) {
              camera.fov += (targetFov - camera.fov) * 0.15;
              camera.updateProjectionMatrix();
            }
            const phi = THREE.MathUtils.degToRad(90 - lat);
            const theta = THREE.MathUtils.degToRad(lon);
            camera.lookAt(
              500 * Math.sin(phi) * Math.cos(theta),
              500 * Math.cos(phi),
              500 * Math.sin(phi) * Math.sin(theta),
            );
            renderer.render(scene, camera);
          }
        };
        animate();
        if (!disposed) setLoading(false);

        cleanup = () => {
          cancelAnimationFrame(raf);
          dom.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          dom.removeEventListener("wheel", onWheel);
          window.removeEventListener("resize", onResize);
          document.removeEventListener("fullscreenchange", onResize);
          apiRef.current = null;
          geometry.dispose();
          material.dispose();
          texture.dispose();
          planetQuad.geometry.dispose();
          planetMat.dispose();
          planetTex.dispose();
          renderer.dispose();
          if (dom.parentNode) dom.parentNode.removeChild(dom);
        };
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : "全景加载失败");
          setLoading(false);
        }
      }
    })();
    return () => { disposed = true; cleanup(); };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  }, []);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(src)}&name=${encodeURIComponent(title || "panorama")}`);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `${title || "panorama"}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(u);
    } catch {
      toast.error("下载失败，请稍后重试");
    } finally {
      setDownloading(false);
    }
  }, [src, title, downloading]);

  const isPlanet = mode === "planet";
  const ctrlBtn = "flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white";

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[200] bg-black/90" onMouseDown={(e) => e.stopPropagation()}>
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/80">{error}</div>
      )}
      <div className="pointer-events-none absolute left-4 top-4 rounded-lg bg-black/40 px-3 py-1.5 text-sm text-white">
        {title || "全景"} · {isPlanet ? "小行星：拖动旋转 / 缩放控制星球大小" : "拖动环视 / 滚轮 · 双指缩放"}
      </div>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        title="关闭 (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 屏幕工具栏：小行星 / 自动旋转 / 缩放 / 复位 / 全屏 / 下载 */}
      {!error && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/50 px-2 py-1.5 backdrop-blur-md">
          <button
            onClick={() => setMode((m) => (m === "planet" ? "sphere" : "planet"))}
            title={isPlanet ? "退出小行星" : "小行星视图"}
            className={`${ctrlBtn} ${isPlanet ? "bg-white/20 !text-white" : ""}`}
          >
            <Globe className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={() => setAutoRotate((v) => !v)}
            title={autoRotate ? "停止自动旋转" : "自动旋转"}
            className={`${ctrlBtn} ${autoRotate ? "bg-white/20 !text-white" : ""}`}
          >
            <RotateCw className={`h-[18px] w-[18px] ${autoRotate ? "animate-[spin_4s_linear_infinite]" : ""}`} />
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <button onClick={() => apiRef.current?.zoom(10)} title="缩小" className={ctrlBtn}><ZoomOut className="h-[18px] w-[18px]" /></button>
          <button onClick={() => apiRef.current?.reset()} title="复位视角" className={ctrlBtn}><Compass className="h-[18px] w-[18px]" /></button>
          <button onClick={() => apiRef.current?.zoom(-10)} title="放大" className={ctrlBtn}><ZoomIn className="h-[18px] w-[18px]" /></button>
          <span className="mx-0.5 h-4 w-px bg-white/20" />
          <button onClick={toggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"} className={ctrlBtn}>
            {isFullscreen ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
          </button>
          <button onClick={handleDownload} title="下载全景图" className={ctrlBtn}>
            {downloading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Download className="h-[18px] w-[18px]" />}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
