"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import type * as THREE_NS from "three";

interface Props {
  src: string;
  title?: string;
  onClose: () => void;
}

/**
 * 360° 全景查看器：把图片作为等距柱状全景贴到球体内壁，拖动环视、滚轮缩放。
 * <p>
 * 经后端下载代理把图片取成<b>同源 blob</b> 再做贴图，规避 WebGL 跨域贴图被污染（无需上游 CORS）。
 * three.js 动态按需加载，不进首屏包。
 *
 * @author tidecanvas
 */
export function PanoramaViewer({ src, title, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import("three");
        // 后端代理 → 同源字节 → blob 贴图（避免跨域污染）
        const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
        const resp = await fetch(`/api/files/download?url=${encodeURIComponent(src)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error("图片加载失败");
        const buf = await resp.arrayBuffer();
        if (disposed) return;
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        const texture = await new Promise<THREE_NS.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(blobUrl, resolve, undefined, () => reject(new Error("贴图解析失败")));
        });
        URL.revokeObjectURL(blobUrl);
        const mount = mountRef.current;
        if (disposed || !mount) { texture.dispose(); return; }

        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1100);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(w, h);
        mount.appendChild(renderer.domElement);

        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1); // 翻转法线，从球体内部观看
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);

        // 交互：拖动环视，滚轮缩放 FOV
        let lon = 0, lat = 0;
        let isDown = false, downX = 0, downY = 0, downLon = 0, downLat = 0;
        const dom = renderer.domElement;
        const onPointerDown = (e: PointerEvent) => { isDown = true; downX = e.clientX; downY = e.clientY; downLon = lon; downLat = lat; };
        const onPointerMove = (e: PointerEvent) => {
          if (!isDown) return;
          lon = downLon - (e.clientX - downX) * 0.1;
          lat = Math.max(-85, Math.min(85, downLat + (e.clientY - downY) * 0.1));
        };
        const onPointerUp = () => { isDown = false; };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05));
          camera.updateProjectionMatrix();
        };
        dom.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        dom.addEventListener("wheel", onWheel, { passive: false });

        const onResize = () => {
          const nw = mount.clientWidth || 1, nh = mount.clientHeight || 1;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        };
        window.addEventListener("resize", onResize);

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          const phi = THREE.MathUtils.degToRad(90 - lat);
          const theta = THREE.MathUtils.degToRad(lon);
          camera.lookAt(
            500 * Math.sin(phi) * Math.cos(theta),
            500 * Math.cos(phi),
            500 * Math.sin(phi) * Math.sin(theta),
          );
          renderer.render(scene, camera);
        };
        animate();
        if (!disposed) setLoading(false);

        cleanup = () => {
          cancelAnimationFrame(raf);
          dom.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          dom.removeEventListener("wheel", onWheel);
          window.removeEventListener("resize", onResize);
          geometry.dispose();
          material.dispose();
          texture.dispose();
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/90" onMouseDown={(e) => e.stopPropagation()}>
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
        {title || "全景"} · 拖动环视 / 滚轮缩放
      </div>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        title="关闭 (Esc)"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
