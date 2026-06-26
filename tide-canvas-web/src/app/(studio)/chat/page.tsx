"use client";

/* ============================================================================
   /chat — 对话式生成 (Chat) page.

   Ported from design-ref/对话.html + design-ref/liuguang/chat.js. Renders ONLY
   the content to the right of the (studio) ws-rail (the rail, dark flux bg, and
   flux/pages/studio.css all come from the (studio) layout). This page imports
   chat.css itself (the (studio) layout does not).

   Data is REAL and fully authed: chatApi over /api/im/* (see src/lib/chat-api.ts).
   ensureSession() runs before the first request. The conversation list comes
   from chatApi.conversations(); selecting one loads chatApi.messages(); the
   composer calls chatApi.send() then reloads the thread (the backend appends a
   canned assistant reply). 「新对话」 creates a conversation via createConversation().

   The composer chips (联网 / 模式 / 模型 / 比例 / 分辨率 / 时长 / 批量 / 积分) are
   driven by the selected model's 模型管理 config. 联网 only renders for a 文本
   model whose config.webSearch is enabled; the rest are not yet wired to a
   generation backend.
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
  type KeyboardEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatApi, streamMessage } from "@/lib/chat-api";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { AiTaskStatus } from "@/types/ai";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ConversationVO, MessageVO, MessageTaskVO } from "@/types/chat";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";

/* ── composer chips: model + options come from 模型管理 config (studio-models). ── */

/** config mode value → Chinese label for the 模式 chip. */
const MODE_LABEL: Record<string, string> = {
  t2i: "文生图",
  i2i: "图生图",
  t2v: "文生视频",
  i2v: "图生视频",
  keyframe: "首尾帧",
  omni_ref: "全能参考",
};

/** config mode value → one-line hint shown in the 模式 dropdown. */
const MODE_HINT: Record<string, string> = {
  t2i: "文字生成图片",
  i2i: "参考图生成图片",
  t2v: "文字生成视频",
  i2v: "参考图生成视频",
  keyframe: "首尾帧生成视频",
  omni_ref: "多参考生成视频",
};

/** deterministic per-model swatch gradient (ported from chat.js). */
function modelSwatch(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 50) % 360} 80% 52%))`;
}
function modelInitial(name: string): string {
  return name.replace(/[^A-Za-z一-龥]/g, "").charAt(0) || "A";
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

/** Which reference kinds + how many a given generation mode accepts. Modes not
 *  listed (t2i / t2v) take no reference media. */
const REF_POLICY: Record<string, { kinds: RefKind[]; max: number }> = {
  i2i: { kinds: ["image"], max: 6 },
  i2v: { kinds: ["image"], max: 1 },
  keyframe: { kinds: ["image"], max: 2 },
  omni_ref: { kinds: ["image", "video", "audio"], max: 6 },
};

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  // Position the menu with fixed coordinates anchored to the chip, so it escapes
  // the horizontally-scrolling chip row's clipping. Recompute on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = chipRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const st: CSSProperties = { position: "fixed", bottom: window.innerHeight - r.top + 8 };
      if (right) st.right = window.innerWidth - r.right;
      else st.left = r.left;
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

  const userEmail = useAuthStore((s) => s.user?.email);
  const ensureSession = useAuthStore((s) => s.ensureSession);

  // ── composer config (from 模型管理 via studio-models) ──────────────────────
  const modelNames = useMemo(() => genModels.map((m) => m.name), [genModels]);
  const selModel = useMemo(
    () => genModels.find((m) => m.name === model) ?? null,
    [genModels, model],
  );
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

  // reference policy for the current mode (image/video models only). undefined
  // for text models and the t2i / t2v modes, which take no reference media.
  const refPolicy = useMemo(
    () => (selModel && selModel.type !== "text" ? REF_POLICY[mode] : undefined),
    [selModel, mode],
  );

  // keep refsRef + the synchronous count in sync for stale-closure-free access
  // in callbacks/cleanup (re-syncs the count after adds/removals/dedup drops).
  useEffect(() => {
    refsRef.current = refs;
    refCountRef.current = refs.length;
  }, [refs]);

  // revoke every blob preview on unmount (avoid leaking object URLs).
  useEffect(() => {
    return () => {
      for (const r of refsRef.current) URL.revokeObjectURL(r.blobUrl);
    };
  }, []);

  // drop references that the current mode no longer accepts (e.g. switching from
  // an image-ref mode to t2v); revoke their blobs.
  useEffect(() => {
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
      for (const file of Array.from(files)) {
        const kind = fileKind(file);
        if (!policy.kinds.includes(kind)) continue;
        if (count >= policy.max) {
          toast.info(`最多添加 ${policy.max} 个参考素材`);
          break;
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
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = e.clipboardData?.files;
      if (refPolicy && files && files.length) {
        e.preventDefault();
        attachFiles(files);
      }
    },
    [refPolicy, attachFiles],
  );

  // load every studio model (text + image + video). Text models drive the chat
  // assistant and may expose the 联网 toggle when their config enables webSearch.
  // Refetch on focus/visibility so 模型管理 edits reflect without a manual refresh.
  const reloadGenModels = useCallback(async () => {
    try {
      const res = await marketApi.studioModels();
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
    reloadGenModels();
  }, [reloadGenModels]);

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

  // close any open composer dropdown on an outside click.
  useEffect(() => {
    if (!openSel) return;
    const onDoc = () => setOpenSel(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [openSel]);

  // snap chip selections to values the selected model actually supports.
  useEffect(() => {
    if (!mCfg) return;
    setMode((m) => (modeVals.length ? (modeVals.includes(m) ? m : modeVals[0]) : ""));
    setRatio((r) => (ratioOpts.length ? (ratioOpts.includes(r) ? r : ratioOpts[0]) : ""));
    setRes((r) => (resOpts.length ? (resOpts.includes(r) ? r : resOpts[0]) : ""));
    setDur((d) => (durOpts.length ? (durOpts.includes(d) ? d : durOpts[0]) : ""));
    setBatch((b) => Math.min(Math.max(1, b), batchMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mCfg, isVid]);

  // 切到不支持联网的模型时，强制关闭联网开关。
  useEffect(() => {
    if (!webSearchAvail) setWeb(false);
  }, [webSearchAvail]);

  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    forceBottom();
  }, [activeId, forceBottom]);

  // auto-grow the textarea (chat.js: min(180, scrollHeight))
  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(180, ta.scrollHeight) + "px";
  }, []);

  const resetTa = useCallback(() => {
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
  }, []);

  // load a conversation's message history
  const loadMessages = useCallback(async (id: string) => {
    setMsgsLoading(true);
    try {
      const res = await chatApi.messages(id, { pageNum: 1, pageSize: 100 });
      if (res.success && res.data) setMsgs(res.data.records);
      else setMsgs([]);
    } finally {
      setMsgsLoading(false);
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

  const pickConvo = useCallback(
    (id: string) => {
      if (id === activeId) return;
      chatAbortRef.current?.abort(); // cancel any in-flight stream
      chatAbortRef.current = null;
      setStreaming(null);
      setActiveId(id);
      clearRefs();
      loadMessages(id);
    },
    [activeId, loadMessages, clearRefs],
  );

  const newChat = useCallback(async () => {
    if (busy) return;
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
        resetTa();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, ensureSession, resetTa, clearRefs]);

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
      // eslint-disable-next-line no-alert
      if (!window.confirm(`删除对话「${c.title || "未命名对话"}」？此操作不可撤销。`)) return;
      const res = await chatApi.deleteConversation(c.id);
      if (!res.success) {
        toast.error(res.message || "删除失败");
        return;
      }
      const remaining = convos.filter((x) => x.id !== c.id);
      setConvos(remaining);
      if (activeId === c.id) {
        if (remaining[0]) {
          setActiveId(remaining[0].id);
          loadMessages(remaining[0].id);
        } else {
          setActiveId(null);
          setMsgs([]);
        }
      }
    },
    [convos, activeId, loadMessages],
  );

  const send = useCallback(async () => {
    const v = draft.trim();
    if (!v || busy) return;

    // reference media (uploaded → hosted urls). A ref-mode requires at least one
    // usable ref and blocks while any is still uploading.
    const refImageUrls = refs.filter((r) => r.kind === "image" && r.url).map((r) => r.url as string);
    const refVideoUrls = refs.filter((r) => r.kind === "video" && r.url).map((r) => r.url as string);
    const refAudioUrls = refs.filter((r) => r.kind === "audio" && r.url).map((r) => r.url as string);
    if (refPolicy) {
      if (refs.some((r) => r.uploading)) {
        toast.info("参考素材上传中，请稍候");
        return;
      }
      if (refImageUrls.length === 0 && refVideoUrls.length === 0) {
        toast.error("当前模式需要先添加参考素材");
        return;
      }
    }

    setBusy(true);
    setDraft("");
    resetTa();
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

    // optimistic user bubble
    const optimistic: MessageVO = {
      id: `tmp-${Date.now()}`,
      conversationId: id,
      role: "user",
      contentType: "text",
      content: v,
      createTime: new Date().toISOString(),
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

    // 选图片/视频模型 → 真实生成（一个 turn，助手消息只指向 task）；文本模型 → 文字对话。
    const wantImage = selModel?.type === "image";
    const wantVideo = selModel?.type === "video";

    try {
      if ((wantImage || wantVideo) && selModel) {
        // 先 submit（计费/配额走既有生成管线）；被拒时尚未持久化任何东西，无孤儿可清。
        const input: Record<string, unknown> = {
          prompt: v,
          ...(ratio ? { aspectRatio: ratio, aspect_ratio: ratio, ratio } : {}),
          ...(res ? { resolution: res } : {}),
          ...(wantVideo && dur ? { duration: dur } : {}),
        };
        // pick the handler by mode + attached references (P2).
        let handler: string;
        if (wantVideo) {
          if (mode === "i2v" && refImageUrls.length) {
            handler = "image_to_video";
            input.sourceImage = refImageUrls[0];
            input.imageList = refImageUrls.slice(0, 1);
          } else if (mode === "keyframe" && refImageUrls.length) {
            handler = "start_end_to_video";
            input.firstFrame = refImageUrls[0];
            input.lastFrame = refImageUrls[1] ?? refImageUrls[0];
          } else if (mode === "omni_ref" && (refImageUrls.length || refVideoUrls.length)) {
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
          ...(refImageUrls.length || refVideoUrls.length
            ? {
                references: [
                  ...refImageUrls.map((url) => ({ url, kind: "image" })),
                  ...refVideoUrls.map((url) => ({ url, kind: "video" })),
                ],
              }
            : {}),
        };
        await chatApi.persistTurn(id, {
          prompt: v,
          params,
          taskId: gen.data.id,
          contentType: wantVideo ? "video" : "image",
        });
        clearRefs(); // turn committed → clear the composer references
        await loadMessages(id); // assistant message now carries the task → polling takes over
        bump(id);
      } else {
        // text model → streamed reply (P4). The generic typing dots give way to
        // a live streaming bubble; switching conversation aborts it.
        setTyping(false);
        setStreaming("");
        const ac = new AbortController();
        chatAbortRef.current = ac;
        let acc = "";
        await streamMessage(id, v, {
          signal: ac.signal,
          onDelta: (d) => {
            acc += d;
            setStreaming(acc);
            // coalesce rapid tokens into one scroll per frame to avoid judder.
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onError: (m) => toast.error(m || "生成失败"),
        });
        // only clear OUR controller — a newer stream may have replaced it.
        if (chatAbortRef.current === ac) chatAbortRef.current = null;
        setStreaming(null);
        // only refresh if the user is still on this conversation (not switched away).
        if (activeIdRef.current === id) {
          await loadMessages(id);
          bump(id);
        }
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, activeId, ensureSession, loadMessages, resetTa, selModel, mode, ratio, res, dur, batch, refs, refPolicy, clearRefs, forceBottom, scrollEnd]);

  // restore a turn's snapshot params into the composer (重新编辑 / 再次生成).
  const restoreFromParams = useCallback(
    (p?: Record<string, unknown>) => {
      if (!p) return;
      if (typeof p.model === "string") setModel(p.model);
      if (typeof p.mode === "string") setMode(p.mode);
      if (typeof p.ratio === "string") setRatio(p.ratio);
      if (typeof p.resolution === "string") setRes(p.resolution);
      if (typeof p.duration === "string") setDur(p.duration);
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
      restoreFromParams(u.params);
      setDraft(u.content);
      setPendingSend(true);
    },
    [busy, turnUserOf, restoreFromParams],
  );
  // fire send() once the restored params/draft have committed.
  useEffect(() => {
    if (!pendingSend) return;
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

  // ── @ 引用 (P3, textarea-based / IME-safe) ─────────────────────────────────
  // Typing @ in a reference mode opens a menu of the attached references; picking
  // one inserts "@图N" at the caret (the reference is already attached via the
  // strip, so it ships with the turn). The full contentEditable thumbnail-pill
  // RichPromptInput is deferred — it needs hands-on browser IME (中文组字) testing.
  const [atMenu, setAtMenu] = useState<{ start: number } | null>(null);
  const [atIndex, setAtIndex] = useState(0);

  // candidates = attached references that finished uploading.
  const mentionCands = useMemo(() => refs.filter((r) => r.url), [refs]);
  const mentionLabel = useCallback(
    (key: string) => {
      const i = mentionCands.findIndex((r) => r.key === key);
      return i >= 0 ? `图${i + 1}` : "图";
    },
    [mentionCands],
  );

  // visible candidates filtered by the query run after @ (matches the auto label).
  const atVisible = useMemo(() => {
    if (!atMenu) return [];
    const ta = taRef.current;
    const pos = ta?.selectionStart ?? draft.length;
    const q = draft.slice(atMenu.start + 1, pos).trim();
    if (!q) return mentionCands;
    return mentionCands.filter((_, i) => `图${i + 1}`.includes(q) || `${i + 1}` === q);
  }, [atMenu, draft, mentionCands]);

  // detect an active "@query" ending at the caret (query: no whitespace/@, ≤40).
  const detectAt = useCallback(
    (ta: HTMLTextAreaElement) => {
      if (!refPolicy || mentionCands.length === 0) {
        setAtMenu(null);
        return;
      }
      const pos = ta.selectionStart ?? ta.value.length;
      const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(ta.value.slice(0, pos));
      if (m) {
        setAtMenu({ start: pos - m[1].length - 1 });
        setAtIndex(0);
      } else {
        setAtMenu(null);
      }
    },
    [refPolicy, mentionCands.length],
  );

  const pickMention = useCallback(
    (cand: RefItem) => {
      const ta = taRef.current;
      if (!ta || !atMenu) return;
      const label = mentionLabel(cand.key);
      const caretNow = ta.selectionStart ?? draft.length;
      const before = draft.slice(0, atMenu.start);
      const after = draft.slice(caretNow);
      const next = `${before}@${label} ${after}`;
      setDraft(next);
      setAtMenu(null);
      requestAnimationFrame(() => {
        ta.focus();
        const caret = before.length + label.length + 2; // @ + label + trailing space
        ta.setSelectionRange(caret, caret);
        autosize();
      });
    },
    [atMenu, draft, mentionLabel, autosize],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // @-menu navigation takes precedence over send.
      if (atMenu && atVisible.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtIndex((i) => (i + 1) % atVisible.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtIndex((i) => (i - 1 + atVisible.length) % atVisible.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          pickMention(atVisible[Math.min(atIndex, atVisible.length - 1)]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenu(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send, atMenu, atVisible, atIndex, pickMention],
  );

  // approx points cost: the selected model's 消耗积分 × batch.
  const points = useMemo(() => {
    const base = parseFloat(selModel?.pointCost ?? "0") || 0;
    return Math.round(base * Math.max(1, batch));
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
          <span className="acct">{userEmail || "未登录"} ▾</span>
        </div>

        <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
          <div className="chat-inner">
            {msgsLoading && msgs.length === 0 ? (
              <div className="msg ai">
                <span className="av" />
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
                <span className="av" />
                <div className="bubble">
                  <div>
                    你好！我是你的 SCARECROW 创作助手。告诉我你想创作的内容 ——
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
                />
              ))
            )}
            {streaming !== null && (
              <div className="msg ai">
                <span className="av" />
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
                <span className="av" />
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
          <div
            className={`composer-box${dragOver ? " drag" : ""}`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {dragOver && <div className="composer-drop">松开以添加参考素材</div>}
            {atMenu && atVisible.length > 0 && (
              <div className="at-menu" onMouseDown={(e) => e.preventDefault()}>
                <div className="at-menu-h">引用参考素材</div>
                {atVisible.map((r) => {
                  const i = mentionCands.findIndex((c) => c.key === r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      className={`at-item${atVisible[atIndex]?.key === r.key ? " on" : ""}`}
                      onClick={() => pickMention(r)}
                    >
                      {r.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.url || r.blobUrl} alt="" />
                      ) : r.kind === "video" ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={r.url || r.blobUrl} muted />
                      ) : (
                        <span className="at-aud">♪</span>
                      )}
                      <span className="at-lab">@图{i + 1}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
                  title="上传参考素材"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ＋
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
              <textarea
                ref={taRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  autosize();
                  detectAt(e.target);
                }}
                onKeyUp={(e) => detectAt(e.currentTarget)}
                onClick={(e) => detectAt(e.currentTarget)}
                onBlur={() => setTimeout(() => setAtMenu(null), 120)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder="描述你想生成的内容，或上传参考素材让模型自由发挥…  输入 / 使用技能，@ 添加主体"
              />
            </div>
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
                    <span className="cm-sw sm" style={{ background: modelSwatch(model) }}>
                      {modelInitial(model)}
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
                        <span className="cm-sw" style={{ background: modelSwatch(m.name) }}>
                          {modelInitial(m.name)}
                        </span>
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
              </div>
              <span className="cm-pts">约 {points} 积分</span>
              <button
                className="cm-send"
                aria-label="发送"
                type="button"
                onClick={send}
                disabled={busy || !draft.trim()}
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

/** all valid result URLs from a task (resultMeta.urls[], falling back to
 *  resultUrl). Multi-URL tasks (e.g. Midjourney 4-up) return every image. */
function taskResultUrls(t: MessageTaskVO): string[] {
  let meta: Record<string, unknown> = {};
  if (typeof t.resultMeta === "string") {
    try {
      meta = JSON.parse(t.resultMeta) || {};
    } catch {
      meta = {};
    }
  } else if (t.resultMeta && typeof t.resultMeta === "object") {
    meta = t.resultMeta as Record<string, unknown>;
  }
  const arr = Array.isArray(meta.urls) ? (meta.urls as unknown[]) : [];
  const urls = arr.filter((u): u is string => typeof u === "string" && /^(https?:|data:)/.test(u));
  if (urls.length) return urls;
  return /^(https?:|data:)/.test(t.resultUrl || "") ? [t.resultUrl] : [];
}

/** Cross-environment clipboard write: navigator.clipboard (secure context) with
 *  an execCommand fallback for plain-HTTP deploys where it is undefined. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
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
      {done ? "✓" : "⧉"}
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

function Bubble({
  msg,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
}) {
  // 生成台 assistant result: rendered from its linked task (single source of truth).
  if (msg.role !== "user" && msg.taskId) {
    return (
      <AssistantResult
        msg={msg}
        onReEdit={onReEdit}
        onRegenerate={onRegenerate}
        onOpenLightbox={onOpenLightbox}
      />
    );
  }

  const isMe = msg.role === "user";
  // backward-compat: older append-based media messages carry the URL in content.
  const isImage = msg.contentType === "image";
  const isVideo = msg.contentType === "video";
  return (
    <div className={`msg ${isMe ? "me" : "ai"}`}>
      <span className="av" />
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
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
}) {
  const t = msg.task;
  const isVideo = msg.contentType === "video";

  let body: ReactNode;
  let done = false;
  let primaryUrl = "";
  if (!t) {
    body = <div className="chat-gen-state warn">⚠ 该生成已过期，请重新生成</div>;
  } else if (t.status === AiTaskStatus.PROCESSING) {
    body = (
      <div className="chat-gen-state">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
        生成中 · {Math.round(t.progress || 0)}%
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
      <span className="av" />
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
                  downloadMedia(primaryUrl, isVideo ? `gen-${msg.id}.mp4` : `gen-${msg.id}.png`)
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
