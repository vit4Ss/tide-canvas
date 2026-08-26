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

/** 会话级通道记忆：代理在网络层失败/首包超时过一次，本会话后续加载直接走
 *  直连，免得每个模型都白等一次探测。HTTP 业务错（403/404）不记——代理本身可用。 */
let preferDirectFetch = false;

function isSignedAssetURL(raw: string): boolean {
  try {
    const keys = new Set(Array.from(new URL(raw).searchParams.keys(), (key) => key.toLowerCase()));
    return [
      "q-signature",
      "q-sign-time",
      "q-key-time",
      "x-cos-security-token",
      "x-amz-signature",
      "x-oss-signature",
      "signature",
    ].some((key) => keys.has(key));
  } catch {
    return false;
  }
}

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
  const geometries = new Set<THREE_NS.BufferGeometry>();
  const materials = new Set<THREE_NS.Material>();
  const textures = new Set<THREE_NS.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE_NS.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    mats.forEach((m) => {
      materials.add(m);
      Object.values(m as unknown as Record<string, unknown>).forEach((value) => {
        const texture = value as THREE_NS.Texture | undefined;
        if (texture?.isTexture) textures.add(texture);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

export function ThreeDViewport({
  glbUrl,
  onStats,
  compact = false,
  initialMode = "shaded",
}: {
  /** 当前展示的 GLB 地址；null = 清空场景（外层负责空态/占位展示）。 */
  glbUrl: string | null;
  /** 加载完成后回传实测网格统计（null = 无模型/加载失败）。 */
  onStats?: (stats: MeshStats | null) => void;
  /** Canvas cards hide secondary controls and keep only direct orbit interaction. */
  compact?: boolean;
  /** Models start as a white blocking model; the toolbar can restore embedded materials. */
  initialMode?: ViewMode;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ViewerApi | null>(null);
  const initialModeRef = useRef(initialMode);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  /** 下载进度 0–99；null = 长度未知（不定态，只转圈不报数）。 */
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(() => initialModeRef.current);
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
      let curMode: ViewMode = initialModeRef.current;

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
      let loadCtrl: AbortController | null = null;
      const loader = new GLTFLoader();

      // GLB 魔数（"glTF"）校验：代理回 JSON 错误体 / 中转页的坏字节不进解析器
      const isGlb = (buf: ArrayBuffer) =>
        buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === 0x46546c67;

      // 流式读响应体，按 content-length 上报整数百分比（长度未知报 null）
      const readBody = async (
        resp: Response,
        onProgress: (pct: number | null) => void,
      ): Promise<ArrayBuffer> => {
        const total = Number(resp.headers.get("content-length") || 0);
        if (!resp.body || !total) {
          onProgress(null);
          return resp.arrayBuffer();
        }
        const reader = resp.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        let lastPct = -1;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          const pct = Math.min(99, Math.floor((received / total) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(pct);
          }
        }
        const out = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        return out.buffer as ArrayBuffer;
      };

      /* 取模型字节，两条通道自动择优：
         - 代理 /api/files/download（鉴权 + SSRF 防护）：服务端出网受阻的环境
           会挂满 60s 超时，这里只给 4s 首包时限，超了立刻换直连，不让用户干等；
         - 浏览器直连：对象存储对 GET 普遍开 CORS。
         首选通道由 preferDirectFetch（会话记忆）决定，失败自动落到另一条。 */
      const PROXY_HEADER_TIMEOUT = 4_000;
      const fetchModelBytes = async (
        url: string,
        signal: AbortSignal,
        onProgress: (pct: number | null) => void,
      ): Promise<ArrayBuffer> => {
        const viaProxy = async () => {
          const ctrl = new AbortController();
          const propagate = () => ctrl.abort();
          signal.addEventListener("abort", propagate);
          if (signal.aborted) propagate(); // 监听器不补发既往事件，已中止就即刻传播
          // 首包时限只护到响应头到达；正文下载不限时（大 GLB 本来就慢）
          let timedOut = false;
          const headerTimer = setTimeout(() => {
            timedOut = true;
            propagate();
          }, PROXY_HEADER_TIMEOUT);
          try {
            const resp = await fetchWithAuth(
              `/api/files/download?url=${encodeURIComponent(url)}`,
              { signal: ctrl.signal },
            );
            clearTimeout(headerTimer);
            if (!resp.ok) throw new Error(`代理 HTTP ${resp.status}`);
            const buf = await readBody(resp, onProgress);
            if (!isGlb(buf)) throw new Error("代理返回的不是 GLB 内容");
            return buf;
          } catch (err) {
            // 首包超时的 AbortError 是浏览器英文话术，换成能看懂的原因
            if (timedOut && !signal.aborted) throw new Error("代理连接超时");
            throw err;
          } finally {
            clearTimeout(headerTimer);
            signal.removeEventListener("abort", propagate);
          }
        };
        const direct = async () => {
          const resp = await fetch(url, { mode: "cors", credentials: "omit", signal });
          if (!resp.ok) throw new Error(`直连 HTTP ${resp.status}`);
          const buf = await readBody(resp, onProgress);
          if (!isGlb(buf)) throw new Error("文件不是 GLB 格式");
          return buf;
        };

        const attempts = preferDirectFetch ? [direct, viaProxy] : [viaProxy, direct];
        let firstErr: Error | null = null;
        for (const attempt of attempts) {
          try {
            return await attempt();
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            if (signal.aborted) throw e;
            // 代理网络层失败/首包超时（消息不带 HTTP 状态）→ 本会话记住走直连
            if (attempt === viaProxy && !/HTTP \d/.test(e.message)) preferDirectFetch = true;
            firstErr = firstErr ?? e;
            onProgress(null); // 换通道重下，进度回到不定态
          }
        }
        if (isSignedAssetURL(url)) throw new Error("模型文件链接已失效");
        throw firstErr ?? new Error("模型下载失败");
      };

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
        loadCtrl?.abort(); // 掐掉上一个模型仍在途的下载，不浪费带宽
        loadCtrl = new AbortController();
        const signal = loadCtrl.signal;
        clearModel();
        onStatsRef.current?.(null);
        if (!url) {
          setLoading(false);
          setError(null);
          return;
        }
        setLoading(true);
        setProgress(null);
        setError(null);
        (async () => {
          let blobUrl = "";
          let pendingGroup: THREE_NS.Group | null = null;
          try {
            const buf = await fetchModelBytes(url, signal, (pct) => {
              if (!disposed && seq === loadSeq) setProgress(pct);
            });
            if (disposed || seq !== loadSeq) return;
            blobUrl = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
            const gltf = await loader.loadAsync(blobUrl);
            if (disposed || seq !== loadSeq) {
              disposeObject(gltf.scene);
              return;
            }

            // 归一化：置于原点、底面落在网格上、最长边缩放到 ~1.9 单位
            const group = gltf.scene;
            pendingGroup = group;
            const box = new THREE.Box3().setFromObject(group);
            if (box.isEmpty()) throw new Error("GLB 不含可渲染几何体");
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            if (!Number.isFinite(maxDim) || maxDim <= 0) throw new Error("GLB 几何尺寸无效");
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
            pendingGroup = null;
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
            if (pendingGroup) disposeObject(pendingGroup);
            if (disposed || seq !== loadSeq) return;
            console.error("[3D 工作台] 模型加载失败:", url, err);
            setLoading(false);
            if (err instanceof Error && err.message === "模型文件链接已失效") {
              setError("模型文件链接已失效，请重新生成该作品");
              return;
            }
            const detail = err instanceof Error && err.message ? `（${err.message}）` : "";
            setError(`模型加载失败${detail}，可尝试直接下载源文件`);
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
        loadCtrl?.abort();
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
    if (!ready) return;
    // A newly selected/generated asset always starts in the requested default
    // mode instead of inheriting the previous model's toolbar selection.
    const defaultMode = initialModeRef.current;
    setMode(defaultMode);
    apiRef.current?.setMode(defaultMode);
    apiRef.current?.loadModel(glbUrl);
  }, [glbUrl, ready]);
  useEffect(() => {
    apiRef.current?.setMode(mode);
  }, [mode, ready]);
  useEffect(() => {
    apiRef.current?.setGrid(grid);
  }, [grid, ready]);

  return (
    <div className="t3d-viewport relative h-full min-h-0 w-full overflow-hidden">
      <div ref={mountRef} className="t3d-canvas absolute inset-0 [&>canvas]:block" />

      {/* 地面网格开关（右上，复用面板的开关件语言） */}
      {!compact && <div className="t3d-gridrow">
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
      </div>}

      {/* 查看模式（底部居中工具条） */}
      {!compact && glbUrl && !loading && !error && (
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
        <div className="t3d-note absolute left-1/2 top-1/2 z-[3] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg bg-black/55 px-3 py-2 text-xs text-white/80 backdrop-blur">
          <span className="t3d-spin h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
          正在加载模型…{progress !== null ? ` ${progress}%` : ""}
        </div>
      )}
      {error && <div className="t3d-note absolute left-1/2 top-1/2 z-[3] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/55 px-3 py-2 text-center text-xs text-white/80 backdrop-blur">{error}</div>}
    </div>
  );
}
