"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ChevronsUpDown, ImagePlus, Loader2 } from "lucide-react";
import { ossDisplayUrl } from "@/lib/oss-display";

export type PortraitFeaturePanelMode = "makeup" | "expression" | "texture";
export type PortraitFeatureResolution = string;

export interface PortraitFeatureGenerateRequest {
  title: string;
  prompt: string;
  resolution?: PortraitFeatureResolution;
  ratio?: string;
  references?: string[];
}

interface Props {
  mode: PortraitFeaturePanelMode;
  resolutionOptions: readonly string[];
  allowReferenceUpload: boolean;
  resolvePointCost: (resolution?: PortraitFeatureResolution) => number;
  onClose: () => void;
  onGenerate: (request: PortraitFeatureGenerateRequest) => void;
  onUploadReference: (file: File) => Promise<string | null>;
}

interface MakeupPreset {
  id: string;
  label: string;
  prompt: string;
  spriteIndex: number;
}

const MAKEUP_PRESET_SPRITE = "/assets/canvas/makeup-presets-v1.webp";
const MAKEUP_COSTUME_PRESET_SPRITE = "/assets/canvas/makeup-costume-presets-v1.webp";
const MAKEUP_STORY_PRESET_SPRITE = "/assets/canvas/makeup-story-presets-v1.webp";
const EXPRESSION_PREVIEW_SPRITE = "/assets/canvas/expression-preview-v1.webp";
const spritePreloaders = new Map<string, HTMLImageElement>();

function preloadSprite(src: string) {
  if (typeof window === "undefined") return;
  let preloader = spritePreloaders.get(src);
  if (!preloader) {
    preloader = new window.Image();
    preloader.decoding = "async";
    preloader.fetchPriority = "high";
    preloader.src = src;
    spritePreloaders.set(src, preloader);
  }
  void preloader.decode?.().catch(() => undefined);
}

export function preloadExpressionPreviewSprite() {
  preloadSprite(EXPRESSION_PREVIEW_SPRITE);
}

const MAKEUP_GROUPS: Array<{
  key: "modern" | "costume" | "story";
  label: string;
  sprite: string;
  presets: MakeupPreset[];
}> = [
  {
    key: "modern",
    label: "现代",
    sprite: MAKEUP_PRESET_SPRITE,
    presets: [
      { id: "commute-nude", label: "通勤裸妆", prompt: "自然通勤裸妆，轻薄底妆、柔和眉形、低饱和唇色", spriteIndex: 0 },
      { id: "urban-elite", label: "都市精英", prompt: "都市精英妆容，利落眉眼、干净底妆、知性豆沙唇", spriteIndex: 1 },
      { id: "cool-fashion", label: "冷感时尚", prompt: "冷感时尚妆容，冷灰眼妆、清晰轮廓、低温红唇", spriteIndex: 2 },
      { id: "glamorous", label: "明艳浓妆", prompt: "明艳浓妆，精致眼线、浓密睫毛、饱和红唇与立体修容", spriteIndex: 3 },
      { id: "moonlight", label: "白月光", prompt: "清透白月光妆容，轻盈底妆、柔粉腮红、通透水光唇", spriteIndex: 4 },
      { id: "heiress", label: "豪门千金", prompt: "高级千金妆容，奶油肌、精致眉眼、柔润玫瑰唇", spriteIndex: 5 },
      { id: "hongkong-retro", label: "港风复古", prompt: "复古港风妆容，浓眉卷发氛围、暖棕眼妆、复古红唇", spriteIndex: 6 },
      { id: "sweet-cool", label: "甜酷辣妹", prompt: "甜酷辣妹妆容，闪亮眼妆、上扬眼线、莓果唇与轻微晒伤腮红", spriteIndex: 7 },
      { id: "fresh-boy", label: "清爽少年", prompt: "清爽少年感妆容，弱化瑕疵、自然眉形、干净哑光肤感", spriteIndex: 8 },
      { id: "sharp-elite", label: "利落精英", prompt: "利落精英男妆，清晰眉形、自然修容、低油光干净肤感", spriteIndex: 9 },
      { id: "mature-gentleman", label: "成熟绅士", prompt: "成熟绅士妆容，保留成熟纹理、修整眉形、稳重自然肤色", spriteIndex: 10 },
      { id: "cold-male", label: "冷峻时尚", prompt: "冷峻时尚男妆，冷调轮廓、利落眉眼、低饱和哑光肤感", spriteIndex: 11 },
      { id: "k-pop", label: "韩系偶像", prompt: "韩系偶像妆容，细腻水光肌、精致眼妆、柔和渐变唇", spriteIndex: 12 },
      { id: "restrained-ceo", label: "禁欲总裁", prompt: "克制高级的商务男妆，锋利眉形、轻修容、干净哑光质感", spriteIndex: 13 },
      { id: "hk-dandy", label: "港风雅痞", prompt: "港风雅痞妆容，暖调肤色、自然眉眼、复古胶片氛围", spriteIndex: 14 },
      { id: "rocker", label: "痞帅摇滚", prompt: "痞帅摇滚妆容，烟熏眼妆、强化轮廓、略带粗粝舞台质感", spriteIndex: 15 },
    ],
  },
  {
    key: "costume",
    label: "古装",
    sprite: MAKEUP_COSTUME_PRESET_SPRITE,
    presets: [
      { id: "costume-elegant", label: "清雅素妆", prompt: "清雅古典素妆，远山眉、轻扫胭脂、淡雅唇色", spriteIndex: 0 },
      { id: "tang-huadian", label: "盛唐花钿", prompt: "盛唐华美妆容，额间花钿、饱满胭脂、浓郁红唇", spriteIndex: 3 },
      { id: "song-light", label: "宋制淡妆", prompt: "宋制淡雅妆容，细眉、浅朱唇、清透克制的东方肤感", spriteIndex: 4 },
      { id: "dunhuang", label: "敦煌飞天", prompt: "敦煌飞天妆容，金色额饰、飞扬眼线、赭红与石绿色点缀", spriteIndex: 6 },
      { id: "swordswoman", label: "侠女英气", prompt: "古装侠女妆容，英气眉形、自然肤色、克制红唇", spriteIndex: 2 },
      { id: "oriental-fantasy", label: "东方妖姬", prompt: "东方幻想浓妆，上扬眼线、深色眼影、妖冶红唇与精致花纹", spriteIndex: 7 },
    ],
  },
  {
    key: "story",
    label: "剧情",
    sprite: MAKEUP_STORY_PRESET_SPRITE,
    presets: [
      { id: "campus", label: "校园初恋", prompt: "清新校园感淡妆，轻薄底妆、自然眉眼、柔粉唇色", spriteIndex: 4 },
      { id: "republic", label: "民国千金", prompt: "民国千金妆容，细长眉形、复古红唇、温润胶片色调", spriteIndex: 6 },
      { id: "cyberpunk", label: "赛博霓虹", prompt: "赛博霓虹妆容，金属高光、荧光眼线、冷暖霓虹色点缀", spriteIndex: 7 },
      { id: "post-apocalypse", label: "末日风尘", prompt: "末日剧情妆容，真实尘土、轻微擦伤、疲惫但有层次的肤感", spriteIndex: 10 },
      { id: "stage", label: "舞台戏剧", prompt: "舞台戏剧妆容，夸张眉眼、强化轮廓、高饱和舞台色彩", spriteIndex: 3 },
      { id: "gothic", label: "暗黑哥特", prompt: "暗黑哥特妆容，苍白底妆、深色烟熏眼、暗红唇色", spriteIndex: 15 },
    ],
  },
];

export function preloadMakeupPresetSprites() {
  for (const group of MAKEUP_GROUPS) preloadSprite(group.sprite);
}

const EXPRESSIONS = [
  { key: "joy", label: "喜", prompt: "喜悦、自然微笑" },
  { key: "surprise", label: "吃惊", prompt: "惊讶，眼睛微微睁大、嘴部自然张开" },
  { key: "confused", label: "困惑", prompt: "困惑，一侧眉毛微抬、视线带疑问" },
  { key: "anger", label: "怒", prompt: "生气，眉头收紧、眼神有力度" },
  { key: "sad", label: "悲伤", prompt: "悲伤，眉眼低垂、嘴角轻微下压" },
] as const;

const EXPRESSION_STRENGTH = ["轻微", "较轻", "标准", "明显", "强烈"] as const;
type ExpressionStrength = 1 | 2 | 3 | 4 | 5;

interface ExpressionSelection {
  emotion: (typeof EXPRESSIONS)[number]["key"];
  strength: ExpressionStrength;
}

const TEXTURE_PRESETS = [
  { key: "natural", title: "自然真实", description: "保留毛孔，减弱塑料感", prompt: "自然真实肤质，保留合理毛孔和细微肌理，减弱塑料感" },
  { key: "clean", title: "清透细腻", description: "轻净瑕疵，保留自然纹理", prompt: "清透细腻肤质，轻度净化暂时性瑕疵，同时保留自然皮肤纹理" },
  { key: "matte", title: "高级哑光", description: "降低油光，保持立体层次", prompt: "高级哑光肤质，降低油光，保持五官与面部立体层次" },
  { key: "cream", title: "柔润奶油", description: "柔化高光，保留五官清晰", prompt: "柔润奶油肤质，柔化高光与过硬反射，保持五官清晰" },
  { key: "film", title: "电影颗粒", description: "减弱数码锐感，增加细微颗粒", prompt: "电影胶片肤质，减弱数码锐感，增加克制细微的胶片颗粒" },
  { key: "documentary", title: "纪实粗粝", description: "强化微纹理与真实细节", prompt: "纪实粗粝肤质，强化细微纹理、真实细节与自然不完美" },
] as const;

const TEXTURE_STRENGTH = [
  { key: "light", label: "轻", prompt: "轻度调整" },
  { key: "standard", label: "标准", prompt: "标准强度调整" },
  { key: "strong", label: "强", prompt: "明显但仍自然的强度调整" },
] as const;

function makeupSpriteStyle(spriteIndex: number, sprite: string) {
  const column = spriteIndex % 4;
  const row = Math.floor(spriteIndex / 4);
  return {
    backgroundImage: `url(${sprite})`,
    backgroundPosition: `${(column / 3) * 100}% ${(row / 3) * 100}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: "400% 400%",
  };
}

export function PortraitFeaturePanel({
  mode,
  resolutionOptions,
  allowReferenceUpload,
  resolvePointCost,
  onClose,
  onGenerate,
  onUploadReference,
}: Props) {
  const availableResolutions = [...new Set(resolutionOptions)];
  const preferredResolution = availableResolutions.find((item) => item.toLowerCase() === "2k") ?? availableResolutions[0] ?? "";
  const [resolution, setResolution] = useState<PortraitFeatureResolution>(preferredResolution);
  const activeResolution = availableResolutions.includes(resolution) ? resolution : preferredResolution;
  const [makeupGroup, setMakeupGroup] = useState<(typeof MAKEUP_GROUPS)[number]["key"]>("modern");
  const [makeupPreset, setMakeupPreset] = useState("commute-nude");
  const [makeupReference, setMakeupReference] = useState<string | null>(null);
  const [uploadingReference, setUploadingReference] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const makeupInputRef = useRef<HTMLInputElement>(null);
  const [expression, setExpression] = useState<ExpressionSelection>({ emotion: "joy", strength: 1 });
  const [isExpressionScrubbing, setIsExpressionScrubbing] = useState(false);
  const expressionMatrixRef = useRef<HTMLDivElement>(null);
  const expressionScrubRef = useRef<{ pointerId: number; lastCell: string } | null>(null);
  const [texture, setTexture] = useState<(typeof TEXTURE_PRESETS)[number]["key"]>("natural");
  const [textureStrength, setTextureStrength] = useState<(typeof TEXTURE_STRENGTH)[number]["key"]>("standard");

  const activeMakeupGroup = MAKEUP_GROUPS.find((group) => group.key === makeupGroup) ?? MAKEUP_GROUPS[0];
  const selectedMakeup = useMemo(
    () => MAKEUP_GROUPS.flatMap((group) => group.presets).find((preset) => preset.id === makeupPreset),
    [makeupPreset],
  );
  const selectedExpressionIndex = Math.max(0, EXPRESSIONS.findIndex((item) => item.key === expression.emotion));
  const selectedExpression = EXPRESSIONS[selectedExpressionIndex];

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const stopWheelPropagation = (event: WheelEvent) => event.stopPropagation();
    panel.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => panel.removeEventListener("wheel", stopWheelPropagation);
  }, []);

  useEffect(() => {
    if (mode === "expression") preloadExpressionPreviewSprite();
    else if (mode === "makeup") preloadMakeupPresetSprites();
  }, [mode]);

  const selectExpressionCell = (emotionIndex: number, strengthValue: number) => {
    if (!Number.isInteger(emotionIndex) || !Number.isInteger(strengthValue)) return;
    const item = EXPRESSIONS[emotionIndex];
    if (!item || strengthValue < 1 || strengthValue > EXPRESSION_STRENGTH.length) return;
    const strength = strengthValue as ExpressionStrength;
    const cellKey = `${item.key}:${strength}`;
    if (expressionScrubRef.current?.lastCell === cellKey) return;
    if (expressionScrubRef.current) expressionScrubRef.current.lastCell = cellKey;
    setExpression((current) => current.emotion === item.key && current.strength === strength
      ? current
      : { emotion: item.key, strength });
  };

  const selectExpressionAtPoint = (clientX: number, clientY: number) => {
    const matrix = expressionMatrixRef.current;
    if (!matrix) return;
    const target = document.elementFromPoint(clientX, clientY);
    const cell = target?.closest<HTMLElement>("[data-expression-cell]");
    if (!cell || !matrix.contains(cell)) return;
    selectExpressionCell(Number(cell.dataset.emotionIndex), Number(cell.dataset.strength));
  };

  const focusExpressionCell = (cellKey: string) => {
    if (!cellKey) return;
    window.requestAnimationFrame(() => {
      expressionMatrixRef.current
        ?.querySelector<HTMLButtonElement>(`[data-expression-key="${cellKey}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  const handleExpressionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    emotionIndex: number,
    strength: ExpressionStrength,
  ) => {
    let nextEmotionIndex = emotionIndex;
    let nextStrength: ExpressionStrength = strength;
    if (event.key === "ArrowLeft") nextStrength = Math.max(1, strength - 1) as ExpressionStrength;
    else if (event.key === "ArrowRight") nextStrength = Math.min(5, strength + 1) as ExpressionStrength;
    else if (event.key === "ArrowUp") nextEmotionIndex = Math.max(0, emotionIndex - 1);
    else if (event.key === "ArrowDown") nextEmotionIndex = Math.min(EXPRESSIONS.length - 1, emotionIndex + 1);
    else if (event.key === "Home") nextStrength = 1;
    else if (event.key === "End") nextStrength = 5;
    else return;

    event.preventDefault();
    event.stopPropagation();
    selectExpressionCell(nextEmotionIndex, nextStrength);
    focusExpressionCell(`${EXPRESSIONS[nextEmotionIndex].key}:${nextStrength}`);
  };

  const finishExpressionScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (expressionScrubRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    selectExpressionAtPoint(event.clientX, event.clientY);
    const lastCell = expressionScrubRef.current.lastCell;
    expressionScrubRef.current = null;
    setIsExpressionScrubbing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    focusExpressionCell(lastCell);
  };

  const cancelExpressionScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (expressionScrubRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    expressionScrubRef.current = null;
    setIsExpressionScrubbing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const submit = () => {
    if (mode === "makeup") {
      const custom = makeupPreset === "custom" && makeupReference;
      const makeupInstruction = custom
        ? "严格参考第二张图片的妆容风格、配色和精细度，将该妆容自然迁移到第一张图片的人物"
        : selectedMakeup?.prompt ?? "自然通勤裸妆";
      onGenerate({
        title: custom ? "自定义妆容" : selectedMakeup?.label ?? "妆容调节",
        resolution: activeResolution || undefined,
        references: custom ? [makeupReference] : undefined,
        prompt: [
          "只调整参考图中人物的妆容，不改变人物身份、脸型、五官比例、发型、服装、姿态、构图、背景和光照。",
          makeupInstruction + "。",
          "妆容需要贴合原始面部结构与皮肤光影，边缘自然，不要过度磨皮，不要生成文字或拼图。",
        ].join(" "),
      });
      return;
    }

    if (mode === "expression") {
      onGenerate({
        title: `表情调节 · ${selectedExpression.label}`,
        resolution: activeResolution || undefined,
        prompt: [
          "只调整参考图中人物的面部表情，严格保持人物身份、五官结构、脸型、发型、妆容、服装、姿态、构图、背景与光照不变。",
          `目标表情为${selectedExpression.prompt}，强度为${EXPRESSION_STRENGTH[expression.strength - 1]}。`,
          "表情肌肉变化必须真实自然，避免夸张变形、身份漂移、额外人物、文字或拼图。",
        ].join(" "),
      });
      return;
    }

    const selectedTexture = TEXTURE_PRESETS.find((item) => item.key === texture) ?? TEXTURE_PRESETS[0];
    const selectedStrength = TEXTURE_STRENGTH.find((item) => item.key === textureStrength) ?? TEXTURE_STRENGTH[1];
    onGenerate({
      title: `人像质感 · ${selectedTexture.title}`,
      resolution: activeResolution || undefined,
      prompt: [
        "只调整参考图中人物的皮肤与成片质感，严格保持人物身份、五官、表情、妆容、发型、服装、姿态、构图、背景和画面内容不变。",
        `${selectedTexture.prompt}，${selectedStrength.prompt}。`,
        "皮肤细节真实连贯，不改变年龄与肤色，不做过度磨皮，不增加文字、水印或拼图。",
      ].join(" "),
    });
  };

  const uploadMakeupReference = async (file: File | undefined) => {
    if (!file || !allowReferenceUpload) return;
    setUploadingReference(true);
    try {
      const url = await onUploadReference(file);
      if (url) {
        setMakeupReference(url);
        setMakeupPreset("custom");
      }
    } finally {
      setUploadingReference(false);
      if (makeupInputRef.current) makeupInputRef.current.value = "";
    }
  };

  const panelSizeClass = mode === "makeup"
    ? "h-[min(482px,calc(100vh-96px))] w-[min(448px,calc(100vw-24px))]"
    : mode === "expression"
      ? "h-[min(328px,calc(100vh-96px))] w-[min(602px,calc(100vw-24px))]"
      : "h-[min(433px,calc(100vh-96px))] w-[min(446px,calc(100vw-24px))]";
  const panelLayoutClass = mode === "expression"
    ? "grid grid-rows-[minmax(0,1fr)_60px]"
    : "flex flex-col";
  const footerSizeClass = mode === "makeup" ? "h-[56px] px-3" : mode === "expression" ? "h-[60px] px-4" : "h-[72px] px-4";
  const resolutionWidthClass = mode === "makeup" ? "w-[68px]" : mode === "expression" ? "w-[64px]" : "w-[76px]";
  const generateButtonSizeClass = mode === "makeup"
    ? "h-10 min-w-[120px]"
    : mode === "expression"
      ? "h-[38px] min-w-[126px]"
      : "h-[38px] min-w-[139px]";
  const generateLabel = mode === "texture" ? "生成人像质感" : "生成图片";
  const pointCost = Math.ceil(resolvePointCost(activeResolution || undefined));

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={mode === "makeup" ? "妆容调节" : mode === "expression" ? "表情调节" : "人像质感"}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      className={`${panelSizeClass} ${panelLayoutClass} overflow-hidden ${mode === "expression" ? "rounded-[24px]" : "rounded-[22px]"} bg-white text-neutral-800 shadow-[0_16px_48px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200/90 dark:bg-[#29292b] dark:text-white dark:ring-white/10`}
    >
      {mode === "makeup" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-neutral-200/80 pb-2 dark:border-white/10">
            <div className="mx-3 mt-2 grid h-9 grid-cols-3 rounded-full bg-neutral-100 p-[3px] dark:bg-white/7">
              {MAKEUP_GROUPS.map((group) => (
                <button
                  type="button"
                  key={group.key}
                  onClick={() => {
                    setMakeupGroup(group.key);
                    setMakeupPreset(group.presets[0]?.id ?? "commute-nude");
                  }}
                  className={`rounded-full text-xs transition-colors ${makeupGroup === group.key ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-white/12 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:text-white/50 dark:hover:text-white/75"}`}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>

          <div className="thin-scroll grid min-h-0 flex-1 grid-cols-5 content-start gap-2 overflow-y-auto px-3 py-4">
            <button
              type="button"
              disabled={!allowReferenceUpload}
              onClick={() => makeupInputRef.current?.click()}
              title={allowReferenceUpload ? "上传妆容参考图" : "当前模型只支持一张参考图，无法使用自定义参考妆"}
              aria-label={allowReferenceUpload ? "上传参考，自定义妆容" : "当前模型不支持自定义妆容参考"}
              className={`relative block h-0 w-full pt-[100%] overflow-hidden rounded-[8px] border bg-white text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${makeupPreset === "custom" ? "border-neutral-400 ring-1 ring-black/15 dark:border-white/50" : "border-neutral-200 hover:border-neutral-400 dark:border-white/12 dark:bg-white/[.03] dark:hover:border-white/30"}`}
            >
              {makeupReference ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ossDisplayUrl(makeupReference, 256)} alt="自定义妆容参考" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              {makeupReference ? <span className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" /> : null}
              <span className={`absolute inset-0 z-[1] flex flex-col items-center ${makeupReference ? "justify-end pb-1.5 text-white" : "justify-center text-neutral-500 dark:text-white/60"}`}>
                {uploadingReference ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                <span className="mt-1 text-[10px] leading-none opacity-70">上传参考</span>
                <span className="mt-1 text-[11px] font-medium leading-none">自定义妆容</span>
              </span>
              {makeupPreset === "custom" ? (
                <span className="absolute right-1 top-1 z-[2] flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-black text-white shadow-sm">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </button>
            <input
              ref={makeupInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void uploadMakeupReference(event.target.files?.[0])}
            />
            {activeMakeupGroup.presets.map((preset) => {
              const selected = makeupPreset === preset.id;
              return (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => setMakeupPreset(preset.id)}
                  aria-pressed={selected}
                  aria-label={preset.label}
                  className={`relative block h-0 w-full pt-[100%] overflow-hidden rounded-[8px] border bg-neutral-100 text-left transition-all ${selected ? "border-neutral-400 ring-1 ring-black/15 dark:border-white/50" : "border-neutral-200 hover:border-neutral-400 dark:border-white/12 dark:hover:border-white/30"}`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={makeupSpriteStyle(preset.spriteIndex, activeMakeupGroup.sprite)}
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-1.5 pb-1.5 pt-5 text-[11px] font-medium leading-none text-white">{preset.label}</span>
                  {selected ? (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-black text-white shadow-sm">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : mode === "expression" ? (
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,282px)_minmax(0,1fr)] gap-3 p-3">
          <div
            aria-label={`${selectedExpression.label} · ${EXPRESSION_STRENGTH[expression.strength - 1]}表情白模预览`}
            className="flex min-h-0 items-center justify-center overflow-hidden rounded-[22px] border border-neutral-200 bg-[#f5f5f5] [contain:paint] dark:border-white/10 dark:bg-white/5"
          >
            <span aria-hidden="true" className="relative aspect-square h-full shrink-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={EXPRESSION_PREVIEW_SPRITE}
                alt=""
                draggable={false}
                decoding="async"
                className="pointer-events-none absolute left-0 top-0 h-[500%] w-[500%] max-w-none select-none object-fill will-change-transform [backface-visibility:hidden]"
                style={{
                  transform: `translate3d(-${(expression.strength - 1) * 20}%, -${selectedExpressionIndex * 20}%, 0)`,
                }}
              />
            </span>
          </div>
          <div
            className="grid min-h-0 grid-rows-[minmax(0,1fr)_16px] rounded-[22px] border border-neutral-200 px-3 py-4 dark:border-white/10"
          >
            <div className="grid min-h-0 grid-cols-[38px_minmax(0,1fr)]">
              <div aria-hidden="true" className="grid min-h-0 grid-rows-5 items-center">
                {EXPRESSIONS.map((item) => (
                  <span
                    key={item.key}
                    className={`text-xs transition-[color,font-weight] duration-100 ${expression.emotion === item.key ? "font-medium text-neutral-600 dark:text-white/70" : "text-neutral-400 dark:text-white/35"}`}
                  >
                    {item.label}
                  </span>
                ))}
              </div>

              <div
                ref={expressionMatrixRef}
                role="radiogroup"
                aria-label="表情强度矩阵，点击或按住拖动选择；方向键也可以切换"
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  if (expressionScrubRef.current && expressionScrubRef.current.pointerId !== event.pointerId) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-expression-cell]");
                  if (!target || !event.currentTarget.contains(target)) return;
                  if (event.pointerType !== "mouse") event.preventDefault();
                  event.stopPropagation();
                  expressionScrubRef.current = { pointerId: event.pointerId, lastCell: "" };
                  setIsExpressionScrubbing(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  selectExpressionCell(Number(target.dataset.emotionIndex), Number(target.dataset.strength));
                }}
                onPointerMove={(event) => {
                  if (expressionScrubRef.current?.pointerId !== event.pointerId) return;
                  if (event.pointerType === "mouse" && event.buttons === 0) {
                    cancelExpressionScrub(event);
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  selectExpressionAtPoint(event.clientX, event.clientY);
                }}
                onPointerUp={finishExpressionScrub}
                onPointerCancel={cancelExpressionScrub}
                onLostPointerCapture={(event) => {
                  if (expressionScrubRef.current?.pointerId === event.pointerId) {
                    expressionScrubRef.current = null;
                    setIsExpressionScrubbing(false);
                  }
                }}
                className={`relative grid min-h-0 touch-none select-none grid-cols-5 grid-rows-5 [-webkit-touch-callout:none] ${isExpressionScrubbing ? "cursor-grabbing" : "cursor-crosshair"}`}
              >
                {EXPRESSIONS.flatMap((item, emotionIndex) => {
                  const activeRow = expression.emotion === item.key;
                  return EXPRESSION_STRENGTH.map((strengthLabel, index) => {
                    const level = index + 1;
                    const selected = activeRow && expression.strength === level;
                    const darkDot = activeRow || expression.strength === level;
                    return (
                      <button
                        type="button"
                        key={`${item.key}:${level}`}
                        data-expression-cell
                        data-expression-key={`${item.key}:${level}`}
                        data-emotion-index={emotionIndex}
                        data-strength={level}
                        onClick={(event) => {
                          if (event.detail === 0) selectExpressionCell(emotionIndex, level);
                        }}
                        onKeyDown={(event) => handleExpressionKeyDown(event, emotionIndex, level as ExpressionStrength)}
                        title={`${item.label} · ${strengthLabel}`}
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${item.label}，${strengthLabel}`}
                        tabIndex={selected ? 0 : -1}
                        className={`group flex h-full min-h-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 dark:focus-visible:ring-white/40 ${isExpressionScrubbing ? "cursor-grabbing" : "cursor-pointer"}`}
                      >
                        <span className={`pointer-events-none h-2 w-2 rounded-full transition-[background-color,box-shadow,transform] duration-100 group-hover:scale-125 group-hover:shadow-[0_0_0_5px_rgba(0,0,0,0.035)] ${darkDot ? "bg-[#444] dark:bg-white/70" : "bg-[#b9b9b9] dark:bg-white/25"}`} />
                      </button>
                    );
                  });
                })}

                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-0 z-10 flex h-[20%] w-[20%] items-center justify-center transition-transform duration-75 ease-[cubic-bezier(.22,.8,.3,1)] will-change-transform motion-reduce:transition-none"
                  style={{
                    transform: `translate3d(${(expression.strength - 1) * 100}%, ${selectedExpressionIndex * 100}%, 0)`,
                  }}
                >
                  <span className={`h-7 w-7 rounded-full bg-white ring-1 ring-black/5 transition-[box-shadow,transform] duration-100 dark:bg-white/90 dark:ring-white/10 ${isExpressionScrubbing ? "scale-105 shadow-[0_4px_13px_rgba(0,0,0,0.24)]" : "shadow-[0_2px_8px_rgba(0,0,0,0.18)]"}`} />
                </span>
              </div>
            </div>

            <div aria-hidden="true" className="grid grid-cols-[38px_minmax(0,1fr)] items-end text-[10px] leading-none text-neutral-300 dark:text-white/25">
              <span />
              <div className="grid grid-cols-5">
                <span className="text-center">轻微</span>
                <span />
                <span />
                <span />
                <span className="text-center">强烈</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-4 pt-4">
          <h3 className="text-[15px] font-semibold leading-5">人像质感</h3>
          <p className="mt-1 text-[13px] leading-[18px] text-neutral-400">调整皮肤与成片质感，保持角色身份和画面内容不变</p>

          <div className="mt-[35px] grid grid-cols-2 gap-[10px]">
            {TEXTURE_PRESETS.map((item) => {
              const selected = texture === item.key;
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setTexture(item.key)}
                  aria-pressed={selected}
                  className={`h-[61px] rounded-[22px] border px-3 py-2 text-left transition-colors ${selected ? "border-neutral-200 bg-white shadow-sm dark:border-white/20 dark:bg-white/10" : "border-neutral-200 bg-neutral-100/45 hover:border-neutral-300 dark:border-white/10 dark:bg-white/[.03] dark:hover:border-white/20"}`}
                >
                  <div className="text-xs font-medium leading-4 text-neutral-800 dark:text-white/85">{item.title}</div>
                  <div className="mt-1 text-[11px] leading-4 text-neutral-400">{item.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-[15px] flex h-8 items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-white/50">调节强度</span>
            <div className="grid h-8 w-32 grid-cols-[38px_52px_38px] overflow-hidden rounded-full border border-neutral-200 dark:border-white/10">
              {TEXTURE_STRENGTH.map((item, index) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setTextureStrength(item.key)}
                  aria-pressed={textureStrength === item.key}
                  className={`text-xs transition-colors ${index > 0 ? "border-l border-neutral-200 dark:border-white/10" : ""} ${textureStrength === item.key ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-white/12 dark:text-white" : "bg-white/40 text-neutral-500 hover:bg-neutral-50 dark:bg-transparent dark:text-white/50 dark:hover:bg-white/5"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className={`${footerSizeClass} flex shrink-0 items-center border-t border-neutral-200/80 dark:border-white/10`}>
        {mode === "makeup" ? (
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-[10px] leading-4 text-neutral-400">当前选择</div>
            <div className="truncate text-[11px] font-medium leading-4 text-neutral-800 dark:text-white/80">
              {makeupPreset === "custom" ? "自定义妆容" : selectedMakeup?.label}
            </div>
          </div>
        ) : <div className="flex-1" />}

        <div className="flex shrink-0 items-center gap-2">
          {availableResolutions.length > 0 ? (
            <div className={`${resolutionWidthClass} relative h-10 shrink-0`}>
              <select
                value={activeResolution}
                onChange={(event) => setResolution(event.target.value as PortraitFeatureResolution)}
                className={`h-full w-full cursor-pointer appearance-none rounded-full border-0 pl-3 pr-7 text-xs font-medium text-neutral-600 outline-none ${mode === "expression" ? "bg-transparent hover:bg-neutral-50" : "bg-neutral-50 hover:bg-neutral-100"} dark:bg-white/5 dark:text-white/65 dark:hover:bg-white/8`}
                aria-label="输出清晰度"
              >
                {availableResolutions.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
              </select>
              <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            </div>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={uploadingReference || (mode === "makeup" && makeupPreset === "custom" && (!makeupReference || !allowReferenceUpload))}
            className={`${generateButtonSizeClass} whitespace-nowrap rounded-full bg-black px-4 text-xs font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-neutral-200`}
          >
            {generateLabel}<span className="ml-1 text-[11px] font-normal opacity-80">{pointCost}积分</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
