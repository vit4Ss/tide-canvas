"use client";

/* ============================================================================
   /chat — 对话式生成 (Chat) page.

   Ported from design-ref/对话.html + design-ref/liuguang/chat.js. Renders ONLY
   the content to the right of the (studio) ws-rail (the rail, dark flux bg, and
   flux/pages/studio.css all come from the (studio) layout). This page imports
   chat.css itself (the (studio) layout does not).

   Data is REAL and fully authed: chatApi over /api/im/* (see src/lib/chat-api.ts).
   ensureSession() runs before the first request. The conversation list comes
   from chatApi.conversations(); selecting one loads chatApi.messages(). 文本模型
   走 streamMessage（SSE 流式，完成后 reload 落库消息）；图/视频模型先经
   aiApi.generate 跑任务，再 persistTurn 原子入库整轮。「新对话」 creates a
   conversation via createConversation().

   The composer chips (联网 / 模式 / 模型 / 比例 / 分辨率 / 时长 / 批量 / 积分) are
   driven by the selected model's 模型管理 config, and the 比例/分辨率/时长/批量
   selections ARE wired into aiApi.generate (aspectRatio/resolution/duration/
   batchCount). 联网 only renders for a 文本 model whose config.webSearch is enabled.
   ========================================================================== */

import "@/styles/liuguang/chat.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatApi, streamMessage } from "@/lib/chat-api";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { AiTaskStatus } from "@/types/ai";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { resolveModelSwatch } from "@/lib/model-brand";
import { copyText } from "@/lib/clipboard";
import { AssetsBrowser, type PickedAsset } from "@/components/studio/assets-browser";
import {
  MentionPromptEditor,
  buildMentionRefs,
  type MentionEditorHandle,
} from "@/components/studio/mention-prompt-editor";
import { useAuthStore } from "@/stores/use-auth-store";
import { SongCard } from "@/components/studio/audio-player-card";
import { ClipPicker } from "@/components/studio/clip-picker";
import {
  AUDIO_STYLES,
  DEFAULT_MUSIC_PARAMS,
  MUSIC_MODES,
  buildMusicInput,
  clipDisplayLabel,
  fetchClipOptions,
  findClipModel,
  isSfxModel,
  tracksFromMeta,
  validateMusicParams,
  type ClipOption,
  type MusicParams,
} from "@/lib/music-modes";
import type { ContextUsageVO, ConversationVO, MessageVO, MessageTaskVO } from "@/types/chat";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";

/* ── composer chips: model + options come from 模型管理 config (studio-models). ── */

/** config mode value → Chinese label for the 模式 chip. */
const MODE_LABEL: Record<string, string> = {
  t2i: "文生图",
  i2i: "图生图",
  t2v: "文生视频",
  i2v: "图生视频",
  keyframe: "首尾帧",
  omni_ref: "全能参考",
  t2a: "音乐生成",
  sfx: "音效生成",
};

/** config mode value → one-line hint shown in the 模式 dropdown. */
const MODE_HINT: Record<string, string> = {
  t2i: "文字生成图片",
  i2i: "参考图生成图片",
  t2v: "文字生成视频",
  i2v: "参考图生成视频",
  keyframe: "首尾帧生成视频",
  omni_ref: "多参考生成视频",
  t2a: "文字生成音乐",
  sfx: "文字生成音效",
};

/** 音乐创作模式 → 下拉里的一句话说明（与创作台四模式语义一致）。 */
const MUSIC_MODE_HINT: Record<string, string> = {
  inspire: "只写描述，Suno 自动写词",
  custom: "按你填写的歌词演唱",
  extend: "从原曲结尾继续延长",
  cover: "以新的风格翻唱原曲",
};

/** 音乐自定义/延长/翻唱在描述留空时的用户气泡兜底文案。 */
function musicTurnSummary(p: MusicParams): string {
  if (p.musicMode === "custom") {
    const t = p.songTitle.trim() || p.lyrics.trim().split("\n")[0]?.slice(0, 30) || "";
    return t ? `自定义歌词 · ${t}` : "自定义歌词生成";
  }
  return p.musicMode === "extend" ? "延长原曲" : "翻唱原曲";
}

/** swatch 样式+字形：后台配置 icon > 品牌官方 logo（自动匹配）> 首字母渐变。
 *  与创作台共用 model-brand.ts 的 resolveModelSwatch，保证两处选择器不漂移。 */
function swatchOf(m?: {
  name: string;
  modelKey?: string;
  config?: { icon?: string } | null;
}): { style: React.CSSProperties; glyph: string } {
  return resolveModelSwatch({ name: m?.name || "", modelKey: m?.modelKey, icon: m?.config?.icon });
}
function typeTag(type: string): string {
  return type === "video" ? "VID" : type === "audio" ? "AUD" : type === "text" ? "TXT" : "IMG";
}

/* ── reference media (P2: 文件参考) ──────────────────────────────────────────── */

type RefKind = "image" | "video" | "audio";

/** A composer reference: local blob preview while uploading, hosted url after. */
interface RefItem {
  key: string; // stable local key (race-guard + revoke)
  kind: RefKind;
  blobUrl: string; // local object URL for instant preview
  url?: string; // hosted URL after upload (sent to the backend)
  uploading: boolean;
  failed?: boolean;
}

/** A reference policy: which kinds, how many, and (optional) per-file size cap. */
interface RefPolicy {
  kinds: RefKind[];
  max: number;
  /** per-file size limit in MB (0 / undefined = unlimited). */
  maxSizeMB?: number;
}

/** Which reference kinds + how many a given generation mode accepts. Modes not
 *  listed (t2i / t2v) take no reference media. */
const REF_POLICY: Record<string, RefPolicy> = {
  i2i: { kinds: ["image"], max: 6 },
  i2v: { kinds: ["image"], max: 1 },
  keyframe: { kinds: ["image"], max: 2 },
  omni_ref: { kinds: ["image", "video", "audio"], max: 6 },
};

/** Hard cap on attachments per message — mirrors the backend DTO validation. */
const MAX_ATTACHMENTS = 12;

/** Classify a File into a reference kind by MIME type. */
function fileKind(file: File): RefKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

/** The accept attribute for a mode's file picker. */
function acceptFor(kinds: RefKind[]): string {
  return kinds.map((k) => `${k}/*`).join(",");
}

/** an aspect-ratio glyph box for the ratio dropdown lead/item. */
function RatioBox({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return <span className="cm-rt" style={{ width: 16, height: 16 }} />;
  const max = 16;
  const bw = Math.round((w / Math.max(w, h)) * max);
  const bh = Math.round((h / Math.max(w, h)) * max);
  return <span className="cm-rt" style={{ width: bw, height: bh }} />;
}

/** A composer dropdown (`.cm-sel` chip + `.cm-menu` popover) matching the design. */
function CmSelect({
  open,
  onToggle,
  lead,
  label,
  menuH,
  right,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  lead?: React.ReactNode;
  label: React.ReactNode;
  menuH: string;
  right?: boolean;
  children: React.ReactNode;
}) {
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  // Position the menu with fixed coordinates anchored to the chip, so it escapes
  // the horizontally-scrolling chip row's clipping. Recompute on scroll/resize.
  // 视口钳制：上方空间不足时压缩菜单高度（内部可滚动）；左锚菜单不许溢出右缘。
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = chipRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const st: CSSProperties = {
        position: "fixed",
        bottom: window.innerHeight - r.top + 8,
        maxHeight: Math.min(320, Math.max(120, r.top - 16)),
      };
      if (right) st.right = window.innerWidth - r.right;
      else {
        const w = menuRef.current?.offsetWidth ?? 0;
        st.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      }
      setMenuStyle(st);
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, right]);

  return (
    <div className={`cm-sel${open ? " open" : ""}`}>
      <button
        ref={chipRef}
        className="cm-chip"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {lead}
        <span className="cm-lab">{label}</span>
        <span className="cv">▾</span>
      </button>
      <div
        ref={menuRef}
        className={`cm-menu${right ? " right" : ""}`}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cm-menu-h">{menuH}</div>
        {children}
      </div>
    </div>
  );
}

/* ── component ────────────────────────────────────────────────────────────── */

export default function ChatPage() {
  const [convos, setConvos] = useState<ConversationVO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<MessageVO[]>([]);
  const [draft, setDraft] = useState("");
  const [convosLoading, setConvosLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

  // composer chips — driven by the selected model's 模型管理 config
  const [genModels, setGenModels] = useState<StudioModelVO[]>([]);
  const [web, setWeb] = useState(false);
  const [mode, setMode] = useState("");
  const [model, setModel] = useState("");
  const [ratio, setRatio] = useState("");
  const [res, setRes] = useState("");
  const [dur, setDur] = useState("");
  const [batch, setBatch] = useState(1);
  const [openSel, setOpenSel] = useState<string | null>(null);
  // 音乐四创作模式（Suno，仅音频音乐模型时生效）——字段与请求口径对齐创作台。
  const [music, setMusic] = useState<MusicParams>(DEFAULT_MUSIC_PARAMS);
  // 延长/翻唱的原曲候选（用户生成历史里的分轨 clip）；null = 尚未拉取。
  const [clipOpts, setClipOpts] = useState<ClipOption[] | null>(null);
  // 原曲选择弹窗(替代下拉:Suno 同批两首同名,弹窗里能试听/看第 N 首区分)
  const [clipPickOpen, setClipPickOpen] = useState(false);

  // reference media (P2): attached refs + drag state. refsRef mirrors refs for
  // race-guards (upload callbacks) and unmount revoke without stale closures.
  const [refs, setRefs] = useState<RefItem[]>([]);
  const refsRef = useRef<RefItem[]>([]);
  // synchronous count of accepted refs — authoritative across same-tick attaches
  // (refsRef only catches up via an effect). Re-synced from refs on every commit.
  const refCountRef = useRef(0);
  const refSeq = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // reference-source flow: a 来源 menu (本地上传 / 资产库) anchored to the ＋ button,
  // plus the 资产库 picker dialog. Mirrors 创作台 create-studio's source flow.
  const [srcMenuPos, setSrcMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [assetPickOpen, setAssetPickOpen] = useState(false);

  // lightbox (P5): viewed media set + index.
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const openLightbox = useCallback(
    (items: LightboxItem[], index: number) => setLightbox({ items, index }),
    [],
  );
  const stepLightbox = useCallback(
    (delta: number) =>
      setLightbox((lb) =>
        lb ? { ...lb, index: (lb.index + delta + lb.items.length) % lb.items.length } : lb,
      ),
    [],
  );

  // auto-scroll (P5): follow only when the user is near the bottom; otherwise
  // surface a 跳到最新 button instead of yanking them down mid-read.
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // text streaming (P4): the in-progress assistant reply for the active
  // conversation + the abort controller (cancelled on switch / unmount).
  const [streaming, setStreaming] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  // abort a residual stream on unmount (stop burning tokens upstream).
  useEffect(() => {
    return () => chatAbortRef.current?.abort();
  }, []);

  // context-window usage (like GPT/Claude 的会话上限): fetched when a conversation
  // is opened and after each committed turn. ≥80% shows a 开启新会话 warning bar;
  // full blocks text sends (the server enforces the cap too — CONTEXT_LIMIT).
  // Stored keyed by conversation so switching never shows another thread's bar.
  const [ctxUsageFor, setCtxUsageFor] = useState<{ id: string; usage: ContextUsageVO } | null>(null);
  const ctxUsage = ctxUsageFor && ctxUsageFor.id === activeId ? ctxUsageFor.usage : null;
  const refreshCtxUsage = useCallback(async (id: string) => {
    const res = await chatApi.contextUsage(id);
    if (res.success && res.data) setCtxUsageFor({ id, usage: res.data });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState fires after an await (async fetch), not synchronously
    if (activeId) refreshCtxUsage(activeId);
  }, [activeId, refreshCtxUsage]);

  const ensureSession = useAuthStore((s) => s.ensureSession);

  // ── composer config (from 模型管理 via studio-models) ──────────────────────
  const modelNames = useMemo(() => genModels.map((m) => m.name), [genModels]);
  const selModel = useMemo(
    () => genModels.find((m) => m.name === model) ?? null,
    [genModels, model],
  );
  // swatch 按模型名 memo：ChatPage 在流式输出/输入期间每次增量都重渲染，swatchOf
  // 内的 matchBrandIcon 是一组正则，不能每次渲染对每个模型重跑。
  const swatchByName = useMemo(() => {
    const map = new Map<string, ReturnType<typeof swatchOf>>();
    for (const m of genModels) map.set(m.name, swatchOf(m));
    return map;
  }, [genModels]);
  const selSwatch = useMemo(
    () => swatchByName.get(model) ?? swatchOf({ name: model }),
    [swatchByName, model],
  );
  // 生成结果的 AI 头像按任务 modelName 取模型图标；不在列表中的历史模型名
  // 按名称即时解析（品牌 logo 匹配仍然命中）。
  const swatchForName = useCallback(
    (name: string) => swatchByName.get(name) ?? swatchOf({ name }),
    [swatchByName],
  );
  // 当前所选模型的头像（发送占位/流式回复/文字回复的 AI 头像都用它，
  // 让"正在生成"的气泡直接亮出当前模型的图标而不是通用 ✦）。
  const curModelAv = (
    <span className="av av-model" style={selSwatch.style} title={model}>
      {selSwatch.glyph}
    </span>
  );
  // 生成结果的兜底模型名：旧任务没存 modelName 时，回退到该轮用户消息的
  // params.model（persistTurn 的参数快照）。按消息顺序一次扫描建表。
  const fallbackModelByMsg = useMemo(() => {
    const map = new Map<string, string>();
    let lastParamModel = "";
    for (const m of msgs) {
      if (m.role === "user") {
        const pm = m.params && typeof m.params.model === "string" ? (m.params.model as string) : "";
        if (pm) lastParamModel = pm;
      } else if (m.taskId) {
        map.set(m.id, lastParamModel);
      }
    }
    return map;
  }, [msgs]);
  const mCfg = selModel?.config ?? null;
  const isVid = selModel?.type === "video";
  // 联网开关只对「文本模型」且其 config.webSearch 已开启时可用（模型管理里配置）。
  const webSearchAvail = selModel?.type === "text" && !!mCfg?.webSearch;
  const modeVals = mCfg?.modes ?? [];
  const ratioOpts = mCfg?.ratios ?? [];
  const resOpts = mCfg?.resolutions ?? [];
  const durOpts = isVid ? mCfg?.durations ?? [] : [];
  const countOpts = mCfg?.batchOptions?.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMax = Math.max(...countOpts);
  const toggleSel = (k: string) => setOpenSel((cur) => (cur === k ? null : k));

  // reference policy for the current model/mode. For a 文本模型 it is driven by
  // 模型管理 config (fileUpload on → 图片附件，数量 maxFileCount、单文件 maxFileSizeMB)；
  // for image/video models it is the per-mode REF_POLICY (t2i / t2v take none).
  const refPolicy = useMemo<RefPolicy | undefined>(() => {
    if (!selModel) return undefined;
    if (selModel.type === "text") {
      if (!mCfg?.fileUpload) return undefined;
      const cfgMax = mCfg.maxFileCount && mCfg.maxFileCount > 0 ? mCfg.maxFileCount : MAX_ATTACHMENTS;
      return {
        kinds: ["image"],
        max: Math.min(cfgMax, MAX_ATTACHMENTS),
        maxSizeMB: mCfg.maxFileSizeMB ?? 0,
      };
    }
    return REF_POLICY[mode];
  }, [selModel, mode, mCfg]);
  // text-model uploads are OPTIONAL (a chat can be plain text); generation ref
  // modes (i2i/i2v/…) REQUIRE at least one reference before sending.
  const refOptional = selModel?.type === "text";

  // 音频模型分流：音乐（四创作模式）vs 音效（只吃描述），判定与创作台一致
  //（后台「生成方式」勾 sfx，modelKey 含 sfx 兜底）。
  const isAudioSel = selModel?.type === "audio";
  const isMusicSel = isAudioSel && !isSfxModel(selModel?.modelKey, mCfg?.modes ?? undefined);
  const musicMode = music.musicMode;
  // 非灵感模式的音乐生成不强制描述（歌词/原曲才是主输入），发送按钮据此放行。
  const musicNoDraftOk = isMusicSel && musicMode !== "inspire";

  // 每次进入延长/翻唱都重拉原曲候选（新生成的歌完成后，重新切入即可看到）；
  // 已有列表在刷新期间保留展示，仅首次为 null 时显示加载态。
  useEffect(() => {
    if (!isMusicSel || (musicMode !== "extend" && musicMode !== "cover")) return;
    let alive = true;
    fetchClipOptions().then((opts) => {
      if (alive) setClipOpts(opts);
    });
    return () => {
      alive = false;
    };
  }, [isMusicSel, musicMode]);

  // keep refsRef + the synchronous count in sync for stale-closure-free access
  // in callbacks/cleanup (re-syncs the count after adds/removals/dedup drops).
  useEffect(() => {
    refsRef.current = refs;
    refCountRef.current = refs.length;
  }, [refs]);

  // dismiss the 来源 menu / 资产库 dialog if the model stops supporting uploads
  // (switched to a no-upload model while one was open).
  useEffect(() => {
    if (!refPolicy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 关闭浮层是对 refPolicy 消失的收敛动作，一次性且无级联
      setSrcMenuPos(null);
      setAssetPickOpen(false);
    }
  }, [refPolicy]);

  // Escape closes the 来源 menu (parity with the other popovers in this view).
  useEffect(() => {
    if (!srcMenuPos) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setSrcMenuPos(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [srcMenuPos]);

  // revoke every blob preview on unmount (avoid leaking object URLs).
  useEffect(() => {
    return () => {
      for (const r of refsRef.current) URL.revokeObjectURL(r.blobUrl);
    };
  }, []);

  // drop references that the current mode no longer accepts (e.g. switching from
  // an image-ref mode to t2v); revoke their blobs.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 按新策略收敛已挂素材，函数式更新且带 no-op 短路，无级联
    setRefs((prev) => {
      if (!prev.length) return prev;
      const keep = refPolicy ? prev.filter((r) => refPolicy.kinds.includes(r.kind)) : [];
      if (keep.length === prev.length) return prev;
      for (const r of prev) if (!keep.includes(r)) URL.revokeObjectURL(r.blobUrl);
      return keep;
    });
  }, [refPolicy]);

  // upload one reference: hosted URL replaces the blob on success; race-guard
  // drops the result if the ref was removed mid-flight; dedup collapses same-url.
  const uploadRef = useCallback(async (key: string, file: File, blobUrl: string) => {
    const res = await uploadFileSmart(file).catch(() => null);
    setRefs((cur) => {
      const idx = cur.findIndex((r) => r.key === key);
      if (idx < 0) {
        URL.revokeObjectURL(blobUrl); // removed while uploading
        return cur;
      }
      const url = res?.success ? res.data?.fileUrl : undefined;
      if (url && cur.some((r) => r.key !== key && r.url === url)) {
        URL.revokeObjectURL(blobUrl); // same bytes already attached → dedup
        return cur.filter((r) => r.key !== key);
      }
      const next = cur.slice();
      next[idx] = url
        ? { ...next[idx], uploading: false, url }
        : { ...next[idx], uploading: false, failed: true };
      return next;
    });
  }, []);

  // route picked/dropped/pasted files into the current mode's reference slots.
  const attachFiles = useCallback(
    (files: FileList | File[]) => {
      const policy = refPolicy;
      if (!policy) {
        toast.info("当前模式不支持参考素材");
        return;
      }
      const fresh: { item: RefItem; file: File }[] = [];
      // use the synchronous counter (not the effect-lagged refsRef) so two attaches
      // in the same tick can't both read a stale length and exceed policy.max.
      let count = refCountRef.current;
      const sizeCap = policy.maxSizeMB && policy.maxSizeMB > 0 ? policy.maxSizeMB : 0;
      for (const file of Array.from(files)) {
        const kind = fileKind(file);
        if (!policy.kinds.includes(kind)) continue;
        if (count >= policy.max) {
          toast.info(`最多添加 ${policy.max} 个文件`);
          break;
        }
        if (sizeCap && file.size > sizeCap * 1024 * 1024) {
          toast.info(`「${file.name}」超过 ${sizeCap}MB 上限`);
          continue;
        }
        const blobUrl = URL.createObjectURL(file);
        fresh.push({ item: { key: `r${refSeq.current++}`, kind, blobUrl, uploading: true }, file });
        count++;
      }
      if (!fresh.length) return;
      refCountRef.current = count; // commit synchronously before the next call reads it
      setRefs((prev) => [...prev, ...fresh.map((f) => f.item)]);
      for (const { item, file } of fresh) void uploadRef(item.key, file, item.blobUrl);
    },
    [refPolicy, uploadRef],
  );

  const removeRef = useCallback((key: string) => {
    setRefs((prev) => {
      const r = prev.find((x) => x.key === key);
      if (r) URL.revokeObjectURL(r.blobUrl);
      return prev.filter((x) => x.key !== key);
    });
  }, []);

  const clearRefs = useCallback(() => {
    setRefs((prev) => {
      for (const r of prev) URL.revokeObjectURL(r.blobUrl);
      return [];
    });
  }, []);

  // add an already-hosted asset (picked from 资产库) directly as a reference — no
  // upload needed; honors the policy kinds/max and dedups by url.
  const addAssetRef = useCallback(
    (url: string, kind: RefKind) => {
      const policy = refPolicy;
      if (!policy) return;
      if (!policy.kinds.includes(kind)) {
        toast.info("当前模式不支持该类型素材");
        return;
      }
      if (refsRef.current.some((r) => r.url === url)) {
        toast.info("该素材已添加");
        return;
      }
      if (refCountRef.current >= policy.max) {
        toast.info(`最多添加 ${policy.max} 个文件`);
        return;
      }
      refCountRef.current += 1; // commit synchronously before any follow-up add
      setRefs((prev) => [...prev, { key: `r${refSeq.current++}`, kind, blobUrl: "", url, uploading: false }]);
    },
    [refPolicy],
  );

  // open the 来源 menu (本地上传 / 资产库) anchored above the ＋ button. Flips to
  // below if there isn't room above; clamps within the viewport.
  const srcAnchorRef = useRef<DOMRect | null>(null);
  const srcMenuElRef = useRef<HTMLDivElement>(null);
  const openSrcMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!refPolicy) return;
      if (refCountRef.current >= refPolicy.max) {
        toast.info(`最多添加 ${refPolicy.max} 个文件`);
        return;
      }
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      srcAnchorRef.current = r; // 渲染后按菜单实测尺寸重钳制（见下方 layout effect）
      const W = 300;
      const H = 168;
      const gap = 8;
      let x = r.left;
      if (x + W > window.innerWidth - 12) x = Math.max(12, window.innerWidth - 12 - W);
      let y = r.top - H - gap;
      if (y < 12) y = r.bottom + gap; // not enough room above → drop below
      setSrcMenuPos({ x, y });
    },
    [refPolicy],
  );

  // 首次定位用的是估算高度（H=168），实际菜单 ~200px，会盖住 ＋ 按钮/越出视口底；
  // 渲染后按真实尺寸对着锚点矩形重新钳制一次（值不变则不重渲染）。
  useLayoutEffect(() => {
    if (!srcMenuPos) return;
    const el = srcMenuElRef.current;
    const a = srcAnchorRef.current;
    if (!el || !a) return;
    const gap = 8;
    const H = el.offsetHeight;
    const W = el.offsetWidth;
    let x = a.left;
    if (x + W > window.innerWidth - 12) x = Math.max(12, window.innerWidth - 12 - W);
    let y = a.top - H - gap;
    if (y < 12) y = Math.min(a.bottom + gap, window.innerHeight - H - 12); // 翻转后也不许越出底缘
    if (x !== srcMenuPos.x || y !== srcMenuPos.y) setSrcMenuPos({ x, y });
  }, [srcMenuPos]);

  // 本地上传: close the menu and open the OS file picker (onChange → attachFiles).
  const pickLocal = useCallback(() => {
    setSrcMenuPos(null);
    fileInputRef.current?.click();
  }, []);

  // 资产库: close the menu and open the assets picker dialog.
  const openAssets = useCallback(() => {
    setSrcMenuPos(null);
    setAssetPickOpen(true);
  }, []);

  // an asset chosen from 资产库 → add it as a hosted reference. Non-media kinds
  // (文档) are rejected rather than folded into "image" (which would attach a doc
  // URL as a broken image and ship it to the model).
  const chooseAsset = useCallback(
    (a: PickedAsset) => {
      setAssetPickOpen(false);
      if (a.kind !== "image" && a.kind !== "video" && a.kind !== "audio") {
        toast.info("当前模式不支持该类型素材");
        return;
      }
      addAssetRef(a.url, a.kind);
    },
    [addAssetRef],
  );

  // drag-and-drop onto the composer (dragDepth counter avoids overlay flicker
  // from nested dragenter/leave) + paste of files.
  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    },
    [refPolicy],
  );
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (refPolicy) e.preventDefault();
    },
    [refPolicy],
  );
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    },
    [refPolicy],
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!refPolicy) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files?.length) attachFiles(e.dataTransfer.files);
    },
    [refPolicy, attachFiles],
  );
  // load every studio model (text + image + video). Text models drive the chat
  // assistant and may expose the 联网 toggle when their config enables webSearch.
  // Refetch on focus/visibility so 模型管理 edits reflect without a manual refresh.
  const reloadGenModels = useCallback(async () => {
    try {
      const res = await marketApi.studioModels();
      // 顺序由后端决定：类型顺序=后台「模型管理·类型排序」（sys_config
      // market.typeOrder），类型内=行内上移/下移（sort_order）。
      const list = res.success && Array.isArray(res.data) ? res.data : [];
      setGenModels(list);
      if (list.length) {
        setModel((cur) => (list.some((m) => m.name === cur) ? cur : list[0].name));
      }
    } catch {
      setGenModels([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时拉取模型列表，setState 发生在 await 之后
    reloadGenModels();
  }, [reloadGenModels]);

  // 首页模型跑马灯深链：text 模型经 sessionStorage flux_model 交接预选
  // （与创作台同一约定）。列表加载的兜底会保留存在于列表中的选择，所以
  // 这里先行 setModel 是安全的。
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("flux_model");
      if (m) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setModel(m);
        sessionStorage.removeItem("flux_model");
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => reloadGenModels();
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadGenModels();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadGenModels]);

  // close any open composer dropdown on an outside click / Escape.
  useEffect(() => {
    if (!openSel) return;
    const onDoc = () => setOpenSel(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpenSel(null);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSel]);

  // snap chip selections to values the selected model actually supports.
  useEffect(() => {
    if (!mCfg) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换模型后把芯片选择收敛到该模型支持的取值，全部函数式更新
    setMode((m) => (modeVals.length ? (modeVals.includes(m) ? m : modeVals[0]) : ""));
    setRatio((r) => (ratioOpts.length ? (ratioOpts.includes(r) ? r : ratioOpts[0]) : ""));
    setRes((r) => (resOpts.length ? (resOpts.includes(r) ? r : resOpts[0]) : ""));
    setDur((d) => (durOpts.length ? (durOpts.includes(d) ? d : durOpts[0]) : ""));
    setBatch((b) => Math.min(Math.max(1, b), batchMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mCfg, isVid]);

  // 切到不支持联网的模型时，强制关闭联网开关。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 能力开关随模型收敛，一次性复位
    if (!webSearchAvail) setWeb(false);
  }, [webSearchAvail]);

  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<MentionEditorHandle>(null);

  const activeTitle = useMemo(
    () => convos.find((c) => c.id === activeId)?.title ?? "新对话",
    [convos, activeId],
  );

  // keep the thread pinned to the bottom on new content
  const scrollEnd = useCallback(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, []);

  // force a jump to the latest (on send / conversation switch).
  const forceBottom = useCallback(() => {
    nearBottomRef.current = true;
    setShowJump(false);
    requestAnimationFrame(scrollEnd);
  }, [scrollEnd]);

  // track whether the user is reading near the bottom.
  const onThreadScroll = useCallback(() => {
    const t = threadRef.current;
    if (!t) return;
    const near = t.scrollHeight - t.scrollTop - t.clientHeight < 120;
    nearBottomRef.current = near;
    if (near) setShowJump(false);
  }, []);

  // passive content updates (polling/stream) follow only when near the bottom;
  // otherwise reveal the jump button.
  useEffect(() => {
    if (nearBottomRef.current) scrollEnd();
    else setShowJump(true);
  }, [msgs, typing, scrollEnd]);

  // selecting/switching a conversation forces a jump to its latest.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切会话强制回底部（内部复位 showJump），一次性
    forceBottom();
  }, [activeId, forceBottom]);

  // 输入框高度由 contentEditable 自然增长（CSS max-height:180px + overflow-y:auto
  // 封顶），原 textarea 的 autosize/resetTa 不再需要。

  // bumps on every message-load request so a stale response (from a conversation
  // the user already switched away from, or an old poll) is discarded instead of
  // overwriting the current thread.
  const msgsReqRef = useRef(0);

  // load a conversation's message history
  const loadMessages = useCallback(async (id: string) => {
    const myReq = ++msgsReqRef.current;
    setMsgsLoading(true);
    try {
      const res = await chatApi.messages(id, { pageNum: 1, pageSize: 100 });
      if (myReq !== msgsReqRef.current) return; // superseded by a newer load/switch
      if (res.success && res.data) setMsgs(res.data.records);
      else setMsgs([]);
    } finally {
      if (myReq === msgsReqRef.current) setMsgsLoading(false);
    }
  }, []);

  // initial load: session → conversation list → select the first one
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
        const res = await chatApi.conversations({ pageNum: 1, pageSize: 50 });
        if (cancelled) return;
        if (res.success && res.data) {
          setConvos(res.data.records);
          const first = res.data.records[0];
          if (first) {
            setActiveId(first.id);
            await loadMessages(first.id);
          }
        }
      } finally {
        if (!cancelled) setConvosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureSession, loadMessages]);

  // 停掉进行中的文本流：中止请求并撤下流式气泡。切会话 / 新建会话 / 删除当前
  // 会话都必须调——流式气泡渲染在 msgs 之后、不挑会话，漏掉任何一处，幽灵
  // 气泡就会渗进切换后的会话继续打字。
  const stopStream = useCallback(() => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setStreaming(null);
  }, []);

  const pickConvo = useCallback(
    (id: string) => {
      if (id === activeId) return;
      stopStream();
      setActiveId(id);
      setMsgs([]); // clear the old thread so the switch never shows stale messages
      clearRefs();
      loadMessages(id);
    },
    [activeId, loadMessages, clearRefs, stopStream],
  );

  const newChat = useCallback(async () => {
    if (busy) return;
    stopStream();
    setBusy(true);
    try {
      await ensureSession();
      const res = await chatApi.createConversation({});
      if (res.success && res.data) {
        setConvos((prev) => [res.data, ...prev]);
        setActiveId(res.data.id);
        setMsgs([]);
        setDraft("");
        clearRefs();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, ensureSession, clearRefs, stopStream]);

  // conversation rename / delete (P5)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const startRename = useCallback((c: ConversationVO) => {
    setRenamingId(c.id);
    setRenameVal(c.title || "");
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    if (!id) return;
    setRenamingId(null);
    const title = renameVal.trim();
    const cur = convos.find((c) => c.id === id);
    if (!cur || !title || title === cur.title) return;
    setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c))); // optimistic
    const res = await chatApi.renameConversation(id, title);
    if (!res.success) {
      setConvos((prev) => prev.map((c) => (c.id === id ? { ...c, title: cur.title } : c))); // revert
      toast.error(res.message || "重命名失败");
    }
  }, [renamingId, renameVal, convos]);

  const removeConvo = useCallback(
    async (c: ConversationVO) => {
      if (
        !(await confirmDialog({
          title: "删除对话",
          message: `删除对话「${c.title || "未命名对话"}」？此操作不可撤销。`,
          confirmText: "删除",
        }))
      )
        return;
      const res = await chatApi.deleteConversation(c.id);
      if (!res.success) {
        toast.error(res.message || "删除失败");
        return;
      }
      const remaining = convos.filter((x) => x.id !== c.id);
      setConvos(remaining);
      if (activeId === c.id) {
        // 删除的是当前会话：先停掉进行中的流（删除按钮没有 busy 守卫，流式
        // 期间可点），否则幽灵流式气泡会渗进切换后的会话继续打字。
        stopStream();
        if (remaining[0]) {
          setActiveId(remaining[0].id);
          loadMessages(remaining[0].id);
        } else {
          setActiveId(null);
          setMsgs([]);
        }
      }
    },
    [convos, activeId, loadMessages, stopStream],
  );

  const send = useCallback(async () => {
    const v = draft.trim();
    if (busy) return;
    // 音乐的自定义/延长/翻唱不强制描述；其余（含灵感模式/音效）仍需文字。
    if (!v && !musicNoDraftOk) return;
    if (isMusicSel) {
      const musicErr = validateMusicParams(v, music);
      if (musicErr) {
        toast.info(musicErr);
        return;
      }
    }

    // text-model sends are blocked once the conversation's context is full
    // (the server enforces the same cap; this just fails fast with guidance).
    if (selModel?.type === "text" && ctxUsage?.full) {
      toast.error("当前会话上下文已达上限，请开启新会话");
      return;
    }

    // reference media (uploaded → hosted urls). A ref-mode requires at least one
    // usable ref and blocks while any is still uploading.
    const refImageUrls = refs.filter((r) => r.kind === "image" && r.url).map((r) => r.url as string);
    const refVideoUrls = refs.filter((r) => r.kind === "video" && r.url).map((r) => r.url as string);
    const refAudioUrls = refs.filter((r) => r.kind === "audio" && r.url).map((r) => r.url as string);
    if (refPolicy) {
      if (refs.some((r) => r.uploading)) {
        toast.info("文件上传中，请稍候");
        return;
      }
      // block on a failed upload so the user doesn't unknowingly send without it.
      if (refs.some((r) => r.failed)) {
        toast.error("有文件上传失败，请移除后重试");
        return;
      }
      // text-model uploads are optional; generation ref-modes require one.
      // omni_ref 的策略允许纯音频参考（音频驱动的视频生成），音频也算数——
      // 否则界面明示「音频已添加、可 @ 引用」，发送却被拦，自相矛盾。
      if (
        !refOptional &&
        refImageUrls.length === 0 &&
        refVideoUrls.length === 0 &&
        refAudioUrls.length === 0
      ) {
        toast.error("当前模式需要先添加参考素材");
        return;
      }
    }

    setBusy(true);
    setDraft("");
    await ensureSession();

    // ensure there is a conversation to send into
    let id = activeId;
    if (!id) {
      const created = await chatApi.createConversation({});
      if (created.success && created.data) {
        id = created.data.id;
        setConvos((prev) => [created.data, ...prev]);
        setActiveId(id);
      } else {
        setBusy(false);
        return;
      }
    }

    // attachments snapshot — TEXT models only. Generation turns persist their
    // references via persistTurn (params.references), so attaching here would make
    // the optimistic bubble flash thumbnails that vanish on reload.
    const attachSnapshot = refOptional
      ? refImageUrls.map((url) => ({ url, kind: "image" as const }))
      : [];

    // 用户气泡/落库的提示词：音乐模式描述可留空，兜底一句模式摘要（persistTurn
    // 的 prompt 为必填，气泡也不能是空白）。
    const sendText = v || (isMusicSel ? musicTurnSummary(music) : "");

    // optimistic user bubble
    const optimistic: MessageVO = {
      id: `tmp-${Date.now()}`,
      conversationId: id,
      role: "user",
      contentType: "text",
      content: sendText,
      createTime: new Date().toISOString(),
      ...(attachSnapshot.length ? { params: { attachments: attachSnapshot } } : {}),
    };
    setMsgs((prev) => [...prev, optimistic]);
    setTyping(true);
    forceBottom();

    const bump = (cid: string) =>
      setConvos((prev) => {
        const idx = prev.findIndex((c) => c.id === cid);
        if (idx <= 0) return prev;
        const copy = prev.slice();
        const [c] = copy.splice(idx, 1);
        copy.unshift(c);
        return copy;
      });

    // 选图片/视频/音频模型 → 真实生成（一个 turn，助手消息只指向 task）；文本模型 → 文字对话。
    const wantImage = selModel?.type === "image";
    const wantVideo = selModel?.type === "video";
    const wantAudio = selModel?.type === "audio";

    try {
      if ((wantImage || wantVideo || wantAudio) && selModel) {
        // 先 submit（计费/配额走既有生成管线）；被拒时尚未持久化任何东西，无孤儿可清。
        // 音频：音乐按四创作模式组装（与创作台同构），音效只发描述。
        const input: Record<string, unknown> = wantAudio
          ? isMusicSel
            ? buildMusicInput(v, music)
            : { prompt: v }
          : {
              prompt: v,
              ...(ratio ? { aspectRatio: ratio, aspect_ratio: ratio, ratio } : {}),
              ...(res ? { resolution: res } : {}),
              ...(wantVideo && dur ? { duration: dur } : {}),
            };
        // pick the handler by mode + attached references (P2).
        let handler: string;
        if (wantAudio) {
          handler = "text_to_audio";
        } else if (wantVideo) {
          if (mode === "i2v" && refImageUrls.length) {
            handler = "image_to_video";
            input.sourceImage = refImageUrls[0];
            input.imageList = refImageUrls.slice(0, 1);
          } else if (mode === "keyframe" && refImageUrls.length) {
            handler = "start_end_to_video";
            input.firstFrame = refImageUrls[0];
            input.lastFrame = refImageUrls[1] ?? refImageUrls[0];
          } else if (
            mode === "omni_ref" &&
            (refImageUrls.length || refVideoUrls.length || refAudioUrls.length)
          ) {
            // 纯音频参考也走 reference_to_video（与创作台「全能参考」行为一致）
            handler = "reference_to_video";
            input.references = refImageUrls;
            if (refVideoUrls.length) input.videoReferences = refVideoUrls;
            if (refAudioUrls.length) input.audioReferences = refAudioUrls;
          } else {
            handler = "text_to_video";
          }
        } else if (mode === "i2i" && refImageUrls.length) {
          handler = "image_to_image";
          input.imageList = refImageUrls;
        } else {
          handler = "text_to_image";
        }
        // image handlers loop on batchCount → request N images when 批量 > 1 (not video).
        if (wantImage && batch > 1) input.batchCount = batch;
        const gen = await aiApi.generate({
          handler,
          modelId: selModel.modelKey || selModel.id,
          input,
        });
        if (!gen.success) {
          setMsgs((prev) => prev.filter((m) => m.id !== optimistic.id)); // roll back optimistic
          toast.error(gen.message || "生成请求失败");
          return;
        }
        // 成功 → 原子持久化整个 turn（用户提示词+参数快照 / 助手 taskId）。
        const params: Record<string, unknown> = {
          model: selModel.name,
          modelKey: selModel.modelKey,
          type: selModel.type,
          ...(mode ? { mode } : {}),
          ...(ratio ? { ratio } : {}),
          ...(res ? { resolution: res } : {}),
          ...(wantVideo && dur ? { duration: dur } : {}),
          ...(wantImage && batch > 1 ? { batch } : {}),
          // 音乐参数快照：重新编辑/再次生成时恢复四模式字段。
          ...(wantAudio && isMusicSel ? { music: { ...music } } : {}),
          ...(refImageUrls.length || refVideoUrls.length || refAudioUrls.length
            ? {
                references: [
                  ...refImageUrls.map((url) => ({ url, kind: "image" })),
                  ...refVideoUrls.map((url) => ({ url, kind: "video" })),
                  // 音频引用也要入快照：漏掉的话「重新编辑/再次生成」恢复不出
                  // 音频素材，prompt 里的「音频N」token 变成悬空引用
                  ...refAudioUrls.map((url) => ({ url, kind: "audio" })),
                ],
              }
            : {}),
        };
        await chatApi.persistTurn(id, {
          prompt: sendText,
          params,
          taskId: gen.data.id,
          contentType: wantVideo ? "video" : wantAudio ? "audio" : "image",
        });
        clearRefs(); // turn committed → clear the composer references
        // only reload into the view if still on this conversation; otherwise the
        // turn is already persisted and will show when the user switches back.
        if (activeIdRef.current === id) await loadMessages(id);
        bump(id); // surface the conversation to the top regardless of focus
        refreshCtxUsage(id); // generation prompts count toward the context cap too
      } else {
        // text model → streamed reply (P4). The generic typing dots give way to
        // a live streaming bubble; switching conversation aborts it.
        setTyping(false);
        setStreaming("");
        const ac = new AbortController();
        chatAbortRef.current = ac;
        let acc = "";
        let streamOk = true;
        await streamMessage(id, v, {
          signal: ac.signal,
          attachments: attachSnapshot,
          onDelta: (d) => {
            acc += d;
            setStreaming(acc);
            // coalesce rapid tokens into one scroll per frame to avoid judder.
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onError: (m, code) => {
            streamOk = false;
            toast.error(m || "生成失败");
            // context cap reached server-side → refresh so the 开启新会话 bar shows.
            if (code === "CONTEXT_LIMIT") refreshCtxUsage(id);
          },
        });
        // clear the attachment strip only on success — keep it on failure so the
        // user can resend without re-picking the files.
        if (streamOk) clearRefs();
        // only clear OUR controller — a newer stream may have replaced it.
        if (chatAbortRef.current === ac) chatAbortRef.current = null;
        setStreaming(null);
        // only refresh if the user is still on this conversation (not switched away).
        if (activeIdRef.current === id) {
          await loadMessages(id);
          bump(id);
        }
        if (streamOk) refreshCtxUsage(id);
        // On stream failure, restore the typed text to the composer. The draft was
        // cleared up-front and loadMessages above dropped the optimistic bubble; on a
        // network failure nothing was persisted, so without this the message is lost
        // with no way to resend. Don't clobber newer text the user already typed.
        if (!streamOk) {
          setDraft((cur) => (cur ? cur : v));
        }
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, activeId, ensureSession, loadMessages, selModel, mode, ratio, res, dur, batch, refs, refPolicy, refOptional, clearRefs, forceBottom, scrollEnd, ctxUsage, refreshCtxUsage, music, isMusicSel, musicNoDraftOk]);

  // restore a turn's snapshot params into the composer (重新编辑 / 再次生成).
  const restoreFromParams = useCallback(
    (p?: Record<string, unknown>) => {
      if (!p) return;
      if (typeof p.model === "string") setModel(p.model);
      if (typeof p.mode === "string") setMode(p.mode);
      if (typeof p.ratio === "string") setRatio(p.ratio);
      if (typeof p.resolution === "string") setRes(p.resolution);
      if (typeof p.duration === "string") setDur(p.duration);
      if (typeof p.batch === "number") setBatch(p.batch);
      // 音乐参数：有快照按快照恢复，没有则回到默认（避免把上一轮的歌词/原曲
      // 带进一个非音乐 turn 的重新编辑）。
      setMusic(
        p.music && typeof p.music === "object"
          ? { ...DEFAULT_MUSIC_PARAMS, ...(p.music as Partial<MusicParams>) }
          : DEFAULT_MUSIC_PARAMS,
      );
      // restore reference media as url-only items (the originals are hosted; no
      // local blob/file is recreated). Lets 再次生成 work on a reference turn.
      clearRefs();
      if (Array.isArray(p.references)) {
        const restored: RefItem[] = [];
        for (const r of p.references) {
          const url = r && typeof r === "object" ? (r as { url?: unknown }).url : undefined;
          if (typeof url !== "string" || !url) continue;
          const k = (r as { kind?: unknown }).kind;
          const kind: RefKind = k === "video" ? "video" : k === "audio" ? "audio" : "image";
          restored.push({ key: `r${refSeq.current++}`, kind, blobUrl: "", url, uploading: false });
        }
        if (restored.length) setRefs(restored);
      }
    },
    [clearRefs],
  );

  // find the user (prompt) message of the turn an assistant result belongs to.
  const turnUserOf = useCallback(
    (aiMsg: MessageVO): MessageVO | null => {
      const idx = msgs.findIndex((m) => m.id === aiMsg.id);
      for (let i = idx - 1; i >= 0; i--) if (msgs[i].role === "user") return msgs[i];
      return null;
    },
    [msgs],
  );

  const reEdit = useCallback(
    (aiMsg: MessageVO) => {
      const u = turnUserOf(aiMsg);
      if (!u) return;
      restoreFromParams(u.params);
      setDraft(u.content);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [turnUserOf, restoreFromParams],
  );

  const [pendingSend, setPendingSend] = useState(false);
  const regenerate = useCallback(
    (aiMsg: MessageVO) => {
      if (busy) return;
      const u = turnUserOf(aiMsg);
      if (!u) return;
      // 快照里的模型已下架时不能自动发送：selModel 会解析为 null，send() 将
      // 静默降级成文本对话（图片提示词喂给文本模型，还白吃上下文）。回填
      // 参数与提示词让用户改选模型后手动发送。
      const pm = u.params && typeof u.params.model === "string" ? (u.params.model as string) : "";
      const modelGone = !!pm && !genModels.some((m) => m.name === pm);
      restoreFromParams(u.params);
      setDraft(u.content);
      if (modelGone) {
        toast.info(`模型「${pm}」已下架，请重新选择模型后发送`);
        requestAnimationFrame(() => taRef.current?.focus());
        return;
      }
      setPendingSend(true);
    },
    [busy, turnUserOf, restoreFromParams, genModels],
  );
  // fire send() once the restored params/draft have committed.
  useEffect(() => {
    if (!pendingSend) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性触发闩：复位后立即发送，不产生级联
    setPendingSend(false);
    send();
  }, [pendingSend, send]);

  // 轮询：当前对话有任务在进行(status processing) → 每 1.5s 刷新消息（task 为真相，
  // 状态/结果由后端 join 回来）；页面不可见时跳过；送出中暂停，避免覆盖乐观气泡。
  const hasInflight = useMemo(
    () => msgs.some((m) => m.task && m.task.status === AiTaskStatus.PROCESSING),
    [msgs],
  );
  useEffect(() => {
    if (!hasInflight || !activeId || busy) return;
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") loadMessages(activeId);
    }, 1500);
    return () => clearInterval(iv);
  }, [hasInflight, activeId, busy, loadMessages]);

  // ── @ 引用（富文本 pill 版，与创作台共用 MentionPromptEditor）────────────────
  // 输入 @ 弹出已挂参考素材的候选菜单，选中在光标处插入带缩略图的内联 pill，
  // 序列化为「图片N/视频N/音频N」——N 按 kind 编号，与 send() 组装
  // imageList / videoReferences / audioReferences 的顺序严格一致。
  // 编号必须覆盖「全部」已挂素材（含上传中的）再过滤出可选项：若只给传完的
  // 编号，先传完的那张会被编成图片1，等前面的传完后整体位移，已插入正文的
  // pill 会静默换绑到另一张图。send() 发送时按 refs 全序组装，编号天然对齐。
  const mentionRefs = useMemo(
    () =>
      refPolicy
        ? buildMentionRefs(
            refs.map((r) => ({ key: r.key, kind: r.kind, thumb: r.url || r.blobUrl })),
          ).filter((_, i) => !!refs[i].url)
        : [],
    [refPolicy, refs],
  );


  // approx points cost: the selected model's 消耗积分 × batch.
  // 音频按次计费（Suno 一次两首一并结算），不乘数量。
  const points = useMemo(() => {
    const base = parseFloat(selModel?.pointCost ?? "0") || 0;
    return Math.round(base * (selModel?.type === "audio" ? 1 : Math.max(1, batch)));
  }, [selModel, batch]);

  return (
    <div className="chat-wrap">
      {/* conversation list */}
      <aside className="chat-list">
        <div className="chat-list-top">
          <button className="chat-new" onClick={newChat} disabled={busy}>
            <span>＋</span> 新对话
          </button>
        </div>
        <div className="chat-convos">
          <div className="chat-ch">最近对话</div>
          {convosLoading ? (
            <div className="convo">
              <span className="t" style={{ color: "var(--text-faint)" }}>
                加载中…
              </span>
            </div>
          ) : convos.length === 0 ? (
            <div className="convo">
              <span className="t" style={{ color: "var(--text-faint)" }}>
                还没有对话，点击「新对话」开始
              </span>
            </div>
          ) : (
            convos.map((c) =>
              renamingId === c.id ? (
                <div key={c.id} className="convo on">
                  <input
                    className="convo-rename"
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                    onBlur={commitRename}
                  />
                </div>
              ) : (
                <div key={c.id} className={`convo ${c.id === activeId ? "on" : ""}`}>
                  <button className="convo-main" type="button" onClick={() => pickConvo(c.id)}>
                    <svg viewBox="0 0 24 24">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="t">{c.title || "未命名对话"}</span>
                  </button>
                  <button
                    className="convo-act"
                    type="button"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(c);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="convo-act"
                    type="button"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeConvo(c);
                    }}
                  >
                    🗑
                  </button>
                </div>
              ),
            )
          )}
        </div>
      </aside>

      {/* chat main */}
      <main className="chat-main">
        <div className="chat-top">
          <span className="ti">{activeTitle}</span>
        </div>

        <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
          <div className="chat-inner">
            {msgsLoading && msgs.length === 0 ? (
              <div className="msg ai">
                {curModelAv}
                <div className="bubble">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            ) : !msgsLoading && msgs.length === 0 ? (
              <div className="msg ai">
                {curModelAv}
                <div className="bubble">
                  <div>
                    你好！我是你的 流光 创作助手。告诉我你想创作的内容 ——
                    图片、视频、剧本或灵感，我来帮你一步步完成。
                  </div>
                </div>
              </div>
            ) : (
              msgs.map((m) => (
                <Bubble
                  key={m.id}
                  msg={m}
                  onReEdit={reEdit}
                  onRegenerate={regenerate}
                  onOpenLightbox={openLightbox}
                  swatchFor={swatchForName}
                  fallbackModel={fallbackModelByMsg.get(m.id) || model}
                />
              ))
            )}
            {streaming !== null && (
              <div className="msg ai">
                {curModelAv}
                <div className="bubble">
                  {streaming === "" ? (
                    <span className="chat-gen-state">
                      <span className="typing">
                        <i />
                        <i />
                        <i />
                      </span>
                      思考中…
                    </span>
                  ) : (
                    <div className="md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                      <span className="stream-caret" />
                    </div>
                  )}
                </div>
              </div>
            )}
            {typing && (
              <div className="msg ai">
                {curModelAv}
                <div className="bubble">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}
          </div>
          {showJump && (
            <button className="chat-jump" type="button" onClick={forceBottom}>
              ↓ 跳到最新
            </button>
          )}
        </div>

        <div className="chat-composer">
          {/* 已压缩且余量健康时给个安静的说明；仍逼近上限（压缩后依旧 ≥80%）
              则继续走下方的警示条 */}
          {selModel?.type === "text" && ctxUsage?.compressed && ctxUsage.percent < 80 && (
            <div className="chat-ctx-note">较早的对话已自动压缩为摘要，模型仍保有前文关键信息</div>
          )}
          {selModel?.type === "text" && ctxUsage && ctxUsage.percent >= 80 && (
            <div className={`chat-ctx-warn${ctxUsage.full ? " full" : ""}`}>
              <span>
                {ctxUsage.full
                  ? "本会话上下文已达上限（自动压缩后仍不足），请开启新会话"
                  : `本会话上下文已使用 ${ctxUsage.percent}%，接近阈值时会自动压缩较早对话`}
              </span>
              <button type="button" onClick={newChat} disabled={busy}>
                开启新会话
              </button>
            </div>
          )}
          <div
            className={`composer-box${dragOver ? " drag" : ""}`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {dragOver && <div className="composer-drop">松开以添加参考素材</div>}
            {refs.length > 0 && (
              <div className="ref-strip">
                {refs.map((r) => (
                  <RefThumb key={r.key} item={r} onRemove={() => removeRef(r.key)} />
                ))}
              </div>
            )}
            <div className="composer-head">
              {refPolicy && (
                <button
                  className="cm-upload"
                  title="添加参考素材（本地上传 / 资产库）"
                  type="button"
                  onClick={openSrcMenu}
                >
                  {/* SVG 加号：全角＋字形字面不居中，在圆钮里会偏位 */}
                  <svg viewBox="0 0 24 24" aria-hidden style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" }}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={refPolicy ? acceptFor(refPolicy.kinds) : undefined}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) attachFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <MentionPromptEditor
                ref={taRef}
                className="composer-input"
                value={draft}
                onChange={setDraft}
                refs={mentionRefs}
                onSubmit={send}
                onPasteFiles={refPolicy ? attachFiles : undefined}
                placeholder={
                  isMusicSel && musicMode === "custom"
                    ? "给这一轮写句备注（仅作记录，不参与生成）· 歌词请在下方填写"
                    : isMusicSel && musicMode !== "inspire"
                      ? "给这一轮写句备注（仅作记录，不参与生成）· 原曲在下方选择"
                      : isAudioSel
                        ? "描述你想生成的音乐或音效，Suno 自动作曲填词…"
                        : "描述你想生成的内容，或上传参考素材让模型自由发挥…  @ 引用参考素材"
                }
              />
            </div>

            {/* 音乐四模式的参数区（自定义歌词/延长/翻唱时展开；灵感模式无额外字段） */}
            {isMusicSel && musicMode !== "inspire" && (
              <div className="cm-music">
                {(musicMode === "extend" || musicMode === "cover") && (
                  <div className="cm-music-row">
                    <span className="cm-music-lab">原曲</span>
                    <button
                      type="button"
                      className="cm-music-sel flex items-center gap-1.5 text-left"
                      title="上游仅支持续写/翻唱本站生成的音乐，暂不支持上传本地音频"
                      onClick={() => setClipPickOpen(true)}
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        style={music.sourceClipId ? undefined : { color: "var(--text-faint)" }}
                      >
                        {clipDisplayLabel(clipOpts, music.sourceClipId)}
                      </span>
                      <span aria-hidden style={{ color: "var(--text-faint)", fontSize: 10 }}>▾</span>
                    </button>
                    <ClipPicker
                      open={clipPickOpen}
                      options={clipOpts}
                      current={music.sourceClipId}
                      onClose={() => setClipPickOpen(false)}
                      onPick={(opt) => {
                        setMusic((m) => ({ ...m, sourceClipId: opt.clipId }));
                        setClipPickOpen(false);
                        // 上游把延长/翻唱任务钉到原曲的模型路由,选定原曲后自动切回原曲那张模型卡
                        const src = findClipModel(genModels, opt);
                        if (src && src.name !== model) {
                          setModel(src.name);
                          toast.info(`已切换到原曲模型「${src.name}」`);
                        } else if (!src && (opt.modelId || opt.modelName)) {
                          toast.info("原曲所用模型已下架，续写/翻唱可能失败");
                        }
                      }}
                    />
                    {musicMode === "extend" && (
                      <input
                        className="cm-music-in num"
                        inputMode="numeric"
                        placeholder="延长起点 · 秒 · 选填"
                        value={music.continueAt}
                        onChange={(e) => setMusic((m) => ({ ...m, continueAt: e.target.value }))}
                      />
                    )}
                  </div>
                )}
                <textarea
                  className="cm-music-ta"
                  value={music.lyrics}
                  onChange={(e) => setMusic((m) => ({ ...m, lyrics: e.target.value }))}
                  placeholder={
                    musicMode === "custom"
                      ? "歌词 · 必填 · Suno 按歌词演唱，支持段落标记\n[Verse]\n阳光洒在肩上\n[Chorus]\n这就是青春的模样"
                      : musicMode === "extend"
                        ? "续写歌词 · 选填 · 留空则由 Suno 续写"
                        : "改编提示 / 歌词 · 选填 · 留空则保留原词"
                  }
                />
                <div className="cm-music-row wrap">
                  {AUDIO_STYLES.map((s) => {
                    const on = music.songStyles.includes(s.v);
                    return (
                      <button
                        key={s.v}
                        type="button"
                        className={`cm-tag${on ? " on" : ""}`}
                        onClick={() =>
                          setMusic((m) => ({
                            ...m,
                            songStyles: on
                              ? m.songStyles.filter((x) => x !== s.v)
                              : [...m.songStyles, s.v],
                          }))
                        }
                      >
                        {s.l}
                      </button>
                    );
                  })}
                  <input
                    className="cm-music-in title"
                    type="text"
                    value={music.songTitle}
                    onChange={(e) => setMusic((m) => ({ ...m, songTitle: e.target.value }))}
                    placeholder="歌名 · 选填"
                  />
                </div>
              </div>
            )}
            <div className="composer-bar">
              <div className="cm-row">
              {webSearchAvail && (
                <button
                  className={`cm-chip ${web ? "on" : ""}`}
                  type="button"
                  onClick={() => setWeb((w) => !w)}
                >
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
                  </svg>
                  联网
                </button>
              )}
              {modelNames.length > 0 && (
                <CmSelect
                  open={openSel === "model"}
                  onToggle={() => toggleSel("model")}
                  menuH="选择模型"
                  lead={
                    <span className="cm-sw sm" style={selSwatch.style}>
                      {selSwatch.glyph}
                    </span>
                  }
                  label={model || "选择模型"}
                >
                  {genModels.map((m) => {
                    const est = m.config?.estSeconds ?? 0;
                    const cost = parseFloat(m.pointCost) || 0;
                    const tag = est > 0 ? `~${est}s` : cost > 0 ? `${cost}积分` : typeTag(m.type);
                    const desc =
                      m.desc || (m.config?.capabilities?.length ? m.config.capabilities.join(" · ") : "高质量生成");
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className={`cm-mitem${m.name === model ? " on" : ""}`}
                        onClick={() => {
                          setModel(m.name);
                          setOpenSel(null);
                        }}
                      >
                        {(() => {
                          const sw = swatchByName.get(m.name) ?? swatchOf(m);
                          return (
                            <span className="cm-sw" style={sw.style}>
                              {sw.glyph}
                            </span>
                          );
                        })()}
                        <span className="nfo">
                          <span className="nm">
                            <span className="nm-t">{m.name}</span>
                            <i>{tag}</i>
                          </span>
                          <span className="ds">{desc}</span>
                        </span>
                        <span className="ck">✓</span>
                      </button>
                    );
                  })}
                </CmSelect>
              )}

              {modeVals.length > 0 && (
                <CmSelect
                  open={openSel === "mode"}
                  onToggle={() => toggleSel("mode")}
                  menuH="生成方式"
                  lead={<span className="cm-ico lead">{isVid ? "▶" : "▦"}</span>}
                  label={MODE_LABEL[mode] ?? mode}
                >
                  {modeVals.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`cm-mitem${v === mode ? " on" : ""}`}
                      onClick={() => {
                        setMode(v);
                        setOpenSel(null);
                      }}
                    >
                      <span className="cm-ico">{isVid ? "▶" : "▦"}</span>
                      <span className="nfo">
                        <span className="nm">{MODE_LABEL[v] ?? v}</span>
                        <span className="ds">{MODE_HINT[v] ?? ""}</span>
                      </span>
                      <span className="ck">✓</span>
                    </button>
                  ))}
                </CmSelect>
              )}

              {/* 音乐创作模式（对齐创作台：灵感 / 自定义歌词 / 延长 / 翻唱） */}
              {isMusicSel && (
                <CmSelect
                  open={openSel === "musicMode"}
                  onToggle={() => toggleSel("musicMode")}
                  menuH="创作模式"
                  lead={<span className="cm-ico lead">♪</span>}
                  label={MUSIC_MODES.find((o) => o.v === musicMode)?.l ?? "灵感模式"}
                >
                  {MUSIC_MODES.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={`cm-mitem${o.v === musicMode ? " on" : ""}`}
                      onClick={() => {
                        setMusic((m) => ({ ...m, musicMode: o.v }));
                        setOpenSel(null);
                      }}
                    >
                      <span className="cm-ico">♪</span>
                      <span className="nfo">
                        <span className="nm">{o.l}</span>
                        <span className="ds">{MUSIC_MODE_HINT[o.v] ?? ""}</span>
                      </span>
                      <span className="ck">✓</span>
                    </button>
                  ))}
                </CmSelect>
              )}

              {/* 人声/纯音乐开关（上游 make_instrumental，各创作模式通吃） */}
              {isMusicSel && (
                <button
                  className={`cm-chip ${music.instrumental ? "on" : ""}`}
                  type="button"
                  title={music.instrumental ? "当前生成纯音乐（无人声）" : "当前生成带人声演唱"}
                  onClick={() => setMusic((m) => ({ ...m, instrumental: !m.instrumental }))}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M9 18V6l10-2v12" />
                    <circle cx="6.5" cy="18" r="2.5" />
                    <circle cx="16.5" cy="16" r="2.5" />
                  </svg>
                  纯音乐
                </button>
              )}

              {ratioOpts.length > 0 && (
                <CmSelect
                  open={openSel === "ratio"}
                  onToggle={() => toggleSel("ratio")}
                  menuH="画面比例"
                  lead={<RatioBox ratio={ratio} />}
                  label={ratio}
                >
                  {ratioOpts.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`cm-mitem${r === ratio ? " on" : ""}`}
                      onClick={() => {
                        setRatio(r);
                        setOpenSel(null);
                      }}
                    >
                      <RatioBox ratio={r} />
                      <span className="nfo">
                        <span className="nm">{r}</span>
                      </span>
                      <span className="ck">✓</span>
                    </button>
                  ))}
                </CmSelect>
              )}

              {resOpts.length > 0 && (
                <CmSelect
                  open={openSel === "res"}
                  onToggle={() => toggleSel("res")}
                  menuH="分辨率"
                  label={res.toUpperCase()}
                >
                  {resOpts.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`cm-mitem${r === res ? " on" : ""}`}
                      onClick={() => {
                        setRes(r);
                        setOpenSel(null);
                      }}
                    >
                      <span className="nfo">
                        <span className="nm">{r.toUpperCase()}</span>
                      </span>
                      <span className="ck">✓</span>
                    </button>
                  ))}
                </CmSelect>
              )}

              {durOpts.length > 0 && (
                <CmSelect
                  open={openSel === "dur"}
                  onToggle={() => toggleSel("dur")}
                  menuH="时长"
                  label={dur}
                >
                  {durOpts.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`cm-mitem${d === dur ? " on" : ""}`}
                      onClick={() => {
                        setDur(d);
                        setOpenSel(null);
                      }}
                    >
                      <span className="nfo">
                        <span className="nm">{d}</span>
                      </span>
                      <span className="ck">✓</span>
                    </button>
                  ))}
                </CmSelect>
              )}

              {/* 音频一次生成即整曲（Suno 两首一并返回），数量选择不适用 */}
              {!isAudioSel && (
              <CmSelect
                open={openSel === "count"}
                onToggle={() => toggleSel("count")}
                menuH="生成数量"
                right
                label={`⚲ ${batch}`}
              >
                {countOpts.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`cm-mitem${c === batch ? " on" : ""}`}
                    onClick={() => {
                      setBatch(c);
                      setOpenSel(null);
                    }}
                  >
                    <span className="cm-ico">⚲</span>
                    <span className="nfo">
                      <span className="nm">
                        {c} {isVid ? "段" : "张"}
                      </span>
                    </span>
                    <span className="ck">✓</span>
                  </button>
                ))}
              </CmSelect>
              )}
              </div>
              <span className="cm-pts">约 {points} 积分</span>
              <button
                className="cm-send"
                aria-label="发送"
                type="button"
                onClick={send}
                disabled={
                  busy ||
                  (!draft.trim() && !musicNoDraftOk) ||
                  (selModel?.type === "text" && !!ctxUsage?.full)
                }
              >
                ↑
              </button>
            </div>
          </div>
          <div className="chat-hint">Enter 发送 · Shift+Enter 换行 · 可拖拽 / 粘贴添加参考</div>
        </div>
      </main>

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onStep={stepLightbox}
        />
      )}

      {/* 参考素材来源选择：本地上传 / 资产库（复用 创作台 的来源菜单） */}
      {srcMenuPos && refPolicy && (
        <>
          <div className="ws-srcpop-catch" onClick={() => setSrcMenuPos(null)} />
          <div
            ref={srcMenuElRef}
            className="ws-srcmenu ws-srcmenu-pop"
            style={{ left: srcMenuPos.x, top: srcMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ws-srcmenu-h">选择素材来源</div>
            <button type="button" className="ws-srcopt" onClick={pickLocal}>
              <span className="ic">⤓</span>
              <span className="tx">
                <b>本地上传</b>
                <i>从你的电脑选择文件</i>
              </span>
            </button>
            <button type="button" className="ws-srcopt" onClick={openAssets}>
              <span className="ic">▦</span>
              <span className="tx">
                <b>从资产库选取</b>
                <i>选择已上传 / 已生成的素材</i>
              </span>
            </button>
          </div>
        </>
      )}

      {/* 资产库弹窗：复用整个资产页 UI 作为选择器 */}
      {assetPickOpen && (
        <div className="ws-srcmask" onClick={() => setAssetPickOpen(false)}>
          <div className="ws-assetbox" onClick={(e) => e.stopPropagation()}>
            <div className="ws-assetbox-h">
              <span>从资产库选取</span>
              <button type="button" aria-label="关闭" onClick={() => setAssetPickOpen(false)}>
                ✕
              </button>
            </div>
            <div className="ws-assetbox-body">
              <AssetsBrowser
                pickMode
                onPick={chooseAsset}
                defaultFilter={refPolicy?.kinds[0] ?? "image"}
                defaultTab={refPolicy?.kinds[0] === "audio" ? "upload" : "hist"}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── reference thumbnail (composer strip) ─────────────────────────────────── */

function RefThumb({ item, onRemove }: { item: RefItem; onRemove: () => void }) {
  const src = item.url || item.blobUrl;
  return (
    <div className={`ref-thumb${item.failed ? " failed" : ""}`}>
      {item.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="参考" />
      ) : item.kind === "video" ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={src} muted />
      ) : (
        <span className="ref-aud">♪</span>
      )}
      {item.uploading && <span className="ref-spin" aria-label="上传中" />}
      {item.failed && (
        <span className="ref-badge" title="上传失败">
          !
        </span>
      )}
      <button type="button" className="ref-x" onClick={onRemove} aria-label="移除参考">
        ×
      </button>
    </div>
  );
}

/* ── message bubble ───────────────────────────────────────────────────────── */

/** Deterministic mesh-gradient fallback for an image-type message whose content
 *  URL is empty, seeded from the message id. */
function fallbackImage(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** parsed resultMeta of a task (JSON string or object → object). */
function taskMetaOf(t: MessageTaskVO): Record<string, unknown> {
  if (typeof t.resultMeta === "string") {
    try {
      return JSON.parse(t.resultMeta) || {};
    } catch {
      return {};
    }
  }
  return t.resultMeta && typeof t.resultMeta === "object"
    ? (t.resultMeta as Record<string, unknown>)
    : {};
}

/** all valid result URLs from a task (resultMeta.urls[], falling back to
 *  resultUrl). Multi-URL tasks (MJ 4-up / Suno 两首) return every entry. */
function taskResultUrls(t: MessageTaskVO): string[] {
  const meta = taskMetaOf(t);
  const arr = Array.isArray(meta.urls) ? (meta.urls as unknown[]) : [];
  const urls = arr.filter((u): u is string => typeof u === "string" && /^(https?:|data:)/.test(u));
  if (urls.length) return urls;
  return /^(https?:|data:)/.test(t.resultUrl || "") ? [t.resultUrl] : [];
}

/** Download a media URL as a file. Tries a blob fetch (forces save even for a
 *  cross-origin OSS URL); falls back to opening in a new tab on CORS failure. */
async function downloadMedia(url: string, name: string): Promise<void> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("fetch failed");
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** A hover copy button (✓ feedback) used on prompt + text bubbles. */
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      title="复制"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } else {
          toast.error("复制失败");
        }
      }}
    >
      {done ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h8" />
        </svg>
      )}
    </button>
  );
}

/** Lightbox state: a set of media items with a current index. */
type LightboxItem = { url: string; video: boolean };

/** Fullscreen lightbox with Esc-close and ←/→ wrap-around navigation. */
function Lightbox({
  items,
  index,
  onClose,
  onStep,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const cur = items[index];
  if (!cur) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lb-x" type="button" onClick={onClose} aria-label="关闭">
        ×
      </button>
      {items.length > 1 && (
        <>
          <button
            className="lb-nav prev"
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              onStep(-1);
            }}
          >
            ‹
          </button>
          <button
            className="lb-nav next"
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              onStep(1);
            }}
          >
            ›
          </button>
          <span className="lb-count">
            {index + 1} / {items.length}
          </span>
        </>
      )}
      <div className="lb-stage" onClick={(e) => e.stopPropagation()}>
        {cur.video ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={cur.url} controls autoPlay />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cur.url} alt="预览" />
        )}
      </div>
    </div>
  );
}

/** Read the composer attachments snapshotted on a user message's params
 *  ({attachments:[{url,kind}]}), filtering to entries with a usable URL. */
function messageAttachments(msg: MessageVO): { url: string; kind: string }[] {
  const raw = (msg.params as { attachments?: unknown } | undefined)?.attachments;
  if (!Array.isArray(raw)) return [];
  const out: { url: string; kind: string }[] = [];
  for (const x of raw) {
    if (x && typeof x === "object") {
      const url = (x as { url?: unknown }).url;
      const kind = (x as { kind?: unknown }).kind;
      if (typeof url === "string" && url) {
        // normalize empty/unknown kind to "image" (mirrors the backend, which
        // treats ""/"image" alike) so it renders as a thumbnail, not a file chip.
        out.push({ url, kind: typeof kind === "string" && kind ? kind : "image" });
      }
    }
  }
  return out;
}

function Bubble({
  msg,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
  swatchFor,
  fallbackModel,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
  /** 模型名 → 图标 swatch（生成结果的 AI 头像显示生成所用模型）。 */
  swatchFor: (name: string) => { style: React.CSSProperties; glyph: string };
  /** 任务没存 modelName 时的兜底模型名（该轮 params.model，再退当前所选）。 */
  fallbackModel?: string;
}) {
  // 生成台 assistant result: rendered from its linked task (single source of truth).
  if (msg.role !== "user" && msg.taskId) {
    return (
      <AssistantResult
        msg={msg}
        onReEdit={onReEdit}
        onRegenerate={onRegenerate}
        onOpenLightbox={onOpenLightbox}
        swatchFor={swatchFor}
        fallbackModel={fallbackModel}
      />
    );
  }

  const isMe = msg.role === "user";
  // backward-compat: older append-based media messages carry the URL in content.
  const isImage = msg.contentType === "image";
  const isVideo = msg.contentType === "video";
  // composer attachments snapshotted on the user message (text-model 文件上传).
  const atts = messageAttachments(msg);
  const attImages = atts.filter((a) => a.kind === "image");
  const aiSw = !isMe && fallbackModel ? swatchFor(fallbackModel) : null;
  return (
    <div className={`msg ${isMe ? "me" : "ai"}`}>
      {aiSw ? (
        <span className="av av-model" style={aiSw.style} title={fallbackModel}>
          {aiSw.glyph}
        </span>
      ) : (
        <span className="av" />
      )}
      <div className="msg-col">
        {isMe && atts.length > 0 && (
          <div className="chat-msg-atts">
            {atts.map((a, i) =>
              a.kind === "image" ? (
                <button
                  key={i}
                  type="button"
                  className="chat-msg-att"
                  title="点击查看大图"
                  style={{ background: `center / cover no-repeat url("${a.url}")` }}
                  onClick={() =>
                    onOpenLightbox(
                      attImages.map((x) => ({ url: x.url, video: false })),
                      attImages.findIndex((x) => x.url === a.url),
                    )
                  }
                />
              ) : (
                <a key={i} className="chat-msg-file" href={a.url} target="_blank" rel="noopener noreferrer">
                  📎 {a.kind}
                </a>
              ),
            )}
          </div>
        )}
        <div className="bubble">
          {isImage ? (
            <div
              className="chat-gen-media"
              title="点击查看大图"
              style={{
                cursor: msg.content ? "zoom-in" : undefined,
                background: msg.content
                  ? `center / cover no-repeat url("${msg.content}")`
                  : fallbackImage(msg.id),
              }}
              onClick={() => msg.content && onOpenLightbox([{ url: msg.content, video: false }], 0)}
            />
          ) : isVideo && msg.content ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video className="chat-gen-media" src={msg.content} controls />
          ) : isMe ? (
            <span>{msg.content}</span>
          ) : (
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {/* copy action sits BELOW the bubble (outside it), not inside the colored pill */}
        {!isImage && !isVideo && msg.content ? (
          <div className="bubble-acts">
            <CopyBtn text={msg.content} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** AssistantResult renders a 生成台 result bubble from its task's live state:
 *  processing / failed / cancelled / expired(no task) / success(image|video).
 *  Multi-URL results (MJ 4-up) render a grid; clicking any opens the lightbox. */
function AssistantResult({
  msg,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
  swatchFor,
  fallbackModel,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
  swatchFor: (name: string) => { style: React.CSSProperties; glyph: string };
  fallbackModel?: string;
}) {
  const t = msg.task;
  const isVideo = msg.contentType === "video";
  const isAudio = msg.contentType === "audio";
  // 生成结果的头像 = 生成该结果所用的模型图标：任务 modelName 优先，旧任务
  // 没存时回退该轮 params.model / 当前所选模型（fallbackModel），仍无则 ✦。
  const modelName = t?.modelName || fallbackModel || "";
  const sw = modelName ? swatchFor(modelName) : null;

  let body: ReactNode;
  let done = false;
  let primaryUrl = "";
  if (!t) {
    body = <div className="chat-gen-state warn">⚠ 该生成已过期，请重新生成</div>;
  } else if (t.status === AiTaskStatus.PROCESSING) {
    // a preview placeholder sized like the final media, so the result reveals in
    // place instead of the layout jumping from a thin progress line to a full image.
    body = (
      <div className={`chat-gen-loading${isVideo ? " video" : isAudio ? " audio" : ""}`}>
        <span className="spin" />
        <span className="lbl">生成中 · {Math.round(t.progress || 0)}%</span>
        <span className="bar">
          {/* 进度用 transform（CSS 侧 width:100% + scaleX），避免布局动画 */}
          <i style={{ transform: `scaleX(${Math.max(0.04, (t.progress || 0) / 100)})` }} />
        </span>
      </div>
    );
  } else if (t.status === AiTaskStatus.FAILED) {
    body = <div className="chat-gen-state err">⚠ 生成失败{t.errorMsg ? `：${t.errorMsg}` : ""}</div>;
  } else if (t.status === AiTaskStatus.CANCELLED) {
    body = <div className="chat-gen-state">已取消生成</div>;
  } else {
    const urls = taskResultUrls(t);
    done = urls.length > 0;
    primaryUrl = urls[0] || "";
    if (!urls.length) {
      body = <div className="chat-gen-state err">⚠ 生成结果无效</div>;
    } else if (isAudio) {
      // Suno 一次两首：歌曲行列表（封面+歌名+波形+时间），封面/歌名来自 tracks。
      const tracks = tracksFromMeta(taskMetaOf(t));
      body = (
        <div className="chat-gen-audio">
          {urls.map((u, i) => (
            <SongCard
              key={u}
              src={u}
              title={tracks[i]?.title || (urls.length > 1 ? `曲目 ${i + 1}` : "AI 音乐")}
              subtitle={modelName || "AI 音乐"}
              cover={tracks[i]?.coverUrl}
              duration={tracks[i]?.duration}
            />
          ))}
        </div>
      );
    } else if (isVideo) {
      // eslint-disable-next-line jsx-a11y/media-has-caption
      body = <video className="chat-gen-media" src={primaryUrl} controls />;
    } else if (urls.length > 1) {
      const items: LightboxItem[] = urls.map((u) => ({ url: u, video: false }));
      body = (
        <div className="chat-gen-grid">
          {urls.map((u, i) => (
            <div
              key={u}
              className="chat-gen-cell"
              title="点击查看"
              style={{ background: `center / cover no-repeat url("${u}")` }}
              onClick={() => onOpenLightbox(items, i)}
            />
          ))}
        </div>
      );
    } else {
      body = (
        <div
          className="chat-gen-media"
          title="点击查看大图"
          style={{ cursor: "zoom-in", background: `center / cover no-repeat url("${primaryUrl}")` }}
          onClick={() => onOpenLightbox([{ url: primaryUrl, video: false }], 0)}
        />
      );
    }
  }

  const retryable = !t || t.status === AiTaskStatus.FAILED;
  return (
    <div className="msg ai">
      {sw ? (
        <span className="av av-model" style={sw.style} title={modelName}>
          {sw.glyph}
        </span>
      ) : (
        <span className="av" />
      )}
      <div className="bubble">
        {body}
        {(done || retryable) && (
          <div className="chat-gen-acts">
            <button type="button" onClick={() => onReEdit(msg)}>
              ✎ 重新编辑
            </button>
            <button type="button" onClick={() => onRegenerate(msg)}>
              ↻ {retryable ? "重试" : "再次生成"}
            </button>
            {done && primaryUrl && (
              <button
                type="button"
                onClick={() =>
                  downloadMedia(
                    primaryUrl,
                    isVideo ? `gen-${msg.id}.mp4` : isAudio ? `gen-${msg.id}.mp3` : `gen-${msg.id}.png`,
                  )
                }
              >
                ⤓ 下载
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
