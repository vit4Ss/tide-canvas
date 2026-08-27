"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Loader2, Camera, Video, PersonStanding, Plus, Trash2, Eye,
  Move, RotateCw, Maximize2, Play, Pause, Route, SkipBack, Crosshair,
  Layers3, Search, GalleryHorizontal, ImagePlus, Upload, History, WandSparkles,
  ChevronLeft, ChevronRight, RefreshCw, Box, Circle, Cylinder,
  RectangleHorizontal, Check,
} from "lucide-react";
import type * as THREE_NS from "three";
import { useCanvasStore, generateNodeId, type CanvasNode } from "@/stores/use-canvas-store";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { fetchWithAuth } from "@/lib/http";
import { canvasThreeDSceneAssetFromNode } from "@/lib/canvas-three-d";
import { toast } from "@/components/shared/toast";
import { PopoverSelect } from "@/components/shared/popover-select";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useAiGeneration } from "@/hooks/canvas/use-ai-generation";
import { useAiModels } from "./shared/use-node-runtime";
import { CHARACTER_NODE_TYPE, SCENE_NODE_TYPE } from "@/lib/canvas-node-types";
import { AiModelType, type AiTaskVO, type UserGenerationHistoryVO } from "@/types/ai";
import type { CanvasThreeDSceneAsset } from "@/types/canvas-three-d";
import {
  buildMannequinFigure, buildSkinnedFigure, parseState, lightPositionFromAngles, makeLabelSprite, characterNameByIndex,
  LIGHT_NAMES, LIGHT_PRESETS, CHARACTER_COLORS, DEFAULT_ENV, POSE_SLIDER_GROUPS,
  type Scene3DState, type Scene3DEnv, type Scene3DCharacter, type Scene3DRig, type Scene3DProp, type Figure, type SkinnedAsset,
} from "./scene-3d-rig";
import {
  DEFAULT_SCENE_3D_MOTION,
  normalizeScene3DMotion,
  normalizedScene3DMotionPoseAt,
  rotateScene3DMotionAroundY,
  sampleScene3DMotion,
  scene3DMotionPresetPoses,
  type Scene3DCameraPose,
  type Scene3DMotionEasing,
  type Scene3DMotionKeyframe,
  type Scene3DMotionPreset,
  type Scene3DMotionState,
} from "./scene-3d-motion";
import {
  CAMERA_PRESETS,
  CHARACTER_PRESETS,
  FRAME_ASPECTS,
  characterPreset,
  frameAspect,
  type CharacterPresetKey,
  type FrameAspectKey,
} from "./scene-3d-director-presets";
import {
  buildBlockingRecognitionPrompt,
  buildWhiteboxRecognitionPrompt,
  parseRecognizedBlocking,
  parseRecognizedWhitebox,
  recognitionTaskText,
  selectRecognitionModel,
  whiteboxPropPlacement,
  type RecognizedBlocking,
} from "./scene-3d-recognition";
import { selectStoryboardAnalysisModel } from "./video-frame-breakdown";
import { awaitStoryboardAnalysisTask } from "./storyboard-analysis-task";

interface Props {
  node: CanvasNode;
  onClose: () => void;
}

type TransformMode = "translate" | "rotate" | "scale";
type SidebarTab = "scene" | "characters" | "rigs" | "panorama" | "aspect";
type PanoramaPanel = "menu" | "history" | "ai";
type ImportMode = "insert" | "replace";
type RecognitionKind = "blocking" | "whitebox";
type GeometryKind = "box" | "sphere" | "cylinder";

/** 白膜生成的智能执行流程（第 1 步覆盖整个识图任务，其余在结果返回后依次落地） */
const WHITEBOX_FLOW_STEPS = ["识别场景物品与人物", "生成白膜体块", "摆放人物站位", "覆盖当前导演台"] as const;

interface CharacterAddOptions {
  preset?: CharacterPresetKey;
  name?: string;
  pos?: [number, number, number];
  rotY?: number;
  scale?: number;
}

interface EditorApi {
  select: (kind: "char" | "rig" | "prop", id: string) => void;
  deselect: () => void;
  addCharacter: (options?: CharacterAddOptions) => void;
  removeCharacter: (id: string) => void;
  setCharRotY: (id: string, deg: number) => void;
  setCharScale: (id: string, scale: number) => void;
  applyPose: (name: string) => boolean;
  resetPose: () => void;
  setPoseParam: (key: string, deg: number) => void;
  setTransformMode: (mode: TransformMode) => void;
  addRig: (presetKey?: string) => void;
  removeRig: (id: string) => void;
  addProp: (kind: GeometryKind) => void;
  removeProp: (id: string) => void;
  setRigFov: (id: string, fov: number) => void;
  enterRigView: (id: string) => void;
  exitRigView: () => void;
  setView: (name: string) => void;
  setLight: (p: { preset?: string; azimuth?: number; elevation?: number; intensity?: number; ambient?: number }) => void;
  setEnv: (p: Partial<Scene3DEnv>) => Scene3DMotionState | undefined;
  setPanorama: (url: string | null) => void;
  setSceneAssetMaterialMode: (mode: "original" | "solid") => void;
  clearSceneAsset: () => void;
  setFrameAspect: (aspect: number) => void;
  importBlocking: (blocking: RecognizedBlocking, mode: ImportMode) => void;
  setPilotMode: (enabled: boolean) => void;
  setMotionPlaying: (playing: boolean) => void;
  captureCameraPose: () => Scene3DCameraPose;
  setCameraPose: (pose: Scene3DCameraPose) => void;
  setMotionPath: (motion: Scene3DMotionState) => void;
  snapshot: (aspect: number) => Promise<Blob | null>;
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

const SHOT_RATIO_OPTIONS = FRAME_ASPECTS.map((ratio) => ({ value: ratio.key, label: ratio.label }));

const MOTION_EASING_OPTIONS: Array<{ value: Scene3DMotionEasing; label: string }> = [
  { value: "linear", label: "匀速" },
  { value: "easeIn", label: "渐快" },
  { value: "easeOut", label: "渐慢" },
  { value: "easeInOut", label: "平滑" },
];

const MOTION_PRESETS: Array<{ key: Scene3DMotionPreset; label: string }> = [
  { key: "pushIn", label: "推近" },
  { key: "pullOut", label: "拉远" },
  { key: "truckLeft", label: "左移" },
  { key: "truckRight", label: "右移" },
  { key: "orbitLeft", label: "左环绕" },
  { key: "orbitRight", label: "右环绕" },
  { key: "craneUp", label: "升镜" },
];

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
  const [recognitionOpen, setRecognitionOpen] = useState(false);
  const mountRef = useRef<HTMLDivElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(!recognitionOpen);
  const recognitionDialogRef = useFocusTrap<HTMLElement>(recognitionOpen);
  const apiRef = useRef<EditorApi | null>(null);
  const editorAliveRef = useRef(true);
  const panoramaFileRef = useRef<HTMLInputElement>(null);
  const panoramaGenerateBusyRef = useRef(false);
  const recognitionFileRef = useRef<HTMLInputElement>(null);
  const recognitionRunRef = useRef(0);
  const recognitionTaskIdRef = useRef<string | null>(null);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const currentProjectId = useCanvasStore((s) => s.currentProjectId);
  const { generate, isGenerating } = useAiGeneration();
  const { models: imageModels, modelId: selectedImageModelId, setModelId: setSelectedImageModelId } = useAiModels(AiModelType.IMAGE);

  useEffect(() => {
    editorAliveRef.current = true;
    return () => { editorAliveRef.current = false; };
  }, []);

  // 持久化状态只解析一次（v1 自动迁移 v2）；刻意只跟随 node.id，编辑期间的写回不重建场景
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialState = useMemo(() => parseState(node.scene3d), [node.id]);

  // 已连接的全景背景：入边节点中优先取 360 全景图，其次任意图片
  const connectedPano = useMemo(() => {
    const st = useCanvasStore.getState();
    const ins = st.connections
      .filter((c) => c.targetId === node.id)
      .map((c) => st.nodes.find((n) => n.id === c.sourceId))
      .filter((n): n is CanvasNode => !!n && !!n.imageSrc && !n.videoSrc && n.type !== CHARACTER_NODE_TYPE);
    return ins.find((n) => n.is360) ?? ins.find((n) => n.type === SCENE_NODE_TYPE) ?? ins[0] ?? null;
  }, [node.id]);

  // 入边 3D 节点可提供普通 GLB 场景，也可提供 Marble SPZ 世界。
  const connectedSceneAsset = useMemo<CanvasThreeDSceneAsset | null>(() => {
    const st = useCanvasStore.getState();
    const source = st.connections
      .filter((connection) => connection.targetId === node.id)
      .map((connection) => st.nodes.find((candidate) => candidate.id === connection.sourceId))
      .find((candidate) => candidate?.type === "3d" && !!canvasThreeDSceneAssetFromNode(candidate));
    return canvasThreeDSceneAssetFromNode(source);
  }, [node.id]);
  const initialSceneAsset = connectedSceneAsset ?? initialState?.sceneAsset ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shotCount, setShotCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("scene");
  const [sceneQuery, setSceneQuery] = useState("");
  const [panoramaPanel, setPanoramaPanel] = useState<PanoramaPanel>("menu");
  const [panoramaUploading, setPanoramaUploading] = useState(false);
  const [panoramaHistory, setPanoramaHistory] = useState<UserGenerationHistoryVO[]>([]);
  const [panoramaHistoryLoading, setPanoramaHistoryLoading] = useState(false);
  const [panoramaHistoryLoaded, setPanoramaHistoryLoaded] = useState(false);
  const [panoramaPrompt, setPanoramaPrompt] = useState("");
  const [aiPanoramaNodeId, setAiPanoramaNodeId] = useState<string | null>(null);

  // 场景对象与选中态（三维侧为权威，通过 setter 同步到 React）
  const [charList, setCharList] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [rigList, setRigList] = useState<Array<{ id: string; name: string }>>([]);
  const [propList, setPropList] = useState<Array<{ id: string; name: string; kind: GeometryKind }>>([]);
  const [sel, setSel] = useState<{ kind: "char" | "rig" | "prop"; id: string } | null>(null);
  const [viewMode, setViewMode] = useState<"director" | "rig">("director");
  const [rotYDeg, setRotYDeg] = useState(0);
  const [charScale, setCharScaleState] = useState(1);
  const [rigFov, setRigFovState] = useState(50);
  const [posePreset, setPosePreset] = useState("");
  const [poseNames, setPoseNames] = useState<string[]>([]);
  const [poseParams, setPoseParams] = useState<Record<string, number>>({});
  const [charTab, setCharTab] = useState<"属性" | "姿势">("姿势");
  const [transformMode, setTransformModeState] = useState<TransformMode>("translate");
  const [frameAspectKey, setFrameAspectKey] = useState<FrameAspectKey>(() => frameAspect(initialState?.env.frameAspect).key);
  const [geometryOpen, setGeometryOpen] = useState(false);
  const [recognitionTab, setRecognitionTab] = useState<"upload" | "history">("upload");
  const [recognitionSource, setRecognitionSource] = useState<{ url: string; title: string } | null>(null);
  const [recognitionUploading, setRecognitionUploading] = useState(false);
  const [recognitionBusy, setRecognitionBusy] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState<ImportMode>("replace");
  const [recognitionKind, setRecognitionKind] = useState<RecognitionKind>("blocking");
  /** 白膜流程进行到第几步（1 起步；0 表示未在执行） */
  const [recognitionStep, setRecognitionStep] = useState(0);
  const shotAspect = frameAspect(frameAspectKey).value;

  // 运镜：关键帧与播放时间由 React 管理，相机本体和轨迹线仍由 three.js 负责。
  const [motionOpen, setMotionOpen] = useState(false);
  const [motion, setMotionState] = useState<Scene3DMotionState>(() =>
    normalizeScene3DMotion(initialState?.motion ?? DEFAULT_SCENE_3D_MOTION));
  const motionRef = useRef(motion);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [piloting, setPiloting] = useState(false);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  const [light, setLightState] = useState(() =>
    initialState?.light ?? { preset: "自然光", azimuth: 0.7, elevation: 0.9, intensity: 1.15, ambient: 0.55 });
  // 地面是纯阴影捕捉面（不渲染底座），连全景时也默认开启，让角色影子落在场景里
  const [env, setEnvState] = useState<Scene3DEnv>(() => {
    const restored = initialState?.env ?? { ...DEFAULT_ENV };
    if (restored.panoUrl || !connectedPano?.imageSrc) return restored;
    return {
      ...restored,
      panoUrl: connectedPano.imageSrc,
      panoTitle: connectedPano.title || "已连接全景图",
      panoSource: "connected",
    };
  });
  const [sceneAsset, setSceneAsset] = useState<CanvasThreeDSceneAsset | null>(initialSceneAsset);
  const sceneAssetRef = useRef<CanvasThreeDSceneAsset | null>(initialSceneAsset);

  const setSceneAssetMaterialMode = useCallback((materialMode: "original" | "solid") => {
    const current = sceneAssetRef.current;
    if (!current || current.format !== "glb" || current.materialMode === materialMode) return;
    const next = { ...current, materialMode };
    sceneAssetRef.current = next;
    setSceneAsset(next);
    apiRef.current?.setSceneAssetMaterialMode(materialMode);
  }, []);

  // 最新值给三维副作用内的命令式 API 读取（避免闭包过期）。须在三维副作用之前声明。
  const lightAnglesRef = useRef(light);
  useEffect(() => { lightAnglesRef.current = light; }, [light]);
  const envRef = useRef(env);
  useEffect(() => { envRef.current = env; }, [env]);
  useEffect(() => {
    motionRef.current = motion;
    apiRef.current?.setMotionPath(motion);
  }, [motion]);

  // ===== three.js 场景 =====
  useEffect(() => {
    let disposed = false;
    let cleaned = false;
    let cleanup = () => { cleaned = true; };
    const initial = initialState;

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { TransformControls } = await import("three/examples/jsm/controls/TransformControls.js");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        // Mixamo 人物模板（X Bot）：加载失败回退程序化木偶，不阻塞编辑器
        let xbotAsset: SkinnedAsset | null = null;
        let skClone: ((o: THREE_NS.Object3D) => THREE_NS.Object3D) | null = null;
        const disposeXbotAsset = () => {
          const asset = xbotAsset;
          if (!asset) return;
          xbotAsset = null;
          asset.scene.traverse((obj) => {
            const mesh = obj as THREE_NS.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            materials.forEach((material) => material.dispose());
          });
        };
        try {
          const sk = await import("three/examples/jsm/utils/SkeletonUtils.js");
          const gltf = await new GLTFLoader().loadAsync("/models/xbot.glb");
          xbotAsset = { scene: gltf.scene, animations: gltf.animations };
          skClone = sk.clone;
        } catch (err) {
          console.error("[导演台] Mixamo 模型加载失败，回退木偶:", err);
          if (!disposed) toast.info("人物模型加载失败，已回退为基础木偶");
        }
        const mount = mountRef.current;
        if (disposed || !mount) {
          // GLTF 加载期间编辑器已被关闭:这条早退路径走不到 cleanup,
          // 模板的几何/材质必须就地释放,否则快开快关一次泄漏一份
          disposeXbotAsset();
          return;
        }

        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          disposeXbotAsset();
        };

        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);
        // 初始化中途抛错时至少立即归还 WebGL 上下文和已加载模板；完整清理器会在
        // 事件/场景对象建好后接管，避免错误页背后残留不可见的 GPU 上下文。
        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          disposeXbotAsset();
          renderer.dispose();
          (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
          if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        };

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

        // ===== 运镜轨迹（导演视角辅助线；截图/成片预览时隐藏） =====
        const motionGroup = new THREE.Group();
        motionGroup.name = "director-motion-path";
        scene.add(motionGroup);
        const clearMotionPath = () => {
          motionGroup.traverse((obj) => {
            const mesh = obj as THREE_NS.Mesh;
            if ((mesh as THREE_NS.InstancedMesh).isInstancedMesh) {
              (mesh as THREE_NS.InstancedMesh).dispose();
            }
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            materials.forEach((material) => material.dispose());
          });
          motionGroup.clear();
        };
        const updateMotionPath = (motionValue: Scene3DMotionState) => {
          clearMotionPath();
          const safeMotion = normalizeScene3DMotion(motionValue);
          motionGroup.visible = safeMotion.showPath;
          if (!safeMotion.showPath || !safeMotion.keyframes.length) return;

          const samples = sampleScene3DMotion(safeMotion, 72);
          if (samples.length > 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(
              samples.map((pose) => new THREE.Vector3(...pose.position)),
            );
            const material = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 });
            motionGroup.add(new THREE.Line(geometry, material));
          }
          const markerGeometry = new THREE.SphereGeometry(0.065, 14, 10);
          const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
          const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, safeMotion.keyframes.length);
          const matrix = new THREE.Matrix4();
          safeMotion.keyframes.forEach((frame, index) => {
            markers.setMatrixAt(index, matrix.makeTranslation(...frame.position));
            markers.setColorAt(index, new THREE.Color(index === 0 ? 0xffffff : 0x22d3ee));
          });
          markers.instanceMatrix.needsUpdate = true;
          if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
          markers.renderOrder = 998;
          motionGroup.add(markers);
        };

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
        let panoLoadVersion = 0;
        // 已应用的水平旋转（度）：在三维侧自记账算增量，不依赖 React 状态同步时序
        let panoRotApplied = envRef.current.panoRotY;
        const UP_AXIS = new THREE.Vector3(0, 1, 0);
        const panoGeo = new THREE.SphereGeometry(1, 64, 32);
        panoGeo.scale(-1, 1, 1);
        const disposePanoramaSurface = () => {
          if (panoMesh) scene.remove(panoMesh);
          panoMesh = null;
          panoTex?.dispose();
          panoMat?.dispose();
          panoTex = null;
          panoMat = null;
        };
        const setPanoramaInternal = async (url: string | null) => {
          const loadVersion = ++panoLoadVersion;
          disposePanoramaSurface();
          orbit.maxDistance = 30;
          orbit.update();
          if (!url) return;
          // 后端代理 → 同源字节 → blob 贴图：生成图多为中转站/OSS 外链，直接 TextureLoader 会被 CORS 拦下
          // （与 inline-panorama / panorama-viewer 的加载方案保持一致）
          let blobUrl = url;
          let shouldRevoke = false;
          try {
            if (!url.startsWith("data:") && !url.startsWith("blob:")) {
              const resp = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(url)}`);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const buf = await resp.arrayBuffer();
              if (disposed || loadVersion !== panoLoadVersion) return;
              blobUrl = URL.createObjectURL(new Blob([buf], { type: resp.headers.get("content-type") || "image/png" }));
              shouldRevoke = true;
            }
            const tex = await new Promise<THREE_NS.Texture>((resolve, reject) => {
              new THREE.TextureLoader().load(blobUrl, resolve, undefined, () => reject(new Error("贴图解析失败")));
            });
            if (disposed || loadVersion !== panoLoadVersion) { tex.dispose(); return; }
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
            if (!disposed && loadVersion === panoLoadVersion) {
              console.error("[导演台] 全景背景加载失败:", url, err);
              toast.error("全景背景加载失败，已使用天空颜色");
            }
          } finally {
            if (shouldRevoke) URL.revokeObjectURL(blobUrl);
          }
        };
        void setPanoramaInternal(envRef.current.panoUrl ?? null);

        // ===== 连接的 3D 场景：普通 GLB 或 World Labs Marble SPZ =====
        let sceneAssetModel: THREE_NS.Object3D | null = null;
        let sparkRenderer: (THREE_NS.Object3D & { dispose?: () => void }) | null = null;
        let sceneAssetLoadVersion = 0;
        let sceneAssetMaterialMode: "original" | "solid" = sceneAssetRef.current?.materialMode ?? "original";
        const sceneAssetOriginalMaterials = new Map<THREE_NS.Mesh, THREE_NS.Material | THREE_NS.Material[]>();
        const sceneAssetSolidMaterial = new THREE.MeshStandardMaterial({
          color: 0xc4c8cf,
          roughness: 0.92,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        const disposeSceneAssetGroup = (group: THREE_NS.Object3D) => {
          const geometries = new Set<THREE_NS.BufferGeometry>();
          const materials = new Set<THREE_NS.Material>();
          const textures = new Set<THREE_NS.Texture>();
          group.traverse((object) => {
            const mesh = object as THREE_NS.Mesh;
            if (!mesh.isMesh) return;
            if (mesh.geometry) geometries.add(mesh.geometry);
            const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
            meshMaterials.forEach((material) => {
              materials.add(material);
              Object.values(material as unknown as Record<string, unknown>).forEach((value) => {
                const texture = value as THREE_NS.Texture | undefined;
                if (texture?.isTexture) textures.add(texture);
              });
            });
          });
          textures.forEach((texture) => texture.dispose());
          materials.forEach((material) => material.dispose());
          geometries.forEach((geometry) => geometry.dispose());
          (group as THREE_NS.Object3D & { dispose?: () => void }).dispose?.();
        };
        const disposeSceneAssetModel = () => {
          if (!sceneAssetModel) return;
          // Restore owned GLTF materials before disposal. The white material is
          // shared by every mesh and lives for the editor's whole lifetime.
          sceneAssetOriginalMaterials.forEach((material, mesh) => { mesh.material = material; });
          sceneAssetOriginalMaterials.clear();
          scene.remove(sceneAssetModel);
          disposeSceneAssetGroup(sceneAssetModel);
          sceneAssetModel = null;
        };
        const applySceneAssetMaterialMode = (mode: "original" | "solid") => {
          sceneAssetMaterialMode = mode;
          if (!sceneAssetModel || sceneAssetOriginalMaterials.size === 0) return;
          sceneAssetOriginalMaterials.forEach((material, mesh) => {
            if (mode === "solid") {
              if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
              mesh.material = sceneAssetSolidMaterial;
            } else {
              mesh.material = material;
            }
          });
        };
        const setSceneAssetInternal = async (asset: CanvasThreeDSceneAsset | null) => {
          const loadVersion = ++sceneAssetLoadVersion;
          disposeSceneAssetModel();
          if (!asset) return;
          sceneAssetMaterialMode = asset.materialMode ?? "original";
          let objectUrl = "";
          let pendingGroup: THREE_NS.Object3D | null = null;
          try {
            let response: Response;
            try {
              response = await fetchWithAuth(`/api/files/download?url=${encodeURIComponent(asset.url)}`);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
            } catch {
              response = await fetch(asset.url, { mode: "cors", credentials: "omit" });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
            }
            const bytes = await response.arrayBuffer();
            if (disposed || loadVersion !== sceneAssetLoadVersion) return;
            const format = asset.format || (/\.spz(?:[?#]|$)/i.test(asset.url) ? "spz" : "glb");
            if (format === "spz") {
              if (bytes.byteLength < 16) throw new Error("SPZ 文件内容为空或已损坏");
              const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
              if (disposed || loadVersion !== sceneAssetLoadVersion) return;
              if (!sparkRenderer) {
                const nextSparkRenderer = new SparkRenderer({ renderer });
                sparkRenderer = nextSparkRenderer;
                scene.add(nextSparkRenderer);
              }
              const splat = new SplatMesh({ fileBytes: new Uint8Array(bytes) });
              pendingGroup = splat;
              await splat.initialized;
              if (disposed || loadVersion !== sceneAssetLoadVersion) {
                splat.dispose();
                return;
              }
              // Marble SPZ uses its raw OpenCV frame. The official conversion is
              // uniform metric scale, ground offset, then 180° around X for Three.js.
              const metricScale = Number.isFinite(asset.metricScaleFactor) && asset.metricScaleFactor! > 0
                ? asset.metricScaleFactor!
                : 1;
              const groundOffset = Number.isFinite(asset.groundPlaneOffset) ? asset.groundPlaneOffset! : 0;
              splat.scale.setScalar(metricScale);
              splat.rotation.x = Math.PI;
              splat.position.y = groundOffset;
              splat.name = "connected-marble-spz-scene";
              sceneAssetModel = splat;
              pendingGroup = null;
              scene.add(splat);
              return;
            }
            if (bytes.byteLength < 4 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) {
              throw new Error("文件不是 GLB 格式");
            }
            objectUrl = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
            const gltf = await new GLTFLoader().loadAsync(objectUrl);
            if (disposed || loadVersion !== sceneAssetLoadVersion) {
              disposeSceneAssetGroup(gltf.scene);
              return;
            }
            const group = gltf.scene;
            pendingGroup = group;
            const bounds = new THREE.Box3().setFromObject(group);
            if (bounds.isEmpty()) throw new Error("GLB 不含可渲染几何体");
            const size = bounds.getSize(new THREE.Vector3());
            const longest = Math.max(size.x, size.y, size.z);
            if (!Number.isFinite(longest) || longest <= 0) throw new Error("GLB 几何尺寸无效");
            const marbleMetricScale = Number.isFinite(asset.metricScaleFactor) && asset.metricScaleFactor! > 0
              ? asset.metricScaleFactor!
              : 0;
            if (marbleMetricScale > 0) {
              // Marble 白膜与 SPZ 共用同一 OpenCV 原始坐标系：真实米制缩放、
              // 绕 X 轴翻 180°、按地面偏移落地。人物（约 1.7 米）可直接走进场景，
              // 白膜与 SPZ 完全对齐。绝不做道具式归一化，否则整个大堂被压成摆件。
              const groundOffset = Number.isFinite(asset.groundPlaneOffset) ? asset.groundPlaneOffset! : 0;
              group.scale.setScalar(marbleMetricScale);
              group.rotation.x = Math.PI;
              group.position.y = groundOffset;
            } else {
              // 通用 GLB 道具/无语义场景：最长边收敛到 12 米并落地居中。
              const scale = 12 / longest;
              group.scale.setScalar(scale);
              const scaled = new THREE.Box3().setFromObject(group);
              const center = scaled.getCenter(new THREE.Vector3());
              group.position.set(-center.x, -scaled.min.y, -center.z);
            }
            group.name = "connected-3d-scene";
            group.traverse((object) => {
              const mesh = object as THREE_NS.Mesh;
              if (!mesh.isMesh) return;
              sceneAssetOriginalMaterials.set(mesh, mesh.material);
              mesh.receiveShadow = true;
              mesh.castShadow = true;
            });
            sceneAssetModel = group;
            pendingGroup = null;
            applySceneAssetMaterialMode(sceneAssetMaterialMode);
            scene.add(group);
          } catch (err) {
            if (pendingGroup) disposeSceneAssetGroup(pendingGroup);
            if (!disposed && loadVersion === sceneAssetLoadVersion) {
              console.error("[导演台] 3D 场景加载失败:", asset.url, err);
              toast.error("3D 场景加载失败，请检查源节点是否仍有可用的 GLB / SPZ 文件");
            }
          } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          }
        };
        void setSceneAssetInternal(sceneAssetRef.current);

        // ===== 角色管理 =====
        interface CharEntry {
          id: string; name: string; color: number; preset: CharacterPresetKey;
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

        const addCharInternal = (cs?: Partial<Scene3DCharacter>): CharEntry => {
          const idx = charSeq++;
          const baseId = cs?.id ?? `c_${Date.now()}_${idx}`;
          let id = baseId;
          let suffix = 2;
          while (charsM.has(id)) id = `${baseId}_${suffix++}`;
          const name = cs?.name ?? characterNameByIndex(idx);
          const preset = characterPreset(cs?.preset);
          const color = cs?.color ?? (cs?.preset ? preset.color : CHARACTER_COLORS[idx % CHARACTER_COLORS.length]);
          // 模板可用就统一用 Mixamo 模型（旧木偶存档一并升级外观；其关节数据因骨架不同不迁移，回到绑定姿势）
          const figure = xbotAsset && skClone
            ? buildSkinnedFigure(THREE, skClone, xbotAsset, color, preset.headScale ?? 1)
            : buildMannequinFigure(THREE, color, preset.headScale ?? 1);
          if (preset.bodyScale.some((value) => value !== 1)) {
            const modelRoot = figure.root;
            modelRoot.scale.set(...preset.bodyScale);
            const transformRoot = new THREE.Group();
            transformRoot.add(modelRoot);
            figure.root = transformRoot;
          }
          figure.root.position.set(...(cs?.pos ?? [spawnX(idx), 0, 0] as [number, number, number]));
          figure.root.rotation.y = cs?.rotY ?? 0;
          // 新存档优先按姿势预设恢复，保证模型更换后仍使用对应模型的校准参数；
          // custom 或旧存档则恢复关节旋转，旧木偶存档升级皮肤模型时再回退到站姿。
          const savedPose = typeof cs?.pose === "string" && figure.poseNames.includes(cs.pose) ? cs.pose : "";
          if (savedPose) figure.applyPosePreset(savedPose);
          else {
            const applied = cs?.joints ? figure.applyRotations(cs.joints) : 0;
            if (applied === 0) figure.applyPosePreset("站立");
          }
          // 姿势改由右侧滑杆面板调节，场景内不再显示关节球
          figure.jointBalls.forEach((b) => (b.visible = false));
          for (const m of figure.meshes) m.userData.charId = id;
          const label = makeLabelSprite(THREE, name);
          label.sprite.position.set(0, Math.max(1, 2 * preset.bodyScale[1]), 0);
          label.sprite.visible = envRef.current.showLabels;
          figure.root.add(label.sprite);
          scene.add(figure.root);
          const entry: CharEntry = { id, name, color, preset: preset.key, figure, label, labelBase: label.sprite.scale.clone() };
          const initialScale = cs?.scale ?? preset.defaultScale;
          if (initialScale !== 1) applyCharScale(entry, initialScale);
          charsM.set(id, entry);
          return entry;
        };

        // ===== 机位管理（相机本体 + 机身盒 + 视锥线框） =====
        interface RigEntry {
          id: string; name: string;
          cam: THREE_NS.PerspectiveCamera;
          target: THREE_NS.Vector3;
          roll: number;
          viz: THREE_NS.Group;
          body: THREE_NS.Mesh;
          vizDispose: () => void;
        }
        const rigsM = new Map<string, RigEntry>();
        let rigSeq = 0;
        let activeRigId: string | null = null;
        let selRigId: string | null = null;
        interface PropEntry {
          id: string;
          name: string;
          kind: GeometryKind;
          color: number;
          root: THREE_NS.Mesh;
          dispose: () => void;
        }
        const propsM = new Map<string, PropEntry>();
        let propSeq = 0;
        let selPropId: string | null = null;
        let savedDir: { pos: THREE_NS.Vector3; target: THREE_NS.Vector3 } | null = null;
        let rigPreviewAspect = frameAspect(envRef.current.frameAspect).value || (mount.clientWidth || 1) / (mount.clientHeight || 1);

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

        /** OrbitControls 会重建相机四元数；横滚必须在 lookAt 之后精确重放，不能累加 rotateZ。 */
        const orientRigCamera = (cam: THREE_NS.PerspectiveCamera, target: THREE_NS.Vector3, roll: number) => {
          cam.lookAt(target);
          if (roll) cam.rotateZ(roll);
        };

        const addRigInternal = (rs?: Partial<Scene3DRig>): RigEntry => {
          const idx = rigSeq++;
          const baseId = rs?.id ?? `r_${Date.now()}_${idx}`;
          let id = baseId;
          let suffix = 2;
          while (rigsM.has(id)) id = `${baseId}_${suffix++}`;
          const name = rs?.name ?? `机位${idx + 1}`;
          const cam = new THREE.PerspectiveCamera(rs?.fov ?? 50, (mount.clientWidth || 1) / (mount.clientHeight || 1), 0.1, 500);
          const target = new THREE.Vector3(...(rs?.target ?? orbit.target.toArray() as [number, number, number]));
          cam.position.set(...(rs?.pos ?? activeCam.position.toArray() as [number, number, number]));
          const savedRoll = rs?.roll;
          const roll = typeof savedRoll === "number" && Number.isFinite(savedRoll)
            ? THREE.MathUtils.clamp(savedRoll, -Math.PI, Math.PI)
            : 0;
          orientRigCamera(cam, target, roll);
          const { g, body, vizDispose } = buildRigViz(id, cam.fov, rigPreviewAspect);
          cam.add(g);
          scene.add(cam);
          const entry: RigEntry = { id, name, cam, target, roll, viz: g, body, vizDispose };
          rigsM.set(id, entry);
          return entry;
        };

        const addPropInternal = (saved?: Partial<Scene3DProp>): PropEntry => {
          const index = propSeq++;
          const kind: GeometryKind = saved?.kind === "sphere" || saved?.kind === "cylinder" ? saved.kind : "box";
          const baseId = saved?.id ?? `p_${Date.now()}_${index}`;
          let id = baseId;
          let suffix = 2;
          while (propsM.has(id)) id = `${baseId}_${suffix++}`;
          const name = saved?.name ?? (kind === "box" ? "立方体" : kind === "sphere" ? "球体" : "圆柱体");
          const color = saved?.color ?? [0x60a5fa, 0xf472b6, 0xfbbf24][index % 3];
          const geometry = kind === "sphere"
            ? new THREE.SphereGeometry(0.45, 32, 20)
            : kind === "cylinder"
              ? new THREE.CylinderGeometry(0.4, 0.4, 0.9, 32)
              : new THREE.BoxGeometry(0.8, 0.8, 0.8);
          const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04 });
          const root = new THREE.Mesh(geometry, material);
          root.castShadow = true;
          root.receiveShadow = true;
          root.position.set(...(saved?.pos ?? [spawnX(index), 0.45, -0.5] as [number, number, number]));
          root.rotation.set(...(saved?.rot ?? [0, 0, 0] as [number, number, number]));
          root.scale.set(...(saved?.scale ?? [1, 1, 1] as [number, number, number]));
          root.userData.propId = id;
          scene.add(root);
          const entry: PropEntry = { id, name, kind, color, root, dispose: () => { geometry.dispose(); material.dispose(); } };
          propsM.set(id, entry);
          return entry;
        };

        const refreshRigViz = () => {
          for (const [id, r] of rigsM) r.viz.visible = id !== activeRigId;
        };

        const rebuildRigViz = (rig: RigEntry) => {
          rig.cam.remove(rig.viz);
          rig.vizDispose();
          const next = buildRigViz(rig.id, rig.cam.fov, rigPreviewAspect);
          rig.viz = next.g;
          rig.body = next.body;
          rig.vizDispose = next.vizDispose;
          rig.cam.add(next.g);
        };

        const syncLists = () => {
          setCharList([...charsM.values()].map((e) => ({ id: e.id, name: e.name, color: `#${e.color.toString(16).padStart(6, "0")}` })));
          setRigList([...rigsM.values()].map((r) => ({ id: r.id, name: r.name })));
          setPropList([...propsM.values()].map((prop) => ({ id: prop.id, name: prop.name, kind: prop.kind })));
        };

        // ===== 关节摆姿 / 移动 gizmo =====
        const tc = new TransformControls(activeCam, renderer.domElement);
        tc.setSpace("local");
        tc.setSize(0.7);
        const tcHelper = (tc as unknown as { getHelper?: () => THREE_NS.Object3D }).getHelper?.() ?? (tc as unknown as THREE_NS.Object3D);
        scene.add(tcHelper);
        let tcDragging = false;
        let currentTransformMode: TransformMode = "translate";
        let motionPlaybackActive = false;
        let pilotActive = false;
        const pilotKeys = new Set<string>();
        let pilotYaw = 0;
        let pilotPitch = 0;
        let pilotTargetDistance = 3;
        const rigLastPosition = new THREE.Vector3();
        let uniformScaleBefore = 1;

        const canOrbit = () => !tcDragging && !motionPlaybackActive && !pilotActive;
        tc.addEventListener("dragging-changed", (e: { value: unknown }) => {
          tcDragging = !!e.value;
          orbit.enabled = canOrbit();
          if (tcDragging && selRigId) {
            const selectedRig = rigsM.get(selRigId);
            if (selectedRig) rigLastPosition.copy(selectedRig.cam.position);
          }
          if (tcDragging && selCharId) {
            uniformScaleBefore = charsM.get(selCharId)?.figure.root.scale.x ?? 1;
          }
        });

        tc.addEventListener("objectChange", () => {
          if (selRigId && currentTransformMode === "translate") {
            const selectedRig = rigsM.get(selRigId);
            if (selectedRig) {
              const delta = selectedRig.cam.position.clone().sub(rigLastPosition);
              selectedRig.target.add(delta);
              orientRigCamera(selectedRig.cam, selectedRig.target, selectedRig.roll);
              rigLastPosition.copy(selectedRig.cam.position);
            }
          }
          if (selCharId && currentTransformMode === "scale") {
            const selectedChar = charsM.get(selCharId);
            if (selectedChar) {
              const scale = selectedChar.figure.root.scale;
              const candidates = [scale.x, scale.y, scale.z];
              const next = candidates.reduce((best, value) =>
                Math.abs(value - uniformScaleBefore) > Math.abs(best - uniformScaleBefore) ? value : best,
              candidates[0]);
              applyCharScale(selectedChar, next);
              uniformScaleBefore = selectedChar.figure.root.scale.x;
              setCharScaleState(Math.round(uniformScaleBefore * 100) / 100);
            }
          }
          if (selCharId && currentTransformMode === "rotate") {
            const selectedChar = charsM.get(selCharId);
            if (selectedChar) {
              setRotYDeg(Math.round(THREE.MathUtils.radToDeg(selectedChar.figure.root.rotation.y)));
            }
          }
        });

        const applyTransformMode = (mode: TransformMode) => {
          currentTransformMode = mode;
          if (selRigId) {
            tc.setMode("translate");
            tc.setSpace("world");
            tc.showX = true; tc.showY = true; tc.showZ = true;
            return;
          }
          tc.setMode(mode);
          tc.setSpace(mode === "translate" ? "world" : "local");
          tc.showX = mode !== "rotate";
          tc.showY = true;
          tc.showZ = mode !== "rotate";
        };

        const attachRoot = (e: CharEntry) => {
          tc.attach(e.figure.root);
          applyTransformMode(currentTransformMode);
          uniformScaleBefore = e.figure.root.scale.x;
        };

        // ===== 选中逻辑（三维侧权威） =====
        const selectCharInternal = (id: string) => {
          const e = charsM.get(id);
          if (!e) return;
          selCharId = id;
          selRigId = null;
          selPropId = null;
          attachRoot(e);
          const selectedPose = e.figure.getPoseName();
          setPosePreset(selectedPose === "custom" ? "" : selectedPose);
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
          selPropId = null;
          selRigId = id;
          if (activeRigId === id) {
            tc.detach();
          } else {
            tc.attach(r.cam);
            rigLastPosition.copy(r.cam.position);
            applyTransformMode("translate");
          }
          setTransformModeState("translate");
          setRigFovState(Math.round(r.cam.fov));
          setSel({ kind: "rig", id });
        };
        const selectPropInternal = (id: string) => {
          const prop = propsM.get(id);
          if (!prop) return;
          selCharId = null;
          selRigId = null;
          selPropId = id;
          tc.attach(prop.root);
          applyTransformMode(currentTransformMode);
          setSel({ kind: "prop", id });
        };
        const deselectInternal = () => {
          selCharId = null;
          selRigId = null;
          selPropId = null;
          tc.detach();
          setSel(null);
        };

        // ===== 视角切换 =====
        const setActiveCamera = (cam: THREE_NS.PerspectiveCamera, target: THREE_NS.Vector3) => {
          activeCam = cam;
          orbit.object = cam;
          orbit.target.copy(target);
          orbit.update();
          const activeRig = activeRigId ? rigsM.get(activeRigId) : null;
          if (activeRig?.cam === cam) orientRigCamera(cam, orbit.target, activeRig.roll);
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
          if (selRigId && !motionPlaybackActive) selectRigInternal(selRigId);
          else tc.detach();
        };

        const captureCameraPoseInternal = (): Scene3DCameraPose => ({
          position: [activeCam.position.x, activeCam.position.y, activeCam.position.z],
          target: [orbit.target.x, orbit.target.y, orbit.target.z],
          fov: activeCam.fov,
        });

        const setCameraPoseInternal = (pose: Scene3DCameraPose) => {
          if (activeRigId) exitRigViewInternal();
          activeCam = dirCam;
          dirCam.position.set(...pose.position);
          dirCam.fov = pose.fov;
          dirCam.updateProjectionMatrix();
          orbit.object = dirCam;
          orbit.target.set(...pose.target);
          dirCam.lookAt(orbit.target);
          orbit.update();
        };

        const syncPilotAngles = () => {
          const pose = captureCameraPoseInternal();
          const direction = new THREE.Vector3(...pose.target).sub(new THREE.Vector3(...pose.position));
          pilotTargetDistance = Math.max(0.5, direction.length());
          direction.normalize();
          pilotYaw = Math.atan2(direction.x, direction.z);
          pilotPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
        };
        const applyPilotLook = () => {
          const cosPitch = Math.cos(pilotPitch);
          const direction = new THREE.Vector3(
            Math.sin(pilotYaw) * cosPitch,
            Math.sin(pilotPitch),
            Math.cos(pilotYaw) * cosPitch,
          );
          orbit.target.copy(dirCam.position).addScaledVector(direction, pilotTargetDistance);
          dirCam.lookAt(orbit.target);
        };
        const requestPilotPointerLock = () => {
          try {
            const request = renderer.domElement.requestPointerLock() as Promise<void> | undefined;
            void request?.catch(() => { /* 用户拒绝时仍保留键盘掌镜，点击画面可重试 */ });
          } catch { /* 旧浏览器不支持时仍保留键盘掌镜 */ }
        };
        const setPilotModeInternal = (enabled: boolean) => {
          if (enabled) {
            if (activeRigId) exitRigViewInternal();
            motionPlaybackActive = false;
            activeCam = dirCam;
            orbit.object = dirCam;
            pilotActive = true;
            syncPilotAngles();
            orbit.enabled = false;
            tc.detach();
            setPiloting(true);
            requestPilotPointerLock();
          } else {
            pilotActive = false;
            pilotKeys.clear();
            orbit.enabled = canOrbit();
            setPiloting(false);
            if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            if (selCharId) {
              const selectedChar = charsM.get(selCharId);
              if (selectedChar) attachRoot(selectedChar);
            } else if (selRigId) {
              selectRigInternal(selRigId);
            } else if (selPropId) {
              selectPropInternal(selPropId);
            }
          }
        };
        const isTypingTarget = (target: EventTarget | null) => {
          const element = target as HTMLElement | null;
          return !!element?.closest?.("input, textarea, select, [contenteditable='true']");
        };
        const onPilotKeyDown = (event: KeyboardEvent) => {
          if (!pilotActive || isTypingTarget(event.target)) return;
          if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) {
            pilotKeys.add(event.code);
            event.preventDefault();
          }
        };
        const onPilotKeyUp = (event: KeyboardEvent) => pilotKeys.delete(event.code);
        const onPilotPointerMove = (event: MouseEvent) => {
          if (!pilotActive || document.pointerLockElement !== renderer.domElement) return;
          pilotYaw -= event.movementX * 0.0022;
          pilotPitch = THREE.MathUtils.clamp(pilotPitch - event.movementY * 0.0022, -1.45, 1.45);
          applyPilotLook();
        };
        const onPilotCanvasClick = () => {
          if (pilotActive && document.pointerLockElement !== renderer.domElement) {
            requestPilotPointerLock();
          }
        };
        const onPointerLockChange = () => {
          if (pilotActive && document.pointerLockElement !== renderer.domElement) setPilotModeInternal(false);
        };
        window.addEventListener("keydown", onPilotKeyDown);
        window.addEventListener("keyup", onPilotKeyUp);
        window.addEventListener("mousemove", onPilotPointerMove);
        renderer.domElement.addEventListener("click", onPilotCanvasClick);
        document.addEventListener("pointerlockchange", onPointerLockChange);

        // ===== 点选（关节球 → 角色身体/机位机身 → 空白取消选择） =====
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const onPointerDown = (ev: PointerEvent) => {
          if (tcDragging || pilotActive || motionPlaybackActive) return;
          const rect = renderer.domElement.getBoundingClientRect();
          ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(ndc, activeCam);

          const targets: THREE_NS.Object3D[] = [];
          for (const e of charsM.values()) targets.push(...e.figure.meshes);
          for (const r of rigsM.values()) targets.push(r.body);
          for (const prop of propsM.values()) targets.push(prop.root);
          const hits = raycaster.intersectObjects(targets, false).filter((x) => x.object.visible);
          if (hits.length) {
            const ud = hits[0].object.userData;
            if (ud.charId) selectCharInternal(ud.charId as string);
            else if (ud.rigId) selectRigInternal(ud.rigId as string);
            else if (ud.propId) selectPropInternal(ud.propId as string);
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
          if (envRef.current.frameAspect === "auto" && Math.abs(rigPreviewAspect - nw / nh) > 0.01) {
            rigPreviewAspect = nw / nh;
            for (const rig of rigsM.values()) rebuildRigViz(rig);
            refreshRigViz();
          }
          renderer.setSize(nw, nh);
        };
        window.addEventListener("resize", onResize);
        // 侧栏展开/收起会在 150ms 内连续改变容器宽度，监听容器本身才能让
        // WebGL 画幅、射线点击与截图尺寸在动画结束后仍精确一致。
        const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
        resizeObserver?.observe(mount);

        let raf = 0;
        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          cancelAnimationFrame(raf);
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("click", onPilotCanvasClick);
          window.removeEventListener("resize", onResize);
          resizeObserver?.disconnect();
          window.removeEventListener("keydown", onPilotKeyDown);
          window.removeEventListener("keyup", onPilotKeyUp);
          window.removeEventListener("mousemove", onPilotPointerMove);
          document.removeEventListener("pointerlockchange", onPointerLockChange);
          if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
          tc.detach();
          tc.dispose();
          if (tcHelper.parent) tcHelper.parent.remove(tcHelper);
          orbit.dispose();
          for (const e of charsM.values()) { e.figure.dispose(); e.label.dispose(); }
          for (const r of rigsM.values()) r.vizDispose();
          for (const prop of propsM.values()) prop.dispose();
          // 皮肤模型模板：几何体/骨架被所有实例共享，统一在此释放。
          disposeXbotAsset();
          groundGeo.dispose();
          groundMat.dispose();
          grid.geometry.dispose();
          (grid.material as THREE_NS.Material).dispose();
          panoLoadVersion += 1;
          disposePanoramaSurface();
          panoGeo.dispose();
          sceneAssetLoadVersion += 1;
          disposeSceneAssetModel();
          sceneAssetSolidMaterial.dispose();
          if (sparkRenderer) {
            scene.remove(sparkRenderer);
            sparkRenderer.dispose?.();
            sparkRenderer = null;
          }
          clearMotionPath();
          scene.remove(motionGroup);
          renderer.dispose();
          (renderer as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
          if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
          apiRef.current = null;
        };

        // ===== 初始还原（v1 已被 parseState 迁移为单角色 v2）；新场景默认为空，从「+ 角色」开始搭建 =====
        if (initial) {
          initial.characters.forEach((cs) => addCharInternal(cs));
          initial.rigs.forEach((rs) => addRigInternal(rs));
          initial.props?.forEach((prop) => addPropInternal(prop));
        }
        refreshRigViz();
        syncLists();

        // ===== 命令式 API（供 React 覆盖层调用） =====
        const round = (n: number) => Math.round(n * 1e4) / 1e4;
        apiRef.current = {
          select: (kind, id) => (kind === "char" ? selectCharInternal(id) : kind === "rig" ? selectRigInternal(id) : selectPropInternal(id)),
          deselect: deselectInternal,
          addCharacter: (options) => {
            const e = addCharInternal(options ? {
              preset: options.preset,
              name: options.name,
              pos: options.pos,
              rotY: options.rotY,
              scale: options.scale,
            } : undefined);
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
            if (!selCharId) return false;
            const entry = charsM.get(selCharId);
            if (!entry || !entry.figure.poseNames.includes(name)) return false;
            entry.figure.applyPosePreset(name);
            setPoseParams(entry.figure.getPoseParams());
            return true;
          },
          resetPose: () => {
            if (!selCharId) return;
            const entry = charsM.get(selCharId);
            entry?.figure.resetPose();
            setPoseParams(entry?.figure.getPoseParams() ?? {});
            setPosePreset(entry?.figure.getPoseName() === "custom" ? "" : entry?.figure.getPoseName() ?? "");
          },
          setPoseParam: (key, deg) => {
            if (!selCharId) return;
            const entry = charsM.get(selCharId);
            if (!entry) return;
            entry.figure.setPoseParam(key, deg);
            setPosePreset("");
          },
          setTransformMode: (mode) => {
            setTransformModeState(mode);
            applyTransformMode(mode);
          },
          addRig: (presetKey) => {
            const preset = CAMERA_PRESETS.find((candidate) => candidate.key === presetKey);
            const r = preset?.position && preset.target
              ? addRigInternal({ pos: preset.position, target: preset.target, fov: preset.fov, roll: preset.roll })
              : addRigInternal();
            syncLists();
            selectRigInternal(r.id);
          },
          removeRig: (id) => {
            const r = rigsM.get(id);
            if (!r) return;
            if (activeRigId === id) exitRigViewInternal();
            if (selRigId === id) {
              tc.detach();
              selRigId = null;
            }
            scene.remove(r.cam);
            r.vizDispose();
            rigsM.delete(id);
            refreshRigViz();
            syncLists();
            setSel((s) => (s && s.kind === "rig" && s.id === id ? null : s));
          },
          addProp: (kind) => {
            const prop = addPropInternal({ kind });
            syncLists();
            selectPropInternal(prop.id);
          },
          removeProp: (id) => {
            const prop = propsM.get(id);
            if (!prop) return;
            if (selPropId === id) deselectInternal();
            scene.remove(prop.root);
            prop.dispose();
            propsM.delete(id);
            syncLists();
            setSel((selected) => (selected?.kind === "prop" && selected.id === id ? null : selected));
          },
          setRigFov: (id, fov) => {
            const r = rigsM.get(id);
            if (!r) return;
            r.cam.fov = fov;
            r.cam.updateProjectionMatrix();
            // 视锥线框随 fov 重建
            rebuildRigViz(r);
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
            let rotatedMotion: Scene3DMotionState | undefined;
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
                    orientRigCamera(r.cam, orbit.target, r.roll);
                  } else {
                    r.target.applyAxisAngle(UP_AXIS, delta);
                    orientRigCamera(r.cam, r.target, r.roll);
                  }
                }
                for (const prop of propsM.values()) {
                  prop.root.position.applyAxisAngle(UP_AXIS, delta);
                  prop.root.rotation.y = wrap(prop.root.rotation.y + delta);
                }
                rotatedMotion = rotateScene3DMotionAroundY(motionRef.current, delta);
                motionRef.current = rotatedMotion;
                updateMotionPath(rotatedMotion);
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
            return rotatedMotion;
          },
          setPanorama: (url) => { void setPanoramaInternal(url); },
          setSceneAssetMaterialMode: applySceneAssetMaterialMode,
          clearSceneAsset: () => { void setSceneAssetInternal(null); },
          setFrameAspect: (aspect) => {
            rigPreviewAspect = aspect > 0 ? aspect : (mount.clientWidth || 1) / (mount.clientHeight || 1);
            for (const rig of rigsM.values()) rebuildRigViz(rig);
            refreshRigViz();
          },
          importBlocking: (blocking, mode) => {
            if (mode === "replace") {
              if (activeRigId) exitRigViewInternal();
              deselectInternal();
              for (const entry of charsM.values()) {
                scene.remove(entry.figure.root);
                entry.figure.dispose();
                entry.label.dispose();
              }
              charsM.clear();
              for (const rig of rigsM.values()) {
                scene.remove(rig.cam);
                rig.vizDispose();
              }
              rigsM.clear();
              for (const prop of propsM.values()) {
                scene.remove(prop.root);
                prop.dispose();
              }
              propsM.clear();
              selRigId = null;
              selPropId = null;
              activeRigId = null;
            }
            for (const prop of blocking.props ?? []) addPropInternal(whiteboxPropPlacement(prop));
            let lastCharacter: CharEntry | null = null;
            for (const character of blocking.characters) {
              lastCharacter = addCharInternal({
                name: character.name,
                preset: character.preset,
                pos: [character.x, 0, character.z],
                rotY: THREE.MathUtils.degToRad(character.rotation),
                scale: character.scale,
              });
            }
            const cameraPreset = CAMERA_PRESETS.find((preset) => preset.key === blocking.cameraPreset);
            if (cameraPreset?.position && cameraPreset.target) {
              addRigInternal({
                pos: cameraPreset.position,
                target: cameraPreset.target,
                fov: cameraPreset.fov,
                roll: cameraPreset.roll,
              });
            }
            refreshRigViz();
            syncLists();
            if (lastCharacter) selectCharInternal(lastCharacter.id);
          },
          setPilotMode: setPilotModeInternal,
          setMotionPlaying: (value) => {
            if (value && pilotActive) setPilotModeInternal(false);
            motionPlaybackActive = value;
            orbit.enabled = canOrbit();
            motionGroup.visible = value ? false : motionRef.current.showPath;
            if (value) tc.detach();
            else if (selCharId) {
              const selectedChar = charsM.get(selCharId);
              if (selectedChar) attachRoot(selectedChar);
            } else if (selRigId) selectRigInternal(selRigId);
            else if (selPropId) selectPropInternal(selPropId);
          },
          captureCameraPose: captureCameraPoseInternal,
          setCameraPose: setCameraPoseInternal,
          setMotionPath: updateMotionPath,
          snapshot: (aspect) =>
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
              hide(motionGroup);
              renderer.render(scene, activeCam);
              const source = renderer.domElement;
              const sourceAspect = source.width / source.height;
              const outputAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : sourceAspect;
              let sx = 0, sy = 0, sw = source.width, sh = source.height;
              if (sourceAspect > outputAspect) {
                sw = Math.round(source.height * outputAspect);
                sx = Math.round((source.width - sw) / 2);
              } else if (sourceAspect < outputAspect) {
                sh = Math.round(source.width / outputAspect);
                sy = Math.round((source.height - sh) / 2);
              }
              const output = document.createElement("canvas");
              output.width = sw;
              output.height = sh;
              const finish = (blob: Blob | null) => {
                if (!disposed) {
                  tc.enabled = true;
                  for (const { o, v } of hidden) o.visible = v;
                }
                // 主动归还截图临时位图，避免连续截图时等待 GC 才释放大块像素内存。
                output.width = 0;
                output.height = 0;
                resolve(blob);
              };
              const context = output.getContext("2d");
              if (!context) {
                finish(null);
                return;
              }
              try {
                context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
                output.toBlob(finish, "image/png");
              } catch {
                finish(null);
              }
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
                preset: e.preset,
                pose: e.figure.getPoseName(),
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
                ...(r.roll ? { roll: round(r.roll) } : {}),
              };
            });
            const props: Scene3DProp[] = [...propsM.values()].map((prop) => ({
              id: prop.id,
              name: prop.name,
              kind: prop.kind,
              color: prop.color,
              pos: [round(prop.root.position.x), round(prop.root.position.y), round(prop.root.position.z)],
              rot: [round(prop.root.rotation.x), round(prop.root.rotation.y), round(prop.root.rotation.z)],
              scale: [round(prop.root.scale.x), round(prop.root.scale.y), round(prop.root.scale.z)],
            }));
            const dirPos = activeRigId && savedDir ? savedDir.pos : dirCam.position;
            const dirTgt = activeRigId && savedDir ? savedDir.target : orbit.target;
            const sph = new THREE.Spherical().setFromVector3(dirPos.clone().sub(dirTgt));
            const la = lightAnglesRef.current;
            return {
              v: 2,
              characters,
              rigs,
              props,
              camera: { theta: round(sph.theta), phi: round(sph.phi), radius: round(sph.radius), target: [round(dirTgt.x), round(dirTgt.y), round(dirTgt.z)] },
              light: { azimuth: la.azimuth, elevation: la.elevation, intensity: round(dir.intensity), ambient: round(ambient.intensity), preset: la.preset },
              env: envRef.current,
              ...(sceneAssetRef.current ? { sceneAsset: sceneAssetRef.current } : {}),
              motion: motionRef.current,
            };
          },
        };
        updateMotionPath(motionRef.current);

        let lastFrameAt = performance.now();
        const animate = (now = performance.now()) => {
          raf = requestAnimationFrame(animate);
          const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
          lastFrameAt = now;
          if (pilotActive) {
            const cosPitch = Math.cos(pilotPitch);
            const forward = new THREE.Vector3(
              Math.sin(pilotYaw) * cosPitch,
              Math.sin(pilotPitch),
              Math.cos(pilotYaw) * cosPitch,
            ).normalize();
            const right = forward.clone().cross(UP_AXIS).normalize();
            const velocity = new THREE.Vector3();
            if (pilotKeys.has("KeyW")) velocity.add(forward);
            if (pilotKeys.has("KeyS")) velocity.sub(forward);
            if (pilotKeys.has("KeyD")) velocity.add(right);
            if (pilotKeys.has("KeyA")) velocity.sub(right);
            if (pilotKeys.has("KeyE")) velocity.y += 1;
            if (pilotKeys.has("KeyQ")) velocity.y -= 1;
            if (velocity.lengthSq() > 0) {
              const boosted = pilotKeys.has("ShiftLeft") || pilotKeys.has("ShiftRight");
              velocity.normalize().multiplyScalar((boosted ? 5 : 2.2) * deltaSeconds);
              dirCam.position.add(velocity);
              applyPilotLook();
            }
          }
          if (orbit.enabled) {
            orbit.update();
            const activeRig = activeRigId ? rigsM.get(activeRigId) : null;
            if (activeRig) orientRigCamera(activeRig.cam, orbit.target, activeRig.roll);
          }
          renderer.render(scene, activeCam);
        };
        animate();
        if (!disposed) setLoading(false);
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : "3D 编辑器初始化失败");
          setLoading(false);
          disposed = true;
          cleanup();
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

  // ===== React 侧操作封装 =====
  const setEnvPartial = (p: Partial<Scene3DEnv>) => {
    const next = { ...envRef.current, ...p };
    envRef.current = next;
    setEnvState(next);
    const rotatedMotion = apiRef.current?.setEnv(p);
    if (rotatedMotion) {
      motionRef.current = rotatedMotion;
      setMotionState(rotatedMotion);
    }
  };
  const applyPanorama = useCallback((url: string, title: string, source: NonNullable<Scene3DEnv["panoSource"]>) => {
    const next: Scene3DEnv = {
      ...envRef.current,
      panoUrl: url,
      panoTitle: title,
      panoSource: source,
    };
    envRef.current = next;
    setEnvState(next);
    apiRef.current?.setPanorama(url);
  }, []);

  const createPanoramaNode = useCallback((options: {
    title: string;
    url?: string;
    status: "idle" | "success";
    fileSize?: number;
    fileType?: string;
    mimeType?: string;
  }) => {
    const st = useCanvasStore.getState();
    const existing = options.url
      ? st.nodes.find((candidate) => candidate.imageSrc === options.url && candidate.is360 && candidate.type !== CHARACTER_NODE_TYPE)
      : undefined;
    if (existing) {
      if (!st.connections.some((connection) => connection.sourceId === existing.id && connection.targetId === node.id)) {
        st.addConnection({ id: `conn_${existing.id}_${node.id}`, sourceId: existing.id, targetId: node.id }, true);
      }
      return existing.id;
    }

    const id = generateNodeId();
    const width = SHOT_CARD_WIDTH;
    const height = Math.round(width / 2);
    const targetX = node.x - width - 80;
    const columnNodes = st.nodes.filter((candidate) => {
      const candidateWidth = candidate.contentW ?? candidate.width;
      return candidate.x < targetX + width && candidate.x + candidateWidth > targetX;
    });
    const targetY = columnNodes.length
      ? Math.max(...columnNodes.map((candidate) => candidate.y + (candidate.contentH ?? candidate.height ?? 0))) + 24
      : node.y;
    st.addNode({
      id,
      type: SCENE_NODE_TYPE,
      x: targetX,
      y: targetY,
      width,
      height,
      contentW: width,
      contentH: height,
      title: options.title,
      status: options.status,
      imageSrc: options.url,
      fileSize: options.fileSize,
      fileType: options.fileType,
      mimeType: options.mimeType,
      aspectRatio: "2:1",
      is360: true,
    }, true);
    st.addConnection({ id: `conn_${id}_${node.id}`, sourceId: id, targetId: node.id }, false);
    return id;
  }, [node.id, node.x, node.y]);

  const handlePanoramaUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setPanoramaUploading(true);
    try {
      const result = await uploadFileSmart(file);
      if (!editorAliveRef.current) return;
      if (!result.success || !result.data) {
        toast.error(result.message || "全景图上传失败");
        return;
      }
      const title = file.name || "本地全景图";
      createPanoramaNode({
        title,
        url: result.data.fileUrl,
        status: "success",
        fileSize: result.data.fileSize,
        fileType: result.data.fileType,
        mimeType: result.data.mimeType,
      });
      applyPanorama(result.data.fileUrl, title, "upload");
      toast.success("全景图已应用到 3D 场景");
    } catch {
      if (editorAliveRef.current) toast.error("全景图上传失败，请重试");
    } finally {
      if (editorAliveRef.current) setPanoramaUploading(false);
    }
  }, [applyPanorama, createPanoramaNode]);

  const loadPanoramaHistory = useCallback(async () => {
    setPanoramaHistoryLoading(true);
    try {
      const result = await aiApi.myHistory({
        pageNum: 1,
        pageSize: 40,
        mediaType: "image",
        success: 1,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
      });
      if (!editorAliveRef.current) return;
      setPanoramaHistory(result.success && result.data
        ? result.data.records.filter((record) => !!record.resultUrl)
        : []);
      if (!result.success) toast.error(result.message || "历史记录加载失败");
    } catch {
      if (editorAliveRef.current) toast.error("历史记录加载失败，请重试");
    } finally {
      if (editorAliveRef.current) {
        setPanoramaHistoryLoading(false);
        setPanoramaHistoryLoaded(true);
      }
    }
  }, [currentProjectId]);

  const openPanoramaHistory = useCallback(() => {
    setPanoramaPanel("history");
    if (!panoramaHistoryLoaded) void loadPanoramaHistory();
  }, [loadPanoramaHistory, panoramaHistoryLoaded]);

  const selectPanoramaHistory = useCallback((record: UserGenerationHistoryVO) => {
    if (!record.resultUrl) return;
    const title = record.prompt?.trim() || `历史全景图 ${record.id}`;
    createPanoramaNode({ title, url: record.resultUrl, status: "success" });
    applyPanorama(record.resultUrl, title, "history");
    setPanoramaPanel("menu");
    toast.success("历史图片已应用到 3D 场景");
  }, [applyPanorama, createPanoramaNode]);

  const handleGeneratePanorama = useCallback(async () => {
    if (panoramaGenerateBusyRef.current) return;
    const prompt = panoramaPrompt.trim();
    if (!prompt) {
      toast.error("请输入全景图描述");
      return;
    }
    if (!selectedImageModelId) {
      toast.error("暂无可用的图片模型");
      return;
    }
    panoramaGenerateBusyRef.current = true;
    const title = `AI 全景图 · ${prompt.slice(0, 24)}`;
    let generatedNodeId: string | null = null;
    try {
      generatedNodeId = createPanoramaNode({ title, status: "idle" });
      setAiPanoramaNodeId(generatedNodeId);
      const result = await generate({
        nodeId: generatedNodeId,
        handler: "text_to_image",
        modelId: selectedImageModelId,
        input: {
          prompt: `生成一张可用于3D环境背景的360度等距柱状全景图，左右边缘无缝衔接，完整空间环境，不要文字、边框和水印。场景要求：${prompt}`,
          aspectRatio: "2:1",
          aspect_ratio: "2:1",
          ratio: "2:1",
        },
        onSuccess: (url) => {
          if (!editorAliveRef.current) return;
          applyPanorama(url, title, "ai");
          setAiPanoramaNodeId(null);
          setPanoramaPanel("menu");
          toast.success("AI 全景图已生成并应用");
        },
      });
      if (editorAliveRef.current && result.status === "rejected") setAiPanoramaNodeId(null);
    } catch (error) {
      if (generatedNodeId) updateNode(generatedNodeId, { status: "error" });
      if (editorAliveRef.current) {
        setAiPanoramaNodeId(null);
        toast.error(error instanceof Error ? error.message : "AI 全景图生成失败，请重试");
      }
    } finally {
      panoramaGenerateBusyRef.current = false;
    }
  }, [applyPanorama, createPanoramaNode, generate, panoramaPrompt, selectedImageModelId, updateNode]);

  const createRecognitionSourceNode = useCallback((source: {
    url: string;
    title: string;
    fileSize?: number;
    fileType?: string;
    mimeType?: string;
  }) => {
    const store = useCanvasStore.getState();
    const existing = store.nodes.find((candidate) => candidate.type === "image" && candidate.imageSrc === source.url);
    if (existing) return existing.id;
    const id = generateNodeId();
    const width = SHOT_CARD_WIDTH;
    const height = Math.round(width * 9 / 16);
    store.addNode({
      id,
      type: "image",
      x: node.x - width - 80,
      y: node.y,
      width,
      height,
      contentW: width,
      contentH: height,
      title: `识图参考 · ${source.title}`,
      status: "success",
      imageSrc: source.url,
      fileSize: source.fileSize,
      fileType: source.fileType,
      mimeType: source.mimeType,
    }, true);
    return id;
  }, [node.x, node.y]);

  const uploadRecognitionFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setRecognitionUploading(true);
    try {
      const result = await uploadFileSmart(file);
      if (!editorAliveRef.current) return;
      if (!result.success || !result.data) {
        toast.error(result.message || "参考图上传失败");
        return;
      }
      const source = { url: result.data.fileUrl, title: file.name || "参考图" };
      createRecognitionSourceNode({
        ...source,
        fileSize: result.data.fileSize,
        fileType: result.data.fileType,
        mimeType: result.data.mimeType,
      });
      setRecognitionSource(source);
      toast.success("参考图已上传");
    } catch {
      if (editorAliveRef.current) toast.error("参考图上传失败，请重试");
    } finally {
      if (editorAliveRef.current) setRecognitionUploading(false);
    }
  }, [createRecognitionSourceNode]);

  const handleRecognitionUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadRecognitionFile(file);
  }, [uploadRecognitionFile]);

  const selectRecognitionHistory = useCallback((record: UserGenerationHistoryVO) => {
    if (!record.resultUrl) return;
    const source = { url: record.resultUrl, title: record.prompt?.trim().slice(0, 60) || "历史图片" };
    createRecognitionSourceNode(source);
    setRecognitionSource(source);
    setRecognitionTab("upload");
  }, [createRecognitionSourceNode]);

  const generateBlockingReference = useCallback(async () => {
    if (!recognitionSource || recognitionBusy) return;
    const runId = ++recognitionRunRef.current;
    const whitebox = recognitionKind === "whitebox";
    // 白膜生成会重建整个舞台，只支持覆盖导入。
    const mode = whitebox ? "replace" : recognitionMode;
    setRecognitionBusy(true);
    setRecognitionStep(whitebox ? 1 : 0);
    try {
      const modelsResponse = await aiApi.listModels();
      const model = modelsResponse.success ? selectRecognitionModel(modelsResponse.data, selectStoryboardAnalysisModel) : undefined;
      if (!model) throw new Error("未配置支持图片输入的文本模型，请联系管理员");
      if (!editorAliveRef.current || recognitionRunRef.current !== runId) return;
      const created = await aiApi.generateIdempotent({
        handler: "skill_text_completion",
        modelId: model.modelId,
        ...(currentProjectId ? { projectId: currentProjectId } : {}),
        entryPoint: "canvas",
        targetType: "text",
        input: {
          systemPrompt: whitebox
            ? "你是专业影视美术指导和场面调度师。严格依据输入图片把场景物体简化为白膜体块并提取人物站位，只输出合法JSON。"
            : "你是专业影视导演和场面调度师。严格依据输入图片提取人物站位，只输出合法JSON。",
          prompt: whitebox ? buildWhiteboxRecognitionPrompt() : buildBlockingRecognitionPrompt(),
          imageUrls: [recognitionSource.url],
          strictJson: true,
        },
      }, `director-recognition:${recognitionKind}:${node.id}:${runId}:${Date.now()}`);
      if (!created.success || !created.data?.id) throw new Error(created.message || "识图任务创建失败");
      const task = await awaitStoryboardAnalysisTask<AiTaskVO>({
        taskId: String(created.data.id),
        active: () => editorAliveRef.current && recognitionRunRef.current === runId,
        getTask: async (taskId) => {
          const response = await aiApi.getTask(taskId);
          return response.success && response.data ? response.data : null;
        },
        cancelTask: (taskId) => aiApi.cancelTask(taskId),
        onClaim: (taskId) => { recognitionTaskIdRef.current = taskId; },
        onRelease: (taskId) => {
          if (recognitionTaskIdRef.current === taskId) recognitionTaskIdRef.current = null;
        },
      });
      if (!task || !editorAliveRef.current || recognitionRunRef.current !== runId) return;
      const resultText = recognitionTaskText(task.resultMeta);
      const blocking = whitebox ? parseRecognizedWhitebox(resultText) : parseRecognizedBlocking(resultText);
      if (!blocking) throw new Error(whitebox ? "未能从图片中识别出有效场景物体" : "未能从图片中识别出有效人物站位");
      if (whitebox) setRecognitionStep(2);
      if (mode === "replace") {
        apiRef.current?.setMotionPlaying(false);
        setPlaying(false);
        const resetMotion = normalizeScene3DMotion({ ...DEFAULT_SCENE_3D_MOTION, keyframes: [] });
        motionRef.current = resetMotion;
        setMotionState(resetMotion);
        apiRef.current?.setMotionPath(resetMotion);
        playheadRef.current = 0;
        setPlayhead(0);
        setSelectedFrameId(null);

        const nextEnv = { ...envRef.current };
        delete nextEnv.panoUrl;
        delete nextEnv.panoTitle;
        delete nextEnv.panoSource;
        envRef.current = nextEnv;
        setEnvState(nextEnv);
        apiRef.current?.setPanorama(null);

        if (whitebox) {
          // 白膜重建整个舞台：连同已加载的 GLB/SPZ 场景资产一起清掉，
          // 否则生成的白膜体块会和旧场景几何叠在一起。
          apiRef.current?.clearSceneAsset();
          sceneAssetRef.current = null;
          setSceneAsset(null);
        }

        // 覆盖模式必须同时断开旧环境输入（图片全景；白膜还包括 3D 场景节点），
        // 否则下次打开会从入边自动恢复旧环境。
        const store = useCanvasStore.getState();
        const staleSourceIds = new Set(store.nodes
          .filter((candidate) =>
            (!!candidate.imageSrc && !candidate.videoSrc && candidate.type !== CHARACTER_NODE_TYPE)
            || (whitebox && candidate.type === "3d"))
          .map((candidate) => candidate.id));
        const staleConnections = store.connections.filter((connection) =>
          connection.targetId === node.id && staleSourceIds.has(connection.sourceId));
        staleConnections.forEach((connection, index) => store.removeConnection(connection.id, index === 0));
      }
      if (whitebox) setRecognitionStep(3);
      apiRef.current?.importBlocking(blocking, mode);
      if (whitebox) setRecognitionStep(4);
      persist();
      setRecognitionOpen(false);
      toast.success(whitebox
        ? `已生成 ${blocking.props?.length ?? 0} 个白膜体块、${blocking.characters.length} 个角色站位并覆盖导演台`
        : `已导入 ${blocking.characters.length} 个角色站位`);
    } catch (error) {
      if (editorAliveRef.current && recognitionRunRef.current === runId) {
        toast.error(error instanceof Error ? error.message : "AI 识图失败，请重试");
      }
    } finally {
      if (editorAliveRef.current && recognitionRunRef.current === runId) {
        setRecognitionBusy(false);
        setRecognitionStep(0);
      }
    }
  }, [currentProjectId, node.id, persist, recognitionBusy, recognitionKind, recognitionMode, recognitionSource]);

  const addCrowd = useCallback(() => {
    const spacing = 0.85;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        apiRef.current?.addCharacter({
          preset: "standard-male",
          pos: [(column - 1) * spacing, 0, (row - 1) * spacing],
          scale: 0.9 + ((row * 3 + column) % 3) * 0.06,
        });
      }
    }
  }, []);

  const selectFrameAspect = useCallback((key: FrameAspectKey) => {
    setFrameAspectKey(key);
    setEnvPartial({ frameAspect: key });
    apiRef.current?.setFrameAspect(frameAspect(key).value);
  }, []);
  const pickPose = (name: string) => {
    if (apiRef.current?.applyPose(name)) setPosePreset(name);
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
    if (!rigList.length) { toast.info("先在左侧「添加机位」中添加一个机位"); return; }
    const id = sel?.kind === "rig" ? sel.id : rigList[0].id;
    apiRef.current?.enterRigView(id);
  };

  const previewMotionAt = useCallback((seconds: number, source = motionRef.current, syncUi = true) => {
    const safeTime = Math.min(source.duration, Math.max(0, seconds));
    playheadRef.current = safeTime;
    if (syncUi) setPlayhead(safeTime);
    const pose = normalizedScene3DMotionPoseAt(source, safeTime);
    if (pose) apiRef.current?.setCameraPose(pose);
  }, []);

  const patchMotionSettings = (patch: Partial<Pick<Scene3DMotionState, "easing" | "loop" | "showPath">>) => {
    const next = normalizeScene3DMotion({ ...motionRef.current, ...patch });
    motionRef.current = next;
    setMotionState(next);
  };

  const recordMotionFrame = useCallback(() => {
    const pose = apiRef.current?.captureCameraPose();
    if (!pose) return;
    setPlaying(false);
    setMotionOpen(true);
    const safe = normalizeScene3DMotion(motionRef.current);
    if (safe.keyframes.length >= 120) {
      toast.info("单条运镜最多记录 120 个镜头");
      return;
    }
    const lastTime = safe.keyframes.at(-1)?.time ?? -1;
    if (piloting && lastTime >= 60) {
      toast.info("掌镜记录已达到 60 秒上限");
      return;
    }
    const time = piloting
      ? Math.min(60, Math.max(0, lastTime + 1))
      : safe.keyframes.length === 0
        ? 0
        : safe.keyframes.length === 1
          ? safe.duration
          : Math.min(safe.duration, Math.max(0, playheadRef.current));
    const nearby = piloting ? null : safe.keyframes.find((frame) => Math.abs(frame.time - time) < 0.04);
    const id = nearby?.id ?? `motion_${Date.now()}_${safe.keyframes.length}`;
    const frame: Scene3DMotionKeyframe = {
      id,
      name: nearby?.name ?? `镜头 ${safe.keyframes.length + 1}`,
      time,
      ...pose,
    };
    const keyframes = nearby
      ? safe.keyframes.map((item) => item.id === nearby.id ? frame : item)
      : [...safe.keyframes, frame];
    const next = normalizeScene3DMotion({ ...safe, duration: Math.max(safe.duration, time), keyframes });
    motionRef.current = next;
    setMotionState(next);
    setSelectedFrameId(id);
    playheadRef.current = time;
    setPlayhead(time);
  }, [piloting]);

  const deleteSelectedMotionFrame = useCallback(() => {
    if (!selectedFrameId) return;
    setPlaying(false);
    const next = {
      ...motionRef.current,
      keyframes: motionRef.current.keyframes.filter((frame) => frame.id !== selectedFrameId),
    };
    motionRef.current = next;
    setMotionState(next);
    setSelectedFrameId(null);
  }, [selectedFrameId]);

  const changeMotionDuration = (duration: number) => {
    setPlaying(false);
    const current = motionRef.current;
    const nextDuration = Math.min(60, Math.max(0.5, duration || 0.5));
    const ratio = nextDuration / current.duration;
    const next = normalizeScene3DMotion({
      ...current,
      duration: nextDuration,
      keyframes: current.keyframes.map((frame) => ({ ...frame, time: frame.time * ratio })),
    });
    motionRef.current = next;
    setMotionState(next);
    previewMotionAt(0, next);
  };

  const applyMotionPreset = (preset: Scene3DMotionPreset) => {
    const pose = apiRef.current?.captureCameraPose();
    if (!pose) return;
    const poses = scene3DMotionPresetPoses(preset, pose);
    const names: Record<Scene3DMotionPreset, string> = {
      pushIn: "推近", pullOut: "拉远", truckLeft: "左移", truckRight: "右移",
      orbitLeft: "左环绕", orbitRight: "右环绕", craneUp: "升镜",
    };
    const keyframes: Scene3DMotionKeyframe[] = poses.map((item, index) => ({
      id: `motion_preset_${preset}_${index}`,
      name: index === 0 ? `${names[preset]} · 起点` : `${names[preset]} · 终点`,
      time: index === 0 ? 0 : motionRef.current.duration,
      ...item,
    }));
    const next = normalizeScene3DMotion({ ...motionRef.current, keyframes });
    setPlaying(false);
    setMotionOpen(true);
    motionRef.current = next;
    setMotionState(next);
    setSelectedFrameId(keyframes[0].id);
    previewMotionAt(0, next);
  };

  useEffect(() => {
    if (!playing) {
      apiRef.current?.setMotionPlaying(false);
      return;
    }
    if (loading || !apiRef.current) {
      setPlaying(false);
      return;
    }
    const current = motionRef.current;
    if (current.keyframes.length < 2) {
      setPlaying(false);
      toast.info("至少记录两个镜头才能预演运镜");
      return;
    }
    setPiloting(false);
    apiRef.current?.setMotionPlaying(true);
    const startAt = playheadRef.current >= current.duration - 0.01 ? 0 : playheadRef.current;
    previewMotionAt(startAt, current);
    let startedAt = performance.now() - startAt * 1000;
    let lastUiAt = 0;
    let frameId = 0;
    const tick = (now: number) => {
      const latest = motionRef.current;
      let nextTime = (now - startedAt) / 1000;
      if (nextTime >= latest.duration) {
        if (latest.loop) {
          startedAt = now;
          nextTime = 0;
        } else {
          previewMotionAt(latest.duration, latest);
          setPlaying(false);
          return;
        }
      }
      previewMotionAt(nextTime, latest, false);
      if (now - lastUiAt >= 50) {
        lastUiAt = now;
        setPlayhead(nextTime);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
      apiRef.current?.setMotionPlaying(false);
    };
  }, [loading, playing, previewMotionAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      if (event.key === "Escape" && recognitionOpen) {
        setRecognitionOpen(false);
        return;
      }
      if (element?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        if (piloting) apiRef.current?.setPilotMode(false);
        else if (playing) setPlaying(false);
        else handleClose();
        return;
      }
      if (element?.closest?.("button, a[href], [role='button'], [role='listbox']")) return;
      if (piloting && event.key === "Enter") {
        if (event.repeat) return;
        event.preventDefault();
        recordMotionFrame();
        return;
      }
      if (!loading && motionOpen && event.code === "Space" && motion.keyframes.length >= 2) {
        event.preventDefault();
        setPlaying((value) => !value);
        return;
      }
      if (!piloting && (event.key.toLowerCase() === "v" || event.key.toLowerCase() === "r" || event.key.toLowerCase() === "s")) {
        const mode: TransformMode = event.key.toLowerCase() === "v" ? "translate" : event.key.toLowerCase() === "r" ? "rotate" : "scale";
        apiRef.current?.setTransformMode(mode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, loading, motion.keyframes.length, motionOpen, piloting, playing, recognitionOpen, recordMotionFrame]);

  /** 截图以图片节点形式落到导演台右侧（多张时向下排列）并自动连线，作为下游 AI 生成的参考素材 */
  const spawnShotNode = (file: { fileUrl: string; fileSize: number; fileType: string; mimeType: string }, aspect: number) => {
    const st = useCanvasStore.getState();
    const nid = generateNodeId();
    const cw = SHOT_CARD_WIDTH;
    const ch = Math.round(cw / aspect);
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
      const mount = mountRef.current;
      const resolvedShotAspect = shotAspect > 0
        ? shotAspect
        : mount && mount.clientHeight > 0 ? mount.clientWidth / mount.clientHeight : 16 / 9;
      const blob = await apiRef.current.snapshot(resolvedShotAspect);
      if (!editorAliveRef.current) return;
      if (!blob) { toast.error("截图失败，请重试"); return; }
      const file = new File([blob], `director_${Date.now()}.png`, { type: "image/png" });
      const up = await uploadFileSmart(file);
      if (!editorAliveRef.current) return;
      if (!up.success || !up.data) { toast.error(up.message || "截图上传失败"); return; }
      const url = up.data.fileUrl;
      persist();
      updateNode(node.id, { imageSrc: url, fileSize: up.data.fileSize, fileType: up.data.fileType, mimeType: up.data.mimeType }); // 导演台预览 = 最近一次截图
      spawnShotNode(up.data, resolvedShotAspect);
      setShotCount((c) => c + 1);
      toast.success("已截图，图片节点已放入画布");
    } catch {
      // 快照/上传异常:反馈并避免未处理 rejection。
      if (editorAliveRef.current) toast.error("截图失败，请重试");
    } finally {
      if (editorAliveRef.current) setBusy(false);
    }
  };

  const btn = "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 motion-reduce:transition-none";
  const chip = (active: boolean) => `${btn} ${active ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`;
  const selChar = sel?.kind === "char" ? charList.find((c) => c.id === sel.id) : null;
  const selRig = sel?.kind === "rig" ? rigList.find((r) => r.id === sel.id) : null;
  const selProp = sel?.kind === "prop" ? propList.find((prop) => prop.id === sel.id) : null;
  const normalizedSceneQuery = sceneQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleRigList = normalizedSceneQuery
    ? rigList.filter((rig) => rig.name.toLocaleLowerCase("zh-CN").includes(normalizedSceneQuery))
    : rigList;
  const visibleCharList = normalizedSceneQuery
    ? charList.filter((character) => character.name.toLocaleLowerCase("zh-CN").includes(normalizedSceneQuery))
    : charList;
  const visiblePropList = normalizedSceneQuery
    ? propList.filter((prop) => prop.name.toLocaleLowerCase("zh-CN").includes(normalizedSceneQuery))
    : propList;
  const visibleSceneAsset = sceneAsset && (!normalizedSceneQuery || sceneAsset.title.toLocaleLowerCase("zh-CN").includes(normalizedSceneQuery))
    ? sceneAsset
    : null;
  const activePanoramaUrl = env.panoUrl ?? null;
  const activePanoramaTitle = env.panoTitle || connectedPano?.title || "全景图";
  const aiPanoramaBusy = !!aiPanoramaNodeId && isGenerating(aiPanoramaNodeId);
  const selectedMotionFrame = motion.keyframes.find((frame) => frame.id === selectedFrameId) ?? null;
  const formatMotionTime = (seconds: number) => `${seconds.toFixed(1)}s`;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="3D 导演台"
      tabIndex={-1}
      className="fixed inset-0 z-[200] bg-slate-950 outline-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        ref={mountRef}
        onTransitionEnd={() => window.dispatchEvent(new Event("resize"))}
        className={`h-full cursor-grab transition-[margin,width] duration-150 active:cursor-grabbing motion-reduce:transition-none ${sidebarOpen ? "ml-[276px] w-[calc(100%-276px)]" : "w-full"}`}
      />

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}
      {error && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/80">{error}</div>}

      {/* ===== 左侧应用框架：对齐导演台参考 UI，标题栏与功能轨固定停靠 ===== */}
      {sidebarOpen ? (
        <>
          <div className="absolute left-0 top-0 z-20 flex h-12 w-[276px] items-center border-b border-r border-white/10 bg-[#171717] text-white">
            <button
              onClick={handleClose}
              title="关闭 (Esc)"
              aria-label="关闭 3D 导演台"
              className="ml-2 flex h-10 w-7 items-center justify-center text-white/80 transition-colors hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="ml-1 text-[15px] font-semibold tracking-tight">3D导演台</span>
            <button
              onClick={() => setSidebarOpen(false)}
              title="收起侧栏"
              aria-label="收起侧栏"
              className="ml-auto mr-2 flex h-8 w-8 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span className="relative h-4 w-4 rounded-[3px] border border-current">
                <span className="absolute bottom-0 left-[7px] top-0 w-px bg-current" />
              </span>
            </button>
          </div>

          <nav aria-label="导演台工具" className="absolute bottom-0 left-0 top-12 z-20 flex w-12 flex-col items-center gap-3 border-r border-white/10 bg-[#171717] py-3 text-white/65">
            <button
              type="button"
              aria-current={sidebarTab === "scene" ? "page" : undefined}
              onClick={() => setSidebarTab("scene")}
              title="场景"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${sidebarTab === "scene" ? "bg-white/10 text-white" : ""}`}
            >
              <Layers3 className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              aria-current={sidebarTab === "characters" ? "page" : undefined}
              onClick={() => setSidebarTab("characters")}
              title="添加角色"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${sidebarTab === "characters" ? "bg-white/10 text-white" : ""}`}
            >
              <PersonStanding className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              aria-current={sidebarTab === "rigs" ? "page" : undefined}
              onClick={() => setSidebarTab("rigs")}
              title="添加机位"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${sidebarTab === "rigs" ? "bg-white/10 text-white" : ""}`}
            >
              <Video className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              aria-current={sidebarTab === "panorama" ? "page" : undefined}
              onClick={() => { setSidebarTab("panorama"); setPanoramaPanel("menu"); }}
              title="全景图"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${sidebarTab === "panorama" ? "bg-white/10 text-white" : ""}`}
            >
              <GalleryHorizontal className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              aria-current={sidebarTab === "aspect" ? "page" : undefined}
              onClick={() => setSidebarTab("aspect")}
              title="选择画幅比例"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white ${sidebarTab === "aspect" ? "bg-white/10 text-white" : ""}`}
            >
              <RectangleHorizontal className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setRecognitionOpen(true)}
              title="AI识图导入"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 hover:text-white"
            >
              <ImagePlus className="h-[18px] w-[18px]" />
            </button>
          </nav>
        </>
      ) : (
        <div className="absolute left-2 top-2 z-20 flex items-center rounded-lg border border-white/10 bg-[#171717] p-1 text-white shadow-lg">
          <button onClick={handleClose} title="关闭 (Esc)" aria-label="关闭 3D 导演台" className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
          <button onClick={() => setSidebarOpen(true)} title="展开侧栏" aria-label="展开侧栏" className="flex h-8 w-8 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <span className="relative h-4 w-4 rounded-[3px] border border-current">
              <span className="absolute bottom-0 left-[7px] top-0 w-px bg-current" />
            </span>
          </button>
        </div>
      )}

      {/* 视角切换保留在画布上方，侧栏展开时以可用画布区域为中心。 */}
      <div
        className="absolute top-3 flex -translate-x-1/2 rounded-full bg-black/50 p-0.5 text-white backdrop-blur-md"
        style={{ left: sidebarOpen ? "calc(50% + 138px)" : "50%" }}
      >
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

      {/* 物体变换工具：与专业 3D 软件一致，V/R/S 可快速切换。 */}
      <div
        className="absolute top-14 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-black/50 p-1 text-white backdrop-blur-md"
        style={{ left: sidebarOpen ? "calc(50% + 138px)" : "50%" }}
      >
        {([
          ["translate", "移动", Move, "V"],
          ["rotate", "旋转", RotateCw, "R"],
          ["scale", "缩放", Maximize2, "S"],
        ] as const).map(([mode, label, Icon, shortcut]) => (
          <button
            key={mode}
            onClick={() => apiRef.current?.setTransformMode(mode)}
            disabled={!!selRig && mode !== "translate"}
            title={`${label} (${shortcut})`}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              transformMode === mode ? "bg-white text-slate-900" : "text-white/70 hover:bg-white/10 hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-30`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}<kbd className="text-[9px] opacity-50">{shortcut}</kbd>
          </button>
        ))}
      </div>

      {piloting && (
        <>
          <div
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2"
            style={{ left: sidebarOpen ? "calc(50% + 138px)" : "50%" }}
          >
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80" />
            <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/80" />
          </div>
          <div
            className="pointer-events-none absolute top-24 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-2 text-center text-xs text-white/80 backdrop-blur"
            style={{ left: sidebarOpen ? "calc(50% + 138px)" : "50%" }}
          >
            WASD 移动 · Q/E 升降 · Shift 加速 · 鼠标转向 · Enter 记录镜头 · Esc 退出掌镜
          </div>
        </>
      )}

      {/* ===== 左侧：与参考图一致的停靠式场景层级 ===== */}
      {sidebarOpen && (
        <section className="absolute bottom-0 left-12 top-12 z-20 flex w-[228px] flex-col border-r border-white/10 bg-[#171717] pl-2 pr-1 pt-5 text-white">
          {sidebarTab === "scene" ? (
            <>
              <h2 className="px-1 text-xs font-semibold text-violet-300">场景</h2>
              <label className="mt-3.5 flex h-8 items-center gap-2 rounded-md bg-[#292929] px-3 text-white/45 ring-1 ring-inset ring-white/[0.04] focus-within:ring-violet-400/50">
                <input
                  value={sceneQuery}
                  onChange={(event) => setSceneQuery(event.target.value)}
                  placeholder="请输入搜索内容"
                  aria-label="搜索场景对象"
                  className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/35"
                />
                <Search className="h-3.5 w-3.5 shrink-0 text-white/65" />
              </label>

              <div className="panel-scroll mt-3 flex-1 space-y-0.5 overflow-y-auto pb-4">
                {visibleSceneAsset && (
                  <div
                    className="flex h-7 items-center gap-2 rounded-[3px] bg-white/[0.04] pl-3 pr-2 text-xs"
                    title="由画布 3D 节点连接并作为真实场景加载"
                  >
                    <Layers3 className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    <span className="min-w-0 flex-1 truncate font-medium text-cyan-200">{visibleSceneAsset.title}</span>
                    <span className="shrink-0 text-[9px] uppercase text-white/35">GLB</span>
                  </div>
                )}
                {visibleRigList.map((rig) => (
                  <div
                    key={`rig:${rig.id}`}
                    onClick={() => apiRef.current?.select("rig", rig.id)}
                    onDoubleClick={() => apiRef.current?.enterRigView(rig.id)}
                    className={`group flex h-6 cursor-pointer items-center gap-2 rounded-[3px] pl-6 pr-2 text-xs transition-colors ${sel?.id === rig.id ? "bg-[#303030]" : "hover:bg-white/[0.06]"}`}
                    title="双击进入机位视角"
                  >
                    <Video className="h-3.5 w-3.5 shrink-0 text-white/75" />
                    <span className="min-w-0 flex-1 truncate font-medium text-violet-300">{rig.name}</span>
                    <button
                      onClick={(event) => { event.stopPropagation(); apiRef.current?.removeRig(rig.id); }}
                      aria-label={`删除${rig.name}`}
                      className="hidden shrink-0 text-white/35 hover:text-red-400 group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {visibleCharList.map((character) => (
                  <div
                    key={`char:${character.id}`}
                    onClick={() => apiRef.current?.select("char", character.id)}
                    className={`group flex h-6 cursor-pointer items-center gap-2 rounded-[3px] pl-6 pr-2 text-xs transition-colors ${sel?.id === character.id ? "bg-[#303030]" : "hover:bg-white/[0.06]"}`}
                  >
                    <PersonStanding className="h-3.5 w-3.5 shrink-0 text-white/75" />
                    <span className="min-w-0 flex-1 truncate font-medium text-violet-300">{character.name}</span>
                    <button
                      onClick={(event) => { event.stopPropagation(); apiRef.current?.removeCharacter(character.id); }}
                      aria-label={`删除${character.name}`}
                      className="hidden shrink-0 text-white/35 hover:text-red-400 group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {visiblePropList.map((prop) => (
                  <div
                    key={`prop:${prop.id}`}
                    onClick={() => apiRef.current?.select("prop", prop.id)}
                    className={`group flex h-6 cursor-pointer items-center gap-2 rounded-[3px] pl-6 pr-2 text-xs transition-colors ${sel?.id === prop.id ? "bg-[#303030]" : "hover:bg-white/[0.06]"}`}
                  >
                    <Box className="h-3.5 w-3.5 shrink-0 text-white/75" />
                    <span className="min-w-0 flex-1 truncate font-medium text-violet-300">{prop.name}</span>
                    <button
                      onClick={(event) => { event.stopPropagation(); apiRef.current?.removeProp(prop.id); }}
                      aria-label={`删除${prop.name}`}
                      className="hidden shrink-0 text-white/35 hover:text-red-400 group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {!visibleSceneAsset && visibleRigList.length === 0 && visibleCharList.length === 0 && visiblePropList.length === 0 && (
                  <div className="px-3 py-5 text-center text-[11px] text-white/30">
                    {normalizedSceneQuery ? "没有匹配的场景对象" : "连接 3D 节点，或从左侧添加角色和机位"}
                  </div>
                )}
              </div>
            </>
          ) : sidebarTab === "characters" ? (
            <>
              <h2 className="px-1 text-xs font-semibold text-violet-300">添加角色</h2>
              <div className="panel-scroll mt-3 flex-1 overflow-y-auto pb-4 pr-1">
                <button
                  type="button"
                  onClick={() => { setRecognitionTab("upload"); setRecognitionOpen(true); }}
                  className="flex h-8 w-full items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                >
                  <Upload className="h-4 w-4" />
                  本地上传
                </button>
                <div className="mt-1">
                  {CHARACTER_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => apiRef.current?.addCharacter({ preset: preset.key })}
                      className="flex h-8 w-full items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                    >
                      <PersonStanding className="h-3.5 w-3.5 text-white/70" />
                      {preset.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addCrowd}
                  className="flex h-8 w-full items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                >
                  <PersonStanding className="h-3.5 w-3.5 text-white/70" />
                  <span className="flex-1">群众 (3x3)</span>
                  <ChevronRight className="h-3.5 w-3.5 text-white/50" />
                </button>
                <button
                  type="button"
                  onClick={() => setGeometryOpen((open) => !open)}
                  aria-expanded={geometryOpen}
                  className="flex h-8 w-full items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                >
                  <Box className="h-3.5 w-3.5 text-white/70" />
                  <span className="flex-1">几何模型</span>
                  <ChevronRight className={`h-3.5 w-3.5 text-white/50 transition-transform ${geometryOpen ? "rotate-90" : ""}`} />
                </button>
                {geometryOpen && (
                  <div className="ml-4 border-l border-white/10 pl-2">
                    {([[
                      "box", "立方体", Box,
                    ], [
                      "sphere", "球体", Circle,
                    ], [
                      "cylinder", "圆柱体", Cylinder,
                    ]] as const).map(([kind, label, Icon]) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => apiRef.current?.addProp(kind)}
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] text-white/75 hover:bg-white/[0.06] hover:text-white"
                      >
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : sidebarTab === "rigs" ? (
            <>
              <h2 className="px-1 text-xs font-semibold text-violet-300">添加机位</h2>
              <div className="panel-scroll mt-3 grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pb-4 pr-1">
                {CAMERA_PRESETS.map((preset, index) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => apiRef.current?.addRig(preset.key)}
                    className={`flex h-[72px] flex-col items-center justify-center gap-2 rounded-xl border text-[11px] font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/[0.04] ${index === 0 ? "border-white/80" : "border-white/10"}`}
                  >
                    <Camera className="h-5 w-5" />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : sidebarTab === "aspect" ? (
            <>
              <h2 className="px-1 text-xs font-semibold text-violet-300">选择画幅比例</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 pr-1">
                {FRAME_ASPECTS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => selectFrameAspect(option.key)}
                    aria-pressed={frameAspectKey === option.key}
                    className={`flex h-[72px] flex-col items-center justify-center gap-2 rounded-xl border text-xs font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/[0.04] ${frameAspectKey === option.key ? "border-white/80" : "border-white/10"}`}
                  >
                    <span
                      className="block rounded-[1px] border border-white/85"
                      style={{ width: option.iconRatio >= 1 ? 16 : Math.max(6, 16 * option.iconRatio), height: option.iconRatio >= 1 ? Math.max(6, 16 / option.iconRatio) : 16 }}
                    />
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex h-5 items-center gap-1 px-1">
                {panoramaPanel !== "menu" && (
                  <button
                    type="button"
                    onClick={() => setPanoramaPanel("menu")}
                    aria-label="返回全景图菜单"
                    className="-ml-1 flex h-6 w-6 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <h2 className="text-xs font-semibold text-violet-300">
                  {panoramaPanel === "history" ? "历史记录" : panoramaPanel === "ai" ? "AI生成" : "全景图"}
                </h2>
              </div>

              {panoramaPanel === "menu" && (
                <div className="mt-3 flex flex-col">
                  <input ref={panoramaFileRef} type="file" accept="image/*" className="hidden" onChange={handlePanoramaUpload} />
                  <button
                    type="button"
                    onClick={() => panoramaFileRef.current?.click()}
                    disabled={panoramaUploading}
                    className="flex h-9 items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    {panoramaUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    本地上传
                  </button>
                  <button
                    type="button"
                    onClick={openPanoramaHistory}
                    className="flex h-9 items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                  >
                    <History className="h-4 w-4" />
                    历史记录
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanoramaPanel("ai")}
                    className="flex h-9 items-center gap-3 rounded px-2 text-left text-xs font-medium text-white/90 hover:bg-white/[0.06]"
                  >
                    <WandSparkles className="h-4 w-4" />
                    AI生成
                  </button>

                  {activePanoramaUrl && (
                    <div className="mt-5 border-t border-white/10 px-1 pt-4">
                      <div className="mb-2 text-[11px] text-white/40">当前全景图</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={activePanoramaUrl} alt="当前全景图" className="h-20 w-full rounded-md object-cover" />
                      <div className="mt-1.5 truncate text-[11px] text-white/60" title={activePanoramaTitle}>{activePanoramaTitle}</div>
                    </div>
                  )}
                </div>
              )}

              {panoramaPanel === "history" && (
                <div className="panel-scroll mt-3 flex-1 overflow-y-auto pb-4 pr-1">
                  <button
                    type="button"
                    onClick={() => void loadPanoramaHistory()}
                    disabled={panoramaHistoryLoading}
                    className="mb-2 ml-auto flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-white/55 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${panoramaHistoryLoading ? "animate-spin" : ""}`} />
                    刷新
                  </button>
                  {panoramaHistoryLoading && panoramaHistory.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : panoramaHistory.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {panoramaHistory.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          onClick={() => selectPanoramaHistory(record)}
                          title={record.prompt || "使用该图片"}
                          className="overflow-hidden rounded-md bg-white/[0.04] text-left ring-1 ring-white/10 hover:ring-violet-400/70"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={record.resultUrl} alt="历史图片" loading="lazy" className="h-16 w-full object-cover" />
                          <div className="truncate px-1.5 py-1 text-[10px] text-white/55">{record.prompt || "历史图片"}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-8 text-center text-[11px] text-white/35">暂无可用的图片记录</div>
                  )}
                </div>
              )}

              {panoramaPanel === "ai" && (
                <div className="mt-4 space-y-3 pr-1">
                  <label className="block text-[11px] text-white/55">
                    场景描述
                    <textarea
                      value={panoramaPrompt}
                      onChange={(event) => setPanoramaPrompt(event.target.value)}
                      rows={5}
                      maxLength={1200}
                      placeholder="例如：雨后的未来城市天台，远处霓虹灯与云层，电影感夜景"
                      className="mt-1.5 w-full resize-none rounded-md border border-white/10 bg-[#292929] p-2 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-violet-400/60"
                    />
                  </label>
                  <label className="block text-[11px] text-white/55">
                    图片模型
                    <select
                      value={selectedImageModelId}
                      onChange={(event) => setSelectedImageModelId(event.target.value)}
                      disabled={imageModels.length === 0 || aiPanoramaBusy}
                      className="mt-1.5 h-8 w-full rounded-md border border-white/10 bg-[#292929] px-2 text-xs text-white outline-none focus:border-violet-400/60 disabled:opacity-50"
                    >
                      {imageModels.length === 0 && <option value="">暂无可用模型</option>}
                      {imageModels.map((model) => <option key={model.id} value={model.modelId}>{model.name}</option>)}
                    </select>
                  </label>
                  <div className="rounded-md bg-white/[0.04] px-2 py-2 text-[10px] leading-4 text-white/40">
                    将按 2:1 画幅生成可环绕的 360° 环境图，完成后会自动应用到当前场景。
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGeneratePanorama()}
                    disabled={aiPanoramaBusy || !selectedImageModelId}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-violet-500 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {aiPanoramaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                    {aiPanoramaBusy ? "正在生成" : "开始生成"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ===== 右侧：选中对象属性 / 灯光 / 场景设置 ===== */}
      <div className="panel-scroll absolute bottom-24 right-4 top-14 w-72 space-y-4 overflow-y-auto rounded-2xl bg-black/50 p-3 text-white backdrop-blur-md">
        {selProp && (
          <div className="rounded-lg border border-white/10 p-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-white/80">
              <Box className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate">{selProp.name}</span>
              <button type="button" onClick={() => apiRef.current?.removeProp(selProp.id)} aria-label={`删除${selProp.name}`} className="text-white/40 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 text-[11px] leading-4 text-white/40">使用画面上方的移动、旋转、缩放工具调整几何模型。</div>
          </div>
        )}
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
          <div className="mb-1.5 text-xs font-medium text-white/60">3D 场景</div>
          {sceneAsset ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] px-2.5 py-2">
              <Layers3 className="h-4 w-4 shrink-0 text-cyan-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white/85">{sceneAsset.title}</div>
                <div className="mt-0.5 text-[10px] text-white/35">
                  {sceneAsset.materialMode === "solid"
                    ? "画布连接 · GLB 白模场景"
                    : sceneAsset.format === "spz"
                      ? "画布连接 · Marble SPZ 兼容场景"
                      : "画布连接 · GLB 原材质场景"}
                </div>
                {sceneAsset.format === "glb" ? (
                  <div className="mt-2 flex rounded-md bg-black/20 p-0.5" role="group" aria-label="场景材质">
                    {([[
                      "solid", "白模",
                    ], [
                      "original", "原材质",
                    ]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={sceneAsset.materialMode === value}
                        onClick={() => setSceneAssetMaterialMode(value)}
                        className={`flex-1 rounded px-2 py-1 text-[10px] transition-colors ${
                          sceneAsset.materialMode === value
                            ? "bg-white/15 text-white"
                            : "text-white/45 hover:text-white/75"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-dashed border-white/15 p-2.5 text-[11px] leading-4 text-white/40">
              将画布中的 3D 节点连接到导演台，即可加载为可拍摄的真实场景
            </div>
          )}
          <div className="mb-1.5 text-xs font-medium text-white/60">全景背景</div>
          {activePanoramaUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activePanoramaUrl} alt="" className="h-14 w-full rounded-lg object-cover" />
              <div className="mt-1 truncate text-[11px] text-white/40">
                {env.panoSource === "upload" ? "本地上传" : env.panoSource === "history" ? "历史记录" : env.panoSource === "ai" ? "AI 生成" : "已连接全景图"} · {activePanoramaTitle}
              </div>
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
                点击左侧“全景图”，可本地上传、从历史记录选择或使用 AI 生成环境背景
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

      {/* ===== 运镜工作台：掌镜、关键帧、轨迹预演 ===== */}
      {motionOpen && (
        <div
          className="absolute bottom-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-neutral-950/95 p-3 text-white shadow-[0_12px_32px_rgba(0,0,0,0.38)]"
          style={{
            left: sidebarOpen ? "calc(50% + 138px)" : "50%",
            width: sidebarOpen ? "min(820px, calc(100vw - 308px))" : "min(820px, calc(100vw - 2rem))",
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto flex items-center gap-2">
              <Route className="h-4 w-4 text-white/65" />
              <span className="text-sm font-semibold">运镜工作台</span>
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">{motion.keyframes.length} 个镜头</span>
            </div>
            <button
              onClick={() => {
                setPlaying(false);
                apiRef.current?.setPilotMode(!piloting);
              }}
              disabled={loading}
              aria-pressed={piloting}
              className={`${btn} flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${piloting ? "bg-white/15 text-white" : "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"}`}
            >
              <Crosshair className="h-3.5 w-3.5" /> {piloting ? "退出掌镜" : "开始掌镜"}
            </button>
            <button disabled={loading} onClick={recordMotionFrame} className={`${btn} flex items-center gap-1.5 bg-white text-slate-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40`}>
              <Plus className="h-3.5 w-3.5" /> 记录镜头
            </button>
            <button
              onClick={() => { setPlaying(false); apiRef.current?.setPilotMode(false); setMotionOpen(false); }}
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              title="收起运镜工作台"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-white/45">一键运镜</span>
            {MOTION_PRESETS.map((preset) => (
              <button key={preset.key} disabled={loading} onClick={() => applyMotionPreset(preset.key)} className="rounded-md bg-white/8 px-2 py-1 text-[11px] text-white/75 transition-colors duration-150 hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none">
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { setPlaying(false); previewMotionAt(0); }}
              className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
              title="回到开头"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPlaying((value) => !value)}
              disabled={loading || motion.keyframes.length < 2}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-35"
              title={playing ? "暂停 (Space)" : "播放 (Space)"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <span className="w-9 text-right text-[11px] tabular-nums text-white/55">{formatMotionTime(playhead)}</span>
            <div className="relative h-7 min-w-36 flex-1">
              <input
                type="range" min={0} max={motion.duration} step={0.01} value={playhead}
                onChange={(event) => { setPlaying(false); previewMotionAt(Number(event.target.value)); }}
                className="slider-line absolute inset-x-0 top-3 w-full"
                aria-label="运镜时间轴"
              />
              {motion.keyframes.map((frame) => (
                <button
                  key={frame.id}
                  onClick={() => { setPlaying(false); setSelectedFrameId(frame.id); previewMotionAt(frame.time); }}
                  aria-label={`${frame.name}，${formatMotionTime(frame.time)}`}
                  aria-pressed={selectedFrameId === frame.id}
                  className={`absolute top-1 h-3 w-3 -translate-x-1/2 rounded-full border-2 transition-transform duration-150 hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/80 motion-reduce:transition-none ${
                    selectedFrameId === frame.id ? "border-cyan-200 bg-cyan-400" : "border-slate-800 bg-white"
                  }`}
                  style={{ left: `${(frame.time / motion.duration) * 100}%` }}
                  title={`${frame.name} · ${formatMotionTime(frame.time)}`}
                />
              ))}
            </div>
            <span className="w-9 text-[11px] tabular-nums text-white/55">{formatMotionTime(motion.duration)}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 text-[11px] text-white/60">
            <label className="flex items-center gap-1.5">
              时长
              <input
                type="number" min={0.5} max={60} step={0.5} value={motion.duration}
                onChange={(event) => changeMotionDuration(Number(event.target.value))}
                className="w-14 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 text-right text-white outline-none focus:border-cyan-400"
              />
              秒
            </label>
            <label className="flex items-center gap-1.5">
              缓动
              <PopoverSelect
                value={motion.easing}
                options={MOTION_EASING_OPTIONS}
                onChange={(value) => patchMotionSettings({ easing: value as Scene3DMotionEasing })}
                label="运镜缓动方式"
                tone="director"
                minMenuWidth={116}
                className="h-7 min-w-[88px] px-2 py-1 text-[11px] font-medium"
              />
            </label>
            <button
              onClick={() => patchMotionSettings({ loop: !motionRef.current.loop })}
              aria-pressed={motion.loop}
              className={`rounded-md px-2 py-1 transition-colors duration-150 motion-reduce:transition-none ${motion.loop ? "bg-white/15 text-white" : "bg-white/[0.08] text-white/65 hover:bg-white/[0.12]"}`}
            >
              循环
            </button>
            <button
              onClick={() => patchMotionSettings({ showPath: !motionRef.current.showPath })}
              aria-pressed={motion.showPath}
              className={`rounded-md px-2 py-1 transition-colors duration-150 motion-reduce:transition-none ${motion.showPath ? "bg-white/15 text-white" : "bg-white/[0.08] text-white/65 hover:bg-white/[0.12]"}`}
            >
              路线常亮
            </button>
            {selectedMotionFrame && (
              <>
                <span className="ml-auto truncate text-white/45">{selectedMotionFrame.name}</span>
                <label className="flex items-center gap-1">
                  时间
                  <input
                    type="number" min={0} max={motion.duration} step={0.1} value={selectedMotionFrame.time}
                    onChange={(event) => {
                      setPlaying(false);
                      const time = Math.min(motion.duration, Math.max(0, Number(event.target.value) || 0));
                      const current = motionRef.current;
                      const next = normalizeScene3DMotion({
                        ...current,
                        keyframes: current.keyframes.map((frame) => frame.id === selectedMotionFrame.id ? { ...frame, time } : frame),
                      });
                      motionRef.current = next;
                      setMotionState(next);
                      previewMotionAt(time, next);
                    }}
                    className="w-14 rounded-md border border-white/15 bg-white/5 px-1.5 py-1 text-right text-white outline-none focus:border-cyan-400"
                  />
                </label>
                <button onClick={deleteSelectedMotionFrame} className="rounded-md p-1.5 text-white/45 hover:bg-red-500/15 hover:text-red-300" title="删除当前镜头">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== 底部操作栏：预设机位 + 运镜 + 可选画幅截图 ===== */}
      <div className="absolute bottom-6 right-0 flex justify-center px-4" style={{ left: sidebarOpen ? 276 : 0 }}>
        <div className="panel-scroll flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-neutral-950/90 p-2 text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
          <span className="ml-1.5 hidden shrink-0 text-xs font-medium text-white/60 lg:inline">视角</span>
          <div className="flex items-center gap-1.5">
            {VIEW_NAMES.map((v) => (
              <button key={v} onClick={() => apiRef.current?.setView(v)} className={`${btn} bg-white/10 hover:bg-white/20`}>{v}</button>
            ))}
          </div>
          <div className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          <button
            onClick={() => setMotionOpen((value) => !value)}
            disabled={loading}
            aria-expanded={motionOpen}
            className={`${btn} flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${motionOpen ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20"}`}
          >
            <Route className="h-3.5 w-3.5" /> 运镜{motion.keyframes.length ? ` ${motion.keyframes.length}` : ""}
          </button>
          <PopoverSelect
            value={frameAspectKey}
            options={SHOT_RATIO_OPTIONS}
            onChange={(value) => selectFrameAspect(value as FrameAspectKey)}
            label="截图画幅"
            tone="director"
            minMenuWidth={108}
            className="h-8 min-w-[96px] px-2.5 py-1.5 text-xs font-semibold tabular-nums"
          />
          <button
            onClick={handleShot}
            disabled={busy || loading}
            title={shotCount > 0 ? `截图到画布（已截 ${shotCount} 张）` : "截图到画布"}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            截图到画布
          </button>
          {shotCount > 0 && <span className="mr-1.5 hidden shrink-0 text-xs tabular-nums text-white/60 xl:inline">已截 {shotCount} 张</span>}
        </div>
      </div>

      {recognitionOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onMouseDown={() => setRecognitionOpen(false)}>
          <section
            ref={recognitionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="AI识图导入"
            tabIndex={-1}
            className="flex max-h-[min(720px,calc(100vh-48px))] w-[520px] max-w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#202020] text-white shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-11 shrink-0 items-center border-b border-white/10 px-4">
              <h2 className="text-sm font-semibold">AI识图导入</h2>
              <button type="button" onClick={() => setRecognitionOpen(false)} aria-label="关闭AI识图导入" className="ml-auto flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="panel-scroll flex-1 overflow-y-auto px-4 py-3">
              <div className="flex h-7 items-start gap-5 border-b border-white/10 text-xs">
                <button type="button" onClick={() => setRecognitionTab("upload")} disabled={recognitionBusy} className={`h-7 border-b-2 px-0.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 ${recognitionTab === "upload" ? "border-white text-white" : "border-transparent text-white/40"}`}>本地上传</button>
                <button
                  type="button"
                  onClick={() => { setRecognitionTab("history"); if (!panoramaHistoryLoaded) void loadPanoramaHistory(); }}
                  disabled={recognitionBusy}
                  className={`h-7 border-b-2 px-0.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 ${recognitionTab === "history" ? "border-white text-white" : "border-transparent text-white/40"}`}
                >
                  历史记录
                </button>
              </div>

              {recognitionTab === "upload" ? (
                <div className="mt-3">
                  <input ref={recognitionFileRef} type="file" accept="image/*" className="hidden" onChange={handleRecognitionUpload} />
                  <button
                    type="button"
                    onClick={() => recognitionFileRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) void uploadRecognitionFile(file);
                    }}
                    disabled={recognitionUploading || recognitionBusy}
                    className="flex h-60 w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-white/15 bg-[#191919] text-center hover:border-white/30 disabled:opacity-50"
                  >
                    {recognitionSource ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={recognitionSource.url} alt={recognitionSource.title} className="h-full w-full object-contain" />
                    ) : recognitionUploading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-white/60" />
                    ) : (
                      <>
                        <Upload className="mb-3 h-6 w-6 text-white/55" />
                        <div className="text-xs font-medium text-white/80">点击上传图片 或 拖拽本地图片至此上传</div>
                        <div className="mt-2 text-[11px] text-white/35">上传后画布将新建一个图片节点并替换当前识图来源</div>
                      </>
                    )}
                  </button>
                  {recognitionSource && (
                    <div className="mt-2 flex items-center text-[11px] text-white/45">
                      <span className="min-w-0 flex-1 truncate">{recognitionSource.title}</span>
                      <button type="button" disabled={recognitionBusy} onClick={(event) => { event.stopPropagation(); setRecognitionSource(null); }} className="ml-2 text-white/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">重新选择</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="panel-scroll mt-3 max-h-60 overflow-y-auto pr-1">
                  {panoramaHistoryLoading && panoramaHistory.length === 0 ? (
                    <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white/50" /></div>
                  ) : panoramaHistory.length ? (
                    <div className="grid grid-cols-3 gap-2">
                      {panoramaHistory.map((record) => (
                        <button key={record.id} type="button" disabled={recognitionBusy} onClick={() => selectRecognitionHistory(record)} className="overflow-hidden rounded-md border border-white/10 bg-black/20 hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={record.resultUrl} alt="历史图片" className="h-20 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center text-xs text-white/35">暂无可用的图片记录</div>
                  )}
                </div>
              )}

              <div className="mt-3 text-xs font-medium text-white/65">生成内容</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([[
                  "blocking", "站位参考", "识别人物站位、朝向和机位，生成参考小人",
                ], [
                  "whitebox", "3D白膜生成", "识别场景物品生成白膜体块，并摆放人物站位",
                ]] as const).map(([value, title, description]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={recognitionBusy}
                    onClick={() => {
                      setRecognitionKind(value);
                      if (value === "whitebox") setRecognitionMode("replace");
                    }}
                    className={`flex min-h-[52px] items-start gap-2 rounded-lg border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${recognitionKind === value ? "border-white/35 bg-white/[0.06]" : "border-white/10"}`}
                  >
                    <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border p-[3px] ${recognitionKind === value ? "border-white" : "border-white/30"}`}>
                      {recognitionKind === value && <span className="block h-full w-full rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className="block text-[11px] font-medium text-white/85">{title}</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-white/35">{description}</span>
                    </span>
                  </button>
                ))}
              </div>

              {recognitionKind === "whitebox" && (
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="text-[11px] font-medium text-white/65">智能执行流程</div>
                  <ol className="mt-2 space-y-1.5">
                    {WHITEBOX_FLOW_STEPS.map((label, index) => {
                      const stepNo = index + 1;
                      const done = recognitionStep > stepNo;
                      const active = recognitionStep === stepNo;
                      return (
                        <li key={label} className={`flex items-center gap-2 text-[11px] ${active ? "text-white/85" : done ? "text-white/55" : "text-white/35"}`}>
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {active ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : done ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <span className="text-[10px] tabular-nums">{stepNo}</span>
                            )}
                          </span>
                          {label}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <div className="mt-3 text-xs font-medium text-white/65">选择是否覆盖场景</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([
                  ["insert", "插入当前导演台", "作为站位参考插入，不覆盖当前场景、角色和机位"],
                  ["replace", "覆盖当前导演台", recognitionKind === "whitebox"
                    ? "以生成的白膜场景和人物站位覆盖当前场景、角色和机位"
                    : "作为站位参考层插入，覆盖当前场景、角色和机位"],
                ] as Array<[ImportMode, string, string]>).map(([value, title, description]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={recognitionBusy || (recognitionKind === "whitebox" && value === "insert")}
                    onClick={() => setRecognitionMode(value)}
                    className={`flex min-h-[52px] items-start gap-2 rounded-lg border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${recognitionMode === value ? "border-white/35 bg-white/[0.06]" : "border-white/10"}`}
                  >
                    <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border p-[3px] ${recognitionMode === value ? "border-white" : "border-white/30"}`}>
                      {recognitionMode === value && <span className="block h-full w-full rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className="block text-[11px] font-medium text-white/85">{title}</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-white/35">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
              {recognitionKind === "whitebox" && (
                <div className="mt-2 text-[10px] text-white/35">3D白膜生成会重建整个舞台，仅支持覆盖导入</div>
              )}
            </div>

            <footer className="flex h-13 shrink-0 items-center border-t border-white/10 px-4 py-3">
              <span className="text-[10px] text-white/35">
                {recognitionKind === "whitebox"
                  ? "关闭不会中断已提交的识图任务，生成白膜场景后自动覆盖导演台"
                  : "关闭不会中断已提交的识图任务，生成站位参考后自动导入导演台"}
              </span>
              <button
                type="button"
                onClick={() => void generateBlockingReference()}
                disabled={!recognitionSource || recognitionUploading || recognitionBusy}
                className="ml-auto flex h-8 shrink-0 items-center gap-2 rounded-md bg-white px-3 text-xs font-medium text-neutral-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {recognitionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {recognitionBusy
                  ? (recognitionKind === "whitebox" ? "生成中" : "识图中")
                  : (recognitionKind === "whitebox" ? "生成3D白膜" : "生成站位参考")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>,
    document.body,
  );
}
