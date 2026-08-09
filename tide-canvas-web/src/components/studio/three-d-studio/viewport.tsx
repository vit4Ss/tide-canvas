"use client";

/* ============================================================================
   ThreeDViewport — /three-d 工作台右侧的交互式 GLB 查看器。

   three.js 全量动态 import（与 canvas/nodes/scene-3d-editor 同款按需加载，
   不进首屏 bundle）。生成结果多为中转站/OSS 外链，直接 GLTFLoader.load 会被
   CORS 拦下 —— 统一走后端代理 /api/files/download 取同源字节 → blob URL。

   查看模式：贴图（原材质）/ 白模（统一素色材质）/ 线框；地面网格可开关；
   左上角展示 拓扑/面数/顶点数（从加载后的 geometry 实测，不信任上游标称）。
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { fetchWithAuth } from "@/lib/http";

export type ViewMode = "shaded" | "solid" | "wire";

interface ViewerApi {
  loadModel: (url: string | null) => void;
  setMode: (m: ViewMode) => void;
  setGrid: (visible: boolean) => void;
  dispose: () => void;
}

export interface MeshStats {
  tris: number;
  verts: number;
}

/** dispose a model subtree's geometries + materials + textures. */
function disposeObject(root: THREE_NS.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE_NS.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    mats.forEach((m) => {
      const rec = m as unknown as Record<string, unknown>;
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
        const tex = rec[key] as THREE_NS.Texture | undefined;
        if (tex && typeof tex.dispose === "function") tex.dispose();
      }
      m.dispose();
    });
  });
}

export function ThreeDViewport({
  glbUrl,
  onStats,
}: {
  /** 当前展示的 GLB 地址；null = 清空场景（外层负责空态/占位展示）。 */
  glbUrl: string | null;
  /** 加载完成后回传实测网格统计（null = 无模型/加载失败）。 */
  onStats?: (stats: MeshStats | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("shaded");
  const [grid, setGrid] = useState(true);
  // onStats 给最新引用，三维副作用内异步回调不吃闭包过期
  const onStatsRef = useRef(onStats);
  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);

  /* ── 场景初始化（挂载一次）────────────────────────────────────────────── */
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const mount = mountRef.current;
      if (disposed || !mount) return;

      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.touchAction = "none";
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // RoomEnvironment：无内嵌灯光的 PBR 资产也有均匀影棚光，贴图/金属度可读
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;

      const camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 100);
      camera.position.set(2.6, 1.9, 3.4);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.08;
      orbit.target.set(0, 0.75, 0);
      orbit.minDistance = 0.6;
      orbit.maxDistance = 12;
      orbit.update();

      // 补一点方向光让白模有明暗转折（纯环境光下白模是平的）
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(3, 5, 2.5);
      scene.add(key);
      const fill = new THREE.AmbientLight(0xffffff, 0.35);
      scene.add(fill);

      // 参考图同款「无限地面网格」：大网格 + 细分次级网格，颜色贴近面板界面
      const gridMajor = new THREE.GridHelper(40, 40, 0x3c3c46, 0x26262e);
      (gridMajor.material as THREE_NS.Material).transparent = true;
      (gridMajor.material as THREE_NS.Material).opacity = 0.55;
      scene.add(gridMajor);

      let model: THREE_NS.Group | null = null;
      /** mesh → 原始材质（贴图模式还原用）。 */
      const originals = new Map<THREE_NS.Mesh, THREE_NS.Material | THREE_NS.Material[]>();
      const solidMat = new THREE.MeshStandardMaterial({ color: 0xd6d6da, roughness: 0.75, metalness: 0.05 });
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x9a9aa4, wireframe: true });
      let curMode: ViewMode = "shaded";

      const applyMode = (m: ViewMode) => {
        curMode = m;
        if (!model) return;
        model.traverse((obj) => {
          const mesh = obj as THREE_NS.Mesh;
          if (!mesh.isMesh) return;
          if (m === "shaded") {
            const orig = originals.get(mesh);
            if (orig) mesh.material = orig;
          } else {
            mesh.material = m === "solid" ? solidMat : wireMat;
          }
        });
      };

      let loadSeq = 0;
      const loader = new GLTFLoader();

      const clearModel = () => {
        if (!model) return;
        scene.remove(model);
        // 还原原始材质引用后统一释放（solid/wire 共享材质不能随模型 dispose）
        originals.forEach((orig, mesh) => (mesh.material = orig));
        originals.clear();
        disposeObject(model);
        model = null;
      };

      const loadModel = (url: string | null) => {
        const seq = ++loadSeq;
        clearModel();
        onStatsRef.current?.(null);
        if (!url) {
          setLoading(false);
          setError(null);
          return;
        }
        setLoading(true);
        setError(null);
        (async () => {
          let blobUrl = "";
          try {
            // 后端代理拿字节（外链直连会 CORS）；GLB 自包含，blob URL 可整档解析
            const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(url)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            if (disposed || seq !== loadSeq) return;
            blobUrl = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
            const gltf = await loader.loadAsync(blobUrl);
            if (disposed || seq !== loadSeq) {
              disposeObject(gltf.scene);
              return;
            }

            // 归一化：置于原点、底面落在网格上、最长边缩放到 ~1.9 单位
            const group = gltf.scene;
            const box = new THREE.Box3().setFromObject(group);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const scale = 1.9 / maxDim;
            group.scale.setScalar(scale);
            const scaled = new THREE.Box3().setFromObject(group);
            const center = scaled.getCenter(new THREE.Vector3());
            group.position.x -= center.x;
            group.position.z -= center.z;
            group.position.y -= scaled.min.y;

            // 实测统计 + 记录原始材质
            let tris = 0;
            let verts = 0;
            group.traverse((obj) => {
              const mesh = obj as THREE_NS.Mesh;
              if (!mesh.isMesh) return;
              originals.set(mesh, mesh.material);
              const geo = mesh.geometry;
              if (geo?.index) tris += geo.index.count / 3;
              else if (geo?.attributes?.position) tris += geo.attributes.position.count / 3;
              if (geo?.attributes?.position) verts += geo.attributes.position.count;
            });

            model = group;
            scene.add(group);
            applyMode(curMode);
            // 视角回到默认取景（换模型后镜头不带旧姿态）
            const h2 = (scaled.max.y - scaled.min.y) / 2;
            orbit.target.set(0, Math.max(0.4, h2), 0);
            camera.position.set(2.6, 1.9, 3.4);
            orbit.update();
            onStatsRef.current?.({ tris: Math.round(tris), verts });
            setLoading(false);
          } catch (err) {
            if (disposed || seq !== loadSeq) return;
            console.error("[3D 工作台] 模型加载失败:", url, err);
            setLoading(false);
            setError("模型加载失败，可尝试直接下载源文件");
          } finally {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
          }
        })();
      };

      /* render loop + resize */
      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        orbit.update();
        renderer.render(scene, camera);
      };
      tick();
      const ro = new ResizeObserver(() => {
        const nw = mount.clientWidth || 1;
        const nh = mount.clientHeight || 1;
        renderer.setSize(nw, nh);
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
      });
      ro.observe(mount);

      apiRef.current = {
        loadModel,
        setMode: applyMode,
        setGrid: (v) => {
          gridMajor.visible = v;
        },
        dispose: () => {},
      };
      setReady(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        loadSeq += 1; // 掐掉在途加载
        clearModel();
        solidMat.dispose();
        wireMat.dispose();
        envTex.dispose();
        pmrem.dispose();
        orbit.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        apiRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  /* ── 外部状态 → 三维侧 ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (ready) apiRef.current?.loadModel(glbUrl);
  }, [glbUrl, ready]);
  useEffect(() => {
    apiRef.current?.setMode(mode);
  }, [mode, ready]);
  useEffect(() => {
    apiRef.current?.setGrid(grid);
  }, [grid, ready]);

  return (
    <div className="t3d-viewport">
      <div ref={mountRef} className="t3d-canvas" />

      {/* 地面网格开关（右上，复用面板的开关件语言） */}
      <div className="t3d-gridrow">
        <span>地面网格</span>
        <button
          type="button"
          role="switch"
          aria-checked={grid}
          className={`ws-3d-switch${grid ? " on" : ""}`}
          onClick={() => setGrid((v) => !v)}
        >
          <i />
        </button>
      </div>

      {/* 查看模式（底部居中工具条） */}
      {glbUrl && !loading && !error && (
        <div className="t3d-toolbar" role="group" aria-label="查看模式">
          {([
            ["shaded", "贴图"],
            ["solid", "白模"],
            ["wire", "线框"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={mode === value ? "on" : undefined}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="t3d-note">
          <span className="t3d-spin" aria-hidden />
          正在加载模型…
        </div>
      )}
      {error && <div className="t3d-note">{error}</div>}
    </div>
  );
}
