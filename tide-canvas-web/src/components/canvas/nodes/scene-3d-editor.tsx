"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, RotateCcw, Camera, Video, PersonStanding, Plus, Trash2, Eye } from "lucide-react";
import type * as THREE_NS from "three";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import { uploadFileSmart } from "@/lib/api";
import { fetchWithAuth } from "@/lib/http";
import { toast } from "@/components/shared/toast";
import {
  buildMannequinFigure, buildSkinnedFigure, parseState, lightPositionFromAngles, makeLabelSprite, characterNameByIndex,
  LIGHT_NAMES, LIGHT_PRESETS, CHARACTER_COLORS, DEFAULT_ENV, POSE_SLIDER_GROUPS,
  type Scene3DState, type Scene3DEnv, type Scene3DCharacter, type Scene3DRig, type Figure, type SkinnedAsset,
} from "./scene-3d-rig";

interface Props {
  node: CanvasNode;
  onClose: () => void;
}

interface EditorApi {
  select: (kind: "char" | "rig", id: string) => void;
  deselect: () => void;
  addCharacter: () => void;
  removeCharacter: (id: string) => void;
  setCharRotY: (id: string, deg: number) => void;
  setCharScale: (id: string, scale: number) => void;
  applyPose: (name: string) => void;
  resetPose: () => void;
  setPoseParam: (key: string, deg: number) => void;
  addRig: () => void;
  removeRig: (id: string) => void;
  setRigFov: (id: string, fov: number) => void;
  enterRigView: (id: string) => void;
  exitRigView: () => void;
  setView: (name: string) => void;
  setLight: (p: { preset?: string; azimuth?: number; elevation?: number; intensity?: number; ambient?: number }) => void;
  setEnv: (p: Partial<Scene3DEnv>) => void;
  snapshot: () => Promise<Blob | null>;
  getState: () => Scene3DState;
}

/** 预设机位（球坐标：theta 为绕 Y 轴方位角，phi 为自 +Y 的极角）。木偶面朝 +Z，theta=0 即正面；半径沿用当前值保持取景距离。 */
const CAMERA_VIEWS: Record<string, { theta: number; phi: number }> = {
  "正面": { theta: 0, phi: 1.35 },
  "45°": { theta: Math.PI / 4, phi: 1.15 },
  "左侧": { theta: Math.PI / 2, phi: 1.35 },
  "右侧": { theta: -Math.PI / 2, phi: 1.35 },
  "背面": { theta: Math.PI, phi: 1.35 },
  "俯视": { theta: Math.PI / 4, phi: 0.5 },
};
const VIEW_NAMES = Object.keys(CAMERA_VIEWS);

/** 截图落画布的图片节点基准宽度（与图片节点 IMAGE_CARD_BASE_WIDTH 一致） */
const SHOT_CARD_WIDTH = 608;

/** 新角色出生位（围绕原点左右交替展开，避免重叠） */
function spawnX(index: number): number {
  if (index === 0) return 0;
  const k = Math.ceil(index / 2);
  return (index % 2 === 1 ? -k : k) * 0.9;
}

/** 滑杆行：细线轨道 + 可直接输入的数值框（输入中间态不强制回写，失焦后对齐实际值） */
function SliderRow({ label, value, min, max, step = 1, onChange, labelClass = "w-7" }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  labelClass?: string;
}) {
  const [text, setText] = useState(String(value));
  // 外部值变化时在渲染期同步输入框文本（React 官方「props 变化调整 state」模式，避免 effect 级联渲染）
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  const commit = (raw: string) => {
    setText(raw);
    if (raw === "" || raw === "-") return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <label className="flex items-center gap-2 text-[11px] text-white/60">
      <span className={`${labelClass} shrink-0`}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-line min-w-0 flex-1"
      />
      <input
        type="number" min={min} max={max} step={step} value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(String(value))}
        className="w-11 shrink-0 rounded border border-white/15 bg-white/5 px-1 py-0.5 text-right text-[11px] tabular-nums text-white outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

export function Scene3DEditor({ node, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<EditorApi | null>(null);
  const updateNode = useCanvasStore((s) => s.updateNode);

  // 持久化状态只解析一次（v1 自动迁移 v2）；刻意只跟随 node.id，编辑期间的写回不重建场景
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialState = useMemo(() => parseState(node.scene3d), [node.id]);

  // 已连接的全景背景：入边节点中优先取 360 全景图，其次任意图片
  const pano = useMemo(() => {
    const st = useCanvasStore.getState();
    const ins = st.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => st.nodes.find((n) => n.id === c.sourceId))
      .filter((n): n is CanvasNode => !!n && !!n.imageSrc && !n.videoSrc);
    return ins.find((n) => n.is360) ?? ins[0] ?? null;
  }, [node.id]);
  const panoUrl = pano?.imageSrc ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shotCount, setShotCount] = useState(0);

  // 场景对象与选中态（三维侧为权威，通过 setter 同步到 React）
  const [charList, setCharList] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [rigList, setRigList] = useState<Array<{ id: string; name: string }>>([]);
  const [sel, setSel] = useState<{ kind: "char" | "rig"; id: string } | null>(null);
  const [viewMode, setViewMode] = useState<"director" | "rig">("director");
  const [rotYDeg, setRotYDeg] = useState(0);
  const [charScale, setCharScaleState] = useState(1);
  const [rigFov, setRigFovState] = useState(50);
  const [posePreset, setPosePreset] = useState("");
  const [poseNames, setPoseNames] = useState<string[]>([]);
  const [poseParams, setPoseParams] = useState<Record<string, number>>({});
  const [charTab, setCharTab] = useState<"属性" | "姿势">("姿势");

  const [light, setLightState] = useState(() =>
    initialState?.light ?? { preset: "自然光", azimuth: 0.7, elevation: 0.9, intensity: 1.15, ambient: 0.55 });
  // 地面是纯阴影捕捉面（不渲染底座），连全景时也默认开启，让角色影子落在场景里
  const [env, setEnvState] = useState<Scene3DEnv>(() => initialState?.env ?? { ...DEFAULT_ENV });

  // 最新值给三维副作用内的命令式 API 读取（避免闭包过期）。须在三维副作用之前声明。
  const lightAnglesRef = useRef(light);
  useEffect(() => { lightAnglesRef.current = light; }, [light]);
  const envRef = useRef(env);
  useEffect(() => { envRef.current = env; }, [env]);

  // ===== three.js 场景 =====
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const initial = initialState;

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
        // Mixamo 人物模板（X Bot）：加载失败回退程序化木偶，不阻塞编辑器
        let xbotAsset: SkinnedAsset | null = null;
        let skClone: ((o: THREE_NS.Object3D) => THREE_NS.Object3D) | null = null;
        try {
          const [{ GLTFLoader }, sk] = await Promise.all([
            import("three/examples/jsm/loaders/GLTFLoader.js"),
            import("three/examples/jsm/utils/SkeletonUtils.js"),
          ]);
          const gltf = await new GLTFLoader().loadAsync("/models/xbot.glb");
          xbotAsset = { scene: gltf.scene, animations: gltf.animations };
          skClone = sk.clone;
        } catch (err) {
          console.error("[导演台] Mixamo 模型加载失败，回退木偶:", err);
          if (!disposed) toast.info("人物模型加载失败，已回退为基础木偶");
        }
        const mount = mountRef.current;
        if (disposed || !mount) return;

        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(envRef.current.skyColor);

        // ===== 导演相机 + 轨道 =====
        const dirCam = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
        const orbit = new OrbitControls(dirCam, renderer.domElement);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
        orbit.target.set(0, 0.95, 0);
        orbit.minDistance = 1.2;
        orbit.maxDistance = 30;
        orbit.maxPolarAngle = Math.PI * 0.49;
        if (initial) {
          const sph = new THREE.Spherical(initial.camera.radius, initial.camera.phi, initial.camera.theta);
          orbit.target.set(...initial.camera.target);
          dirCam.position.setFromSpherical(sph).add(orbit.target);
        } else {
          dirCam.position.set(2.4, 1.5, 3.8);
        }
        orbit.update();
        let activeCam: THREE_NS.PerspectiveCamera = dirCam;

        // ===== 地面（仅承接阴影的透明捕捉面，不渲染黑色底座）+ 网格 =====
        const groundGeo = new THREE.PlaneGeometry(60, 60);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);
        const grid = new THREE.GridHelper(20, 40, 0x334155, 0x1e293b);
        (grid.material as THREE_NS.Material).transparent = true;
        (grid.material as THREE_NS.Material).opacity = 0.5;
        scene.add(grid);
        ground.visible = envRef.current.showGround;
        grid.visible = envRef.current.showGround;

        // ===== 灯光（preset 不再接管背景色，背景由 env.skyColor / 全景球决定） =====
        const ambient = new THREE.AmbientLight(0xffffff, initial?.light.ambient ?? light.ambient);
        scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, initial?.light.intensity ?? light.intensity);
        dir.castShadow = true;
        dir.shadow.mapSize.set(1024, 1024);
        dir.shadow.camera.near = 0.5;
        dir.shadow.camera.far = 20;
        const sc = dir.shadow.camera as THREE_NS.OrthographicCamera;
        sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.updateProjectionMatrix();
        dir.target.position.set(0, 0.9, 0);
        scene.add(dir);
        scene.add(dir.target);
        const applyLightPos = (az: number, el: number) => dir.position.copy(lightPositionFromAngles(THREE, az, el, 6));
        applyLightPos(initial?.light.azimuth ?? light.azimuth, initial?.light.elevation ?? light.elevation);

        // ===== 全景背景球（等距柱状图贴内壁；geometry X 取负翻转避免镜像） =====
        let panoMesh: THREE_NS.Mesh | null = null;
        let panoTex: THREE_NS.Texture | null = null;
        let panoMat: THREE_NS.MeshBasicMaterial | null = null;
        // 已应用的水平旋转（度）：在三维侧自记账算增量，不依赖 React 状态同步时序
        let panoRotApplied = envRef.current.panoRotY;
        const UP_AXIS = new THREE.Vector3(0, 1, 0);
        const panoGeo = new THREE.SphereGeometry(1, 64, 32);
        panoGeo.scale(-1, 1, 1);
        if (panoUrl) {
          // 后端代理 → 同源字节 → blob 贴图：生成图多为中转站/OSS 外链，直接 TextureLoader 会被 CORS 拦下
          // （与 inline-panorama / panorama-viewer 的加载方案保持一致）
          (async () => {
            try {
              let blobUrl = panoUrl;
              if (!panoUrl.startsWith("data:")) {
                const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(panoUrl)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buf = await resp.arrayBuffer();
                if (disposed) return;
                blobUrl = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
              }
              const tex = await new Promise<THREE_NS.Texture>((resolve, reject) => {
                new THREE.TextureLoader().load(blobUrl, resolve, undefined, () => reject(new Error("贴图解析失败")));
              });
              if (blobUrl.startsWith("blob:")) URL.revokeObjectURL(blobUrl);
              if (disposed) { tex.dispose(); return; }
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
              panoTex = tex;
              panoMat = new THREE.MeshBasicMaterial({ map: tex });
              panoMesh = new THREE.Mesh(panoGeo, panoMat);
              panoMesh.scale.setScalar(envRef.current.panoRadius);
              panoMesh.rotation.y = THREE.MathUtils.degToRad(envRef.current.panoRotY);
              scene.add(panoMesh);
              // 相机始终留在全景球内，避免穿出后看到对面内壁的错位画面
              orbit.maxDistance = Math.min(30, Math.max(3, envRef.current.panoRadius * 0.85));
              orbit.update();
            } catch (err) {
              if (!disposed) {
                console.error("[导演台] 全景背景加载失败:", panoUrl, err);
                toast.error("全景背景加载失败，已使用天空颜色");
              }
            }
          })();
        }

        // ===== 角色管理 =====
        interface CharEntry {
          id: string; name: string; color: number;
          figure: Figure;
          label: { sprite: THREE_NS.Sprite; dispose: () => void };
          /** 名字标签基准尺寸（缩放角色时反向补偿，保持标签恒定大小） */
          labelBase: THREE_NS.Vector3;
        }
        const charsM = new Map<string, CharEntry>();
        let charSeq = 0;
        let selCharId: string | null = null;

        /** 应用角色整体缩放（夹在 0.3~3），名字标签反向补偿 */
        const applyCharScale = (e: CharEntry, scale: number) => {
          const s = Math.min(3, Math.max(0.3, scale || 1));
          e.figure.root.scale.setScalar(s);
          e.label.sprite.scale.set(e.labelBase.x / s, e.labelBase.y / s, 1);
        };

        const addCharInternal = (cs?: Scene3DCharacter): CharEntry => {
          const idx = charSeq++;
          const id = cs?.id ?? `c_${Date.now()}_${idx}`;
          const name = cs?.name ?? characterNameByIndex(idx);
          const color = cs?.color ?? CHARACTER_COLORS[idx % CHARACTER_COLORS.length];
          // 模板可用就统一用 Mixamo 模型（旧木偶存档一并升级外观；其关节数据因骨架不同不迁移，回到绑定姿势）
          const figure = xbotAsset && skClone
            ? buildSkinnedFigure(THREE, skClone, xbotAsset, color)
            : buildMannequinFigure(THREE, color);
          figure.root.position.set(...(cs?.pos ?? [spawnX(idx), 0, 0] as [number, number, number]));
          figure.root.rotation.y = cs?.rotY ?? 0;
          // 新角色 / 旧存档关节匹配不上（木偶存档升级为皮肤模型）时，默认自然站姿而非 T-Pose
          const applied = cs?.joints ? figure.applyRotations(cs.joints) : 0;
          if (applied === 0) figure.applyPosePreset("站立");
          // 姿势改由右侧滑杆面板调节，场景内不再显示关节球
          figure.jointBalls.forEach((b) => (b.visible = false));
          for (const m of figure.meshes) m.userData.charId = id;
          const label = makeLabelSprite(THREE, name);
          label.sprite.position.set(0, 2.0, 0);
          label.sprite.visible = envRef.current.showLabels;
          figure.root.add(label.sprite);
          scene.add(figure.root);
          const entry: CharEntry = { id, name, color, figure, label, labelBase: label.sprite.scale.clone() };
          if (cs?.scale && cs.scale !== 1) applyCharScale(entry, cs.scale);
          charsM.set(id, entry);
          return entry;
        };

        // ===== 机位管理（相机本体 + 机身盒 + 视锥线框） =====
        interface RigEntry {
          id: string; name: string;
          cam: THREE_NS.PerspectiveCamera;
          target: THREE_NS.Vector3;
          viz: THREE_NS.Group;
          body: THREE_NS.Mesh;
          vizDispose: () => void;
        }
        const rigsM = new Map<string, RigEntry>();
        let rigSeq = 0;
        let activeRigId: string | null = null;
        let savedDir: { pos: THREE_NS.Vector3; target: THREE_NS.Vector3 } | null = null;

        const buildRigViz = (id: string, fov: number, aspect: number) => {
          const g = new THREE.Group();
          const L = 1.5;
          const hh = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * L;
          const hw = hh * aspect;
          const corners: Array<[number, number]> = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
          const pts: number[] = [];
          for (const [cx, cy] of corners) pts.push(0, 0, 0, cx, cy, -L);
          for (let i = 0; i < 4; i++) {
            const [ax, ay] = corners[i];
            const [bx, by] = corners[(i + 1) % 4];
            pts.push(ax, ay, -L, bx, by, -L);
          }
          const lineGeo = new THREE.BufferGeometry();
          lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.75 });
          const lines = new THREE.LineSegments(lineGeo, lineMat);
          const bodyGeo = new THREE.BoxGeometry(0.24, 0.18, 0.32);
          const bodyMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          body.userData.rigId = id;
          g.add(lines);
          g.add(body);
          const vizDispose = () => { lineGeo.dispose(); lineMat.dispose(); bodyGeo.dispose(); bodyMat.dispose(); };
          return { g, body, vizDispose };
        };

        const addRigInternal = (rs?: Scene3DRig): RigEntry => {
          const idx = rigSeq++;
          const id = rs?.id ?? `r_${Date.now()}_${idx}`;
          const name = rs?.name ?? `机位${idx + 1}`;
          const cam = new THREE.PerspectiveCamera(rs?.fov ?? 50, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.1, 500);
          const target = new THREE.Vector3(...(rs?.target ?? orbit.target.toArray() as [number, number, number]));
          cam.position.set(...(rs?.pos ?? activeCam.position.toArray() as [number, number, number]));
          cam.lookAt(target);
          const { g, body, vizDispose } = buildRigViz(id, cam.fov, 16 / 9);
          cam.add(g);
          scene.add(cam);
          const entry: RigEntry = { id, name, cam, target, viz: g, body, vizDispose };
          rigsM.set(id, entry);
          return entry;
        };

        const refreshRigViz = () => {
          for (const [id, r] of rigsM) r.viz.visible = id !== activeRigId;
        };

        const syncLists = () => {
          setCharList([...charsM.values()].map((e) => ({ id: e.id, name: e.name, color: `#${e.color.toString(16).padStart(6, "0")}` })));
          setRigList([...rigsM.values()].map((r) => ({ id: r.id, name: r.name })));
        };

        // ===== 关节摆姿 / 移动 gizmo =====
        const tc = new TransformControls(activeCam, renderer.domElement);
        tc.setSpace("local");
        tc.setSize(0.7);
        const tcHelper = (tc as unknown as { getHelper?: () => THREE_NS.Object3D }).getHelper?.() ?? (tc as unknown as THREE_NS.Object3D);
        scene.add(tcHelper);
        let tcDragging = false;
        tc.addEventListener("dragging-changed", (e: { value: unknown }) => {
          tcDragging = !!e.value;
          orbit.enabled = !e.value;
        });

        const attachRoot = (e: CharEntry) => {
          tc.attach(e.figure.root);
          tc.setMode("translate");
          tc.setSpace("world");
          tc.showX = true; tc.showY = true; tc.showZ = true; // 三轴自由移动（绿色竖轴可抬离/贴合地面）
        };

        // ===== 选中逻辑（三维侧权威） =====
        const selectCharInternal = (id: string) => {
          const e = charsM.get(id);
          if (!e) return;
          selCharId = id;
          attachRoot(e);
          setPosePreset("");
          setPoseNames(e.figure.poseNames);
          setPoseParams(e.figure.getPoseParams());
          setRotYDeg(Math.round(THREE.MathUtils.radToDeg(e.figure.root.rotation.y)));
          setCharScaleState(Math.round(e.figure.root.scale.x * 100) / 100);
          setSel({ kind: "char", id });
        };
        const selectRigInternal = (id: string) => {
          const r = rigsM.get(id);
          if (!r) return;
          selCharId = null;
          tc.detach();
          setRigFovState(Math.round(r.cam.fov));
          setSel({ kind: "rig", id });
        };
        const deselectInternal = () => {
          selCharId = null;
          tc.detach();
          setSel(null);
        };

        // ===== 视角切换 =====
        const setActiveCamera = (cam: THREE_NS.PerspectiveCamera, target: THREE_NS.Vector3) => {
          activeCam = cam;
          orbit.object = cam;
          orbit.target.copy(target);
          orbit.update();
          (tc as unknown as { camera: THREE_NS.Camera }).camera = cam;
        };
        const enterRigViewInternal = (id: string) => {
          const r = rigsM.get(id);
          if (!r) return;
          if (!activeRigId) {
            savedDir = { pos: dirCam.position.clone(), target: orbit.target.clone() };
          } else {
            const prev = rigsM.get(activeRigId);
            prev?.target.copy(orbit.target);
          }
          activeRigId = id;
          setActiveCamera(r.cam, r.target);
          refreshRigViz();
          setViewMode("rig");
          selectRigInternal(id);
        };
        const exitRigViewInternal = () => {
          if (!activeRigId) return;
          const r = rigsM.get(activeRigId);
          r?.target.copy(orbit.target);
          activeRigId = null;
          if (savedDir) dirCam.position.copy(savedDir.pos);
          setActiveCamera(dirCam, savedDir?.target ?? new THREE.Vector3(0, 0.95, 0));
          refreshRigViz();
          setViewMode("director");
        };

        // ===== 点选（关节球 → 角色身体/机位机身 → 空白取消选择） =====
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const onPointerDown = (ev: PointerEvent) => {
          if (tcDragging) return;
          const rect = renderer.domElement.getBoundingClientRect();
          ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(ndc, activeCam);

          const targets: THREE_NS.Object3D[] = [];
          for (const e of charsM.values()) targets.push(...e.figure.meshes);
          for (const r of rigsM.values()) targets.push(r.body);
          const hits = raycaster.intersectObjects(targets, false).filter((x) => x.object.visible);
          if (hits.length) {
            const ud = hits[0].object.userData;
            if (ud.charId) selectCharInternal(ud.charId as string);
            else if (ud.rigId) selectRigInternal(ud.rigId as string);
            return;
          }
          deselectInternal();
        };
        renderer.domElement.addEventListener("pointerdown", onPointerDown);

        const onResize = () => {
          const nw = mount.clientWidth || 1, nh = mount.clientHeight || 1;
          dirCam.aspect = nw / nh;
          dirCam.updateProjectionMatrix();
          for (const r of rigsM.values()) {
            r.cam.aspect = nw / nh;
            r.cam.updateProjectionMatrix();
          }
          renderer.setSize(nw, nh);
        };
        window.addEventListener("resize", onResize);

        // ===== 初始还原（v1 已被 parseState 迁移为单角色 v2）；新场景默认为空，从「+ 角色」开始搭建 =====
        if (initial) {
          initial.characters.forEach((cs) => addCharInternal(cs));
          initial.rigs.forEach((rs) => addRigInternal(rs));
        }
        refreshRigViz();
        syncLists();

        // ===== 命令式 API（供 React 覆盖层调用） =====
        const round = (n: number) => Math.round(n * 1e4) / 1e4;
        apiRef.current = {
          select: (kind, id) => (kind === "char" ? selectCharInternal(id) : selectRigInternal(id)),
          deselect: deselectInternal,
          addCharacter: () => {
            const e = addCharInternal();
            syncLists();
            selectCharInternal(e.id);
          },
          removeCharacter: (id) => {
            const e = charsM.get(id);
            if (!e) return;
            if (selCharId === id) deselectInternal();
            scene.remove(e.figure.root);
            e.figure.dispose();
            e.label.dispose();
            charsM.delete(id);
            syncLists();
            setSel((s) => (s && s.kind === "char" && s.id === id ? null : s));
          },
          setCharRotY: (id, deg) => {
            const e = charsM.get(id);
            if (e) e.figure.root.rotation.y = THREE.MathUtils.degToRad(deg);
          },
          setCharScale: (id, scale) => {
            const e = charsM.get(id);
            if (e) applyCharScale(e, scale);
          },
          applyPose: (name) => {
            if (!selCharId) return;
            charsM.get(selCharId)?.figure.applyPosePreset(name);
            setPoseParams({});
          },
          resetPose: () => {
            if (!selCharId) return;
            charsM.get(selCharId)?.figure.resetPose();
            setPoseParams({});
          },
          setPoseParam: (key, deg) => {
            if (!selCharId) return;
            charsM.get(selCharId)?.figure.setPoseParam(key, deg);
          },
          addRig: () => {
            const r = addRigInternal();
            syncLists();
            selectRigInternal(r.id);
          },
          removeRig: (id) => {
            const r = rigsM.get(id);
            if (!r) return;
            if (activeRigId === id) exitRigViewInternal();
            scene.remove(r.cam);
            r.vizDispose();
            rigsM.delete(id);
            refreshRigViz();
            syncLists();
            setSel((s) => (s && s.kind === "rig" && s.id === id ? null : s));
          },
          setRigFov: (id, fov) => {
            const r = rigsM.get(id);
            if (!r) return;
            r.cam.fov = fov;
            r.cam.updateProjectionMatrix();
            // 视锥线框随 fov 重建
            r.cam.remove(r.viz);
            r.vizDispose();
            const { g, body, vizDispose } = buildRigViz(id, fov, 16 / 9);
            r.viz = g; r.body = body; r.vizDispose = vizDispose;
            r.cam.add(g);
            refreshRigViz();
          },
          enterRigView: enterRigViewInternal,
          exitRigView: exitRigViewInternal,
          setView: (name) => {
            const v = CAMERA_VIEWS[name];
            if (!v) return;
            const cur = new THREE.Spherical().setFromVector3(activeCam.position.clone().sub(orbit.target));
            activeCam.position.setFromSpherical(new THREE.Spherical(cur.radius, v.phi, v.theta)).add(orbit.target);
            orbit.update();
          },
          setLight: ({ preset, azimuth, elevation, intensity, ambient: amb }) => {
            if (preset && LIGHT_PRESETS[preset]) {
              const p = LIGHT_PRESETS[preset];
              ambient.intensity = p.ambient;
              dir.intensity = p.intensity;
              applyLightPos(p.azimuth, p.elevation);
            } else {
              if (typeof amb === "number") ambient.intensity = amb;
              if (typeof intensity === "number") dir.intensity = intensity;
              if (typeof azimuth === "number" || typeof elevation === "number") {
                const cur = lightAnglesRef.current;
                applyLightPos(azimuth ?? cur.azimuth, elevation ?? cur.elevation);
              }
            }
          },
          setEnv: (p) => {
            if (p.skyColor) scene.background = new THREE.Color(p.skyColor);
            if (p.showGround !== undefined) { ground.visible = p.showGround; grid.visible = p.showGround; }
            if (p.showLabels !== undefined) {
              for (const e of charsM.values()) e.label.sprite.visible = p.showLabels;
            }
            if (p.panoRotY !== undefined) {
              // 环境旋转时角色/机位一起绕原点转：保持「站在场景哪个位置」不变，
              // 否则背景转走、角色却留在世界原地，相对场景的位置就被改变了
              const delta = THREE.MathUtils.degToRad(p.panoRotY - panoRotApplied);
              panoRotApplied = p.panoRotY;
              if (panoMesh) panoMesh.rotation.y = THREE.MathUtils.degToRad(p.panoRotY);
              if (delta) {
                const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
                for (const e of charsM.values()) {
                  e.figure.root.position.applyAxisAngle(UP_AXIS, delta);
                  e.figure.root.rotation.y = wrap(e.figure.root.rotation.y + delta);
                }
                for (const r of rigsM.values()) {
                  r.cam.position.applyAxisAngle(UP_AXIS, delta);
                  if (activeRigId === r.id) {
                    orbit.target.applyAxisAngle(UP_AXIS, delta);
                    orbit.update();
                  } else {
                    r.target.applyAxisAngle(UP_AXIS, delta);
                    r.cam.lookAt(r.target);
                  }
                }
                if (selCharId) {
                  const e = charsM.get(selCharId);
                  if (e) setRotYDeg(Math.round(THREE.MathUtils.radToDeg(e.figure.root.rotation.y)));
                }
              }
            }
            if (p.panoRadius !== undefined) {
              if (panoMesh) panoMesh.scale.setScalar(p.panoRadius);
              // 半径变化时同步收紧轨道范围，相机不许穿出球外
              orbit.maxDistance = Math.min(30, Math.max(3, p.panoRadius * 0.85));
              orbit.update();
            }
          },
          snapshot: () =>
            new Promise<Blob | null>((resolve) => {
              tc.enabled = false;
              const hidden: Array<{ o: THREE_NS.Object3D; v: boolean }> = [];
              const hide = (o: THREE_NS.Object3D) => { hidden.push({ o, v: o.visible }); o.visible = false; };
              hide(tcHelper);
              hide(grid);
              for (const e of charsM.values()) {
                e.figure.jointBalls.forEach(hide);
                hide(e.label.sprite);
              }
              for (const r of rigsM.values()) hide(r.viz);
              renderer.render(scene, activeCam);
              renderer.domElement.toBlob((blob) => {
                tc.enabled = true;
                for (const { o, v } of hidden) o.visible = v;
                resolve(blob);
              }, "image/png");
            }),
          getState: () => {
            const characters: Scene3DCharacter[] = [...charsM.values()].map((e) => {
              const p = e.figure.root.position;
              return {
                id: e.id, name: e.name, color: e.color,
                pos: [round(p.x), round(p.y), round(p.z)],
                rotY: round(e.figure.root.rotation.y),
                scale: round(e.figure.root.scale.x),
                model: e.figure.model,
                joints: e.figure.collectRotations(),
              };
            });
            const rigs: Scene3DRig[] = [...rigsM.values()].map((r) => {
              const tgt = activeRigId === r.id ? orbit.target : r.target;
              return {
                id: r.id, name: r.name,
                pos: [round(r.cam.position.x), round(r.cam.position.y), round(r.cam.position.z)],
                target: [round(tgt.x), round(tgt.y), round(tgt.z)],
                fov: round(r.cam.fov),
              };
            });
            const dirPos = activeRigId && savedDir ? savedDir.pos : dirCam.position;
            const dirTgt = activeRigId && savedDir ? savedDir.target : orbit.target;
            const sph = new THREE.Spherical().setFromVector3(dirPos.clone().sub(dirTgt));
            const la = lightAnglesRef.current;
            return {
              v: 2,
              characters,
              rigs,
              camera: { theta: round(sph.theta), phi: round(sph.phi), radius: round(sph.radius), target: [round(dirTgt.x), round(dirTgt.y), round(dirTgt.z)] },
              light: { azimuth: la.azimuth, elevation: la.elevation, intensity: round(dir.intensity), ambient: round(ambient.intensity), preset: la.preset },
              env: envRef.current,
            };
          },
        };

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          orbit.update();
          renderer.render(scene, activeCam);
        };
        animate();
        if (!disposed) setLoading(false);

        cleanup = () => {
          cancelAnimationFrame(raf);
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("resize", onResize);
          tc.detach();
          tc.dispose();
          if (tcHelper.parent) tcHelper.parent.remove(tcHelper);
          orbit.dispose();
          for (const e of charsM.values()) { e.figure.dispose(); e.label.dispose(); }
          for (const r of rigsM.values()) r.vizDispose();
          // 皮肤模型模板：几何体/骨架被所有实例共享，统一在此释放
          if (xbotAsset) {
            xbotAsset.scene.traverse((o) => {
              const m = o as THREE_NS.Mesh;
              if (m.isMesh) {
                m.geometry.dispose();
                (m.material as THREE_NS.Material)?.dispose();
              }
            });
          }
          groundGeo.dispose();
          groundMat.dispose();
          grid.geometry.dispose();
          (grid.material as THREE_NS.Material).dispose();
          panoGeo.dispose();
          panoTex?.dispose();
          panoMat?.dispose();
          renderer.dispose();
          (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
          if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
          apiRef.current = null;
        };
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : "3D 编辑器初始化失败");
          setLoading(false);
        }
      }
    })();

    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const persist = useCallback(() => {
    try {
      const s = apiRef.current?.getState();
      if (s) updateNode(node.id, { scene3d: JSON.stringify(s) });
    } catch { /* ignore */ }
  }, [node.id, updateNode]);

  const handleClose = useCallback(() => { persist(); onClose(); }, [persist, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // ===== React 侧操作封装 =====
  const setEnvPartial = (p: Partial<Scene3DEnv>) => {
    setEnvState((s) => ({ ...s, ...p }));
    apiRef.current?.setEnv(p);
  };
  const pickPose = (name: string) => {
    setPosePreset(name);
    apiRef.current?.applyPose(name);
  };
  const pickLight = (preset: string) => {
    const p = LIGHT_PRESETS[preset];
    setLightState({ preset, azimuth: p.azimuth, elevation: p.elevation, intensity: p.intensity, ambient: p.ambient });
    apiRef.current?.setLight({ preset });
  };
  const setLightAngle = (k: "azimuth" | "elevation" | "intensity", v: number) => {
    setLightState((s) => ({ ...s, [k]: v, preset: "" }));
    apiRef.current?.setLight({ [k]: v } as { azimuth?: number });
  };
  const enterRigMode = () => {
    if (!rigList.length) { toast.info("先在左侧「+ 机位」添加一个机位"); return; }
    const id = sel?.kind === "rig" ? sel.id : rigList[0].id;
    apiRef.current?.enterRigView(id);
  };

  /** 截图以图片节点形式落到导演台右侧（多张时向下排列）并自动连线，作为下游 AI 生成的参考素材 */
  const spawnShotNode = (file: { fileUrl: string; fileSize: number; fileType: string; mimeType: string }) => {
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const cw = SHOT_CARD_WIDTH;
    const mount = mountRef.current;
    const ch = Math.round(cw * ((mount?.clientHeight || 9) / (mount?.clientWidth || 16)));
    const targetX = node.x + node.width + 80;
    const colNodes = st.nodes.filter((n) => {
      const nw = n.contentW ?? n.width;
      return n.x < targetX + cw && n.x + nw > targetX;
    });
    const targetY = colNodes.length
      ? Math.max(...colNodes.map((n) => n.y + (n.contentH ?? n.height ?? 0))) + 24
      : node.y;
    const count = st.nodes.filter((n) => n.type === "image" && n.title?.startsWith("导演台截图")).length;
    st.addNode({
      id: nid, type: "image", x: targetX, y: targetY,
      width: cw, height: ch, contentW: cw, contentH: ch,
      title: `导演台截图 ${count + 1}`, status: "success", imageSrc: file.fileUrl, fileSize: file.fileSize, fileType: file.fileType, mimeType: file.mimeType,
    }, true);
    st.addConnection({ id: `conn_${node.id}_${nid}`, sourceId: node.id, targetId: nid }, false);
  };

  const handleShot = async () => {
    if (busy || !apiRef.current) return;
    setBusy(true);
    try {
      const blob = await apiRef.current.snapshot();
      if (!blob) { toast.error("截图失败，请重试"); return; }
      const file = new File([blob], `director_${Date.now()}.png`, { type: "image/png" });
      const up = await uploadFileSmart(file);
      if (!up.success) { toast.error(up.message || "截图上传失败"); return; }
      const url = up.data.fileUrl;
      persist();
      updateNode(node.id, { imageSrc: url, fileSize: up.data.fileSize, fileType: up.data.fileType, mimeType: up.data.mimeType }); // 导演台预览 = 最近一次截图
      spawnShotNode(up.data);
      setShotCount((c) => c + 1);
      toast.success("已截图，图片节点已放入画布");
    } finally {
      setBusy(false);
    }
  };

  const btn = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
  const chip = (active: boolean) => `${btn} ${active ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`;
  const selChar = sel?.kind === "char" ? charList.find((c) => c.id === sel.id) : null;
  const selRig = sel?.kind === "rig" ? rigList.find((r) => r.id === sel.id) : null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-slate-950" onMouseDown={(e) => e.stopPropagation()}>
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}
      {error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/80">{error}</div>}

      {/* ===== 顶栏：标题 + 视角切换 + 关闭 ===== */}
      <div className="absolute inset-x-0 top-0 flex h-12 items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">3D 导演台</span>
          <span className="hidden text-xs text-white/40 xl:block">点选角色拖动摆位 · 右侧「姿势」面板调节动作 · 拖空白转视角 · 滚轮缩放</span>
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 rounded-full bg-white/10 p-0.5 backdrop-blur">
          <button
            onClick={() => apiRef.current?.exitRigView()}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${viewMode === "director" ? "bg-white text-slate-900" : "text-white/80 hover:text-white"}`}
          >
            导演视角
          </button>
          <button
            onClick={enterRigMode}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${viewMode === "rig" ? "bg-white text-slate-900" : "text-white/80 hover:text-white"}`}
          >
            机位视角
          </button>
        </div>
        <button onClick={handleClose} title="关闭 (Esc)" className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ===== 左侧：场景对象列表 ===== */}
      <div className="absolute bottom-24 left-4 top-14 flex w-52 flex-col rounded-2xl bg-black/50 p-3 text-white backdrop-blur-md">
        <div className="mb-2 text-xs font-medium text-white/60">场景</div>
        <div className="panel-scroll flex-1 space-y-1 overflow-y-auto">
          {rigList.map((r) => (
            <div
              key={r.id}
              onClick={() => apiRef.current?.select("rig", r.id)}
              onDoubleClick={() => apiRef.current?.enterRigView(r.id)}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${sel?.id === r.id ? "bg-white/20" : "hover:bg-white/10"}`}
              title="双击进入机位视角"
            >
              <Video className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); apiRef.current?.removeRig(r.id); }}
                className="hidden shrink-0 text-white/40 hover:text-red-400 group-hover:block"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {charList.map((c) => (
            <div
              key={c.id}
              onClick={() => apiRef.current?.select("char", c.id)}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${sel?.id === c.id ? "bg-white/20" : "hover:bg-white/10"}`}
            >
              <PersonStanding className="h-3.5 w-3.5 shrink-0" style={{ color: c.color }} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); apiRef.current?.removeCharacter(c.id); }}
                className="hidden shrink-0 text-white/40 hover:text-red-400 group-hover:block"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => apiRef.current?.addCharacter()} className={`${btn} flex items-center justify-center gap-1 bg-white/10 hover:bg-white/20`}>
            <Plus className="h-3 w-3" /> 角色
          </button>
          <button onClick={() => apiRef.current?.addRig()} className={`${btn} flex items-center justify-center gap-1 bg-white/10 hover:bg-white/20`}>
            <Plus className="h-3 w-3" /> 机位
          </button>
        </div>
      </div>

      {/* ===== 右侧：选中对象属性 / 灯光 / 场景设置 ===== */}
      <div className="panel-scroll absolute bottom-24 right-4 top-14 w-72 space-y-4 overflow-y-auto rounded-2xl bg-black/50 p-3 text-white backdrop-blur-md">
        {/* 选中角色：属性 / 姿势 两页签 */}
        {selChar && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-white/60">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: selChar.color }} />
              <span className="min-w-0 flex-1 truncate">{selChar.name}</span>
              <div className="flex shrink-0 rounded-lg bg-white/10 p-0.5">
                {(["属性", "姿势"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setCharTab(t)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${charTab === t ? "bg-white text-slate-900" : "text-white/70 hover:text-white"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {charTab === "属性" && (
              <div className="space-y-1.5">
                <SliderRow
                  label="朝向" min={-180} max={180} value={rotYDeg}
                  onChange={(v) => { setRotYDeg(v); apiRef.current?.setCharRotY(selChar.id, v); }}
                />
                <SliderRow
                  label="缩放" min={0.3} max={3} step={0.05} value={charScale}
                  onChange={(v) => { setCharScaleState(v); apiRef.current?.setCharScale(selChar.id, v); }}
                />
              </div>
            )}

            {charTab === "姿势" && (
              <>
                <div className="mb-1.5 text-xs font-medium text-white/60">姿势预设</div>
                <div className="flex flex-wrap gap-1.5">
                  {poseNames.map((p) => (
                    <button key={p} onClick={() => pickPose(p)} className={chip(posePreset === p)}>{p}</button>
                  ))}
                  <button onClick={() => { setPosePreset(""); apiRef.current?.resetPose(); }} className={`${btn} flex items-center gap-1 bg-white/10 hover:bg-white/20`}>
                    <RotateCcw className="h-3 w-3" /> T 型
                  </button>
                </div>

                <div className="mt-3 mb-1.5 text-xs font-medium text-white/60">姿势调节</div>
                <div className="space-y-2.5">
                  {POSE_SLIDER_GROUPS.map((g) => (
                    <div key={g.title}>
                      <div className="mb-1 text-[11px] font-medium text-white/45">{g.title}</div>
                      <div className="space-y-1">
                        {g.items.map((d) => (
                          <SliderRow
                            key={d.key} label={d.label} min={d.min} max={d.max}
                            value={poseParams[d.key] ?? 0}
                            onChange={(v) => {
                              setPoseParams((s) => ({ ...s, [d.key]: v }));
                              apiRef.current?.setPoseParam(d.key, v);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {selRig && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
              <Video className="h-3.5 w-3.5 text-amber-400" /> {selRig.name}
            </div>
            <SliderRow
              label="视野" min={20} max={90} value={rigFov}
              onChange={(v) => { setRigFovState(v); apiRef.current?.setRigFov(selRig.id, v); }}
            />
            <button
              onClick={() => apiRef.current?.enterRigView(selRig.id)}
              className={`${btn} mt-2 flex w-full items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20`}
            >
              <Eye className="h-3.5 w-3.5" /> 进入机位视角
            </button>
          </div>
        )}
        {!sel && (
          <div className="rounded-lg border border-dashed border-white/15 p-3 text-center text-xs leading-5 text-white/40">
            点击场景中的角色 / 机位，<br />或从左侧列表选择
          </div>
        )}

        {/* 灯光 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-white/60">灯光</div>
          <div className="flex flex-wrap gap-1.5">
            {LIGHT_NAMES.map((l) => (
              <button key={l} onClick={() => pickLight(l)} className={chip(light.preset === l)}>{l}</button>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            {([["方位", "azimuth", 0, Math.PI * 2], ["仰角", "elevation", 0, Math.PI / 2], ["强度", "intensity", 0, 2.5]] as const).map(([label, key, min, max]) => (
              <label key={key} className="flex items-center gap-2 text-[11px] text-white/60">
                <span className="w-7 shrink-0">{label}</span>
                <input type="range" min={min} max={max} step={0.01} value={light[key]} onChange={(e) => setLightAngle(key, Number(e.target.value))} className="slider-line min-w-0 flex-1" />
              </label>
            ))}
          </div>
        </div>

        {/* 场景环境 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-white/60">全景背景</div>
          {panoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={panoUrl} alt="" className="h-14 w-full rounded-lg object-cover" />
              <div className="mt-1 truncate text-[11px] text-white/40">{pano?.is360 ? "已连接全景图" : "已连接图片（按全景使用）"} · {pano?.title}</div>
              <div className="mt-2 space-y-2">
                <SliderRow
                  label="水平旋转" labelClass="w-12" min={0} max={360} value={env.panoRotY}
                  onChange={(v) => setEnvPartial({ panoRotY: v })}
                />
                <SliderRow
                  label="球形半径" labelClass="w-12" min={10} max={200} value={env.panoRadius}
                  onChange={(v) => setEnvPartial({ panoRadius: v })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-dashed border-white/15 p-2.5 text-[11px] leading-4 text-white/40">
                将 360 全景图节点连线到导演台，即可作为环境背景
              </div>
              <label className="mt-2 flex items-center justify-between text-[11px] text-white/60">
                <span>天空颜色</span>
                <input
                  type="color" value={env.skyColor}
                  onChange={(e) => setEnvPartial({ skyColor: e.target.value })}
                  className="h-6 w-12 cursor-pointer rounded border border-white/15 bg-transparent"
                />
              </label>
            </>
          )}
        </div>

        {/* 开关 */}
        <div className="space-y-2">
          {([["角色标签", "showLabels"], ["地面", "showGround"]] as const).map(([label, key]) => (
            <div key={key} className="flex items-center justify-between text-xs text-white/80">
              <span>{label}</span>
              <button
                onClick={() => setEnvPartial({ [key]: !env[key] } as Partial<Scene3DEnv>)}
                className={`relative h-5 w-9 rounded-full transition-colors ${env[key] ? "bg-blue-500" : "bg-white/20"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${env[key] ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 底部操作栏：预设机位 + 截图落画布 ===== */}
      <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-2xl bg-black/55 p-2 text-white backdrop-blur-md">
          <span className="ml-1.5 shrink-0 text-xs font-medium text-white/60">视角</span>
          <div className="flex items-center gap-1.5">
            {VIEW_NAMES.map((v) => (
              <button key={v} onClick={() => apiRef.current?.setView(v)} className={`${btn} bg-white/10 hover:bg-white/20`}>{v}</button>
            ))}
          </div>
          <div className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          <button
            onClick={handleShot}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            截图到画布
          </button>
          {shotCount > 0 && <span className="mr-1.5 shrink-0 text-xs tabular-nums text-white/60">已截 {shotCount} 张</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
