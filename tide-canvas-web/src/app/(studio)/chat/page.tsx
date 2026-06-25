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
import { chatApi } from "@/lib/chat-api";
import { aiApi } from "@/lib/api";
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
  // 「＋」上传：文本模型按 config.fileUpload 决定；图片/视频模型用于上传参考素材，保持显示。
  const uploadAvail = selModel?.type === "text" ? !!mCfg?.fileUpload : true;
  const modeVals = mCfg?.modes ?? [];
  const ratioOpts = mCfg?.ratios ?? [];
  const resOpts = mCfg?.resolutions ?? [];
  const durOpts = isVid ? mCfg?.durations ?? [] : [];
  const countOpts = mCfg?.batchOptions?.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMax = Math.max(...countOpts);
  const toggleSel = (k: string) => setOpenSel((cur) => (cur === k ? null : k));

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

  useEffect(() => {
    scrollEnd();
  }, [msgs, typing, scrollEnd]);

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
      setActiveId(id);
      loadMessages(id);
    },
    [activeId, loadMessages],
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
        resetTa();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, ensureSession, resetTa]);

  const send = useCallback(async () => {
    const v = draft.trim();
    if (!v || busy) return;

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
        const gen = await aiApi.generate({
          handler: wantVideo ? "text_to_video" : "text_to_image",
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
        };
        await chatApi.persistTurn(id, {
          prompt: v,
          params,
          taskId: gen.data.id,
          contentType: wantVideo ? "video" : "image",
        });
        await loadMessages(id); // assistant message now carries the task → polling takes over
        bump(id);
      } else {
        const res2 = await chatApi.send(id, v);
        if (res2.success) {
          await loadMessages(id);
          bump(id);
        }
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, activeId, ensureSession, loadMessages, resetTa, selModel, mode, ratio, res, dur]);

  // restore a turn's snapshot params into the composer (重新编辑 / 再次生成).
  const restoreFromParams = useCallback((p?: Record<string, unknown>) => {
    if (!p) return;
    if (typeof p.model === "string") setModel(p.model);
    if (typeof p.mode === "string") setMode(p.mode);
    if (typeof p.ratio === "string") setRatio(p.ratio);
    if (typeof p.resolution === "string") setRes(p.resolution);
    if (typeof p.duration === "string") setDur(p.duration);
  }, []);

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

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
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
            convos.map((c) => (
              <div
                key={c.id}
                className={`convo ${c.id === activeId ? "on" : ""}`}
                onClick={() => pickConvo(c.id)}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="t">{c.title || "未命名对话"}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* chat main */}
      <main className="chat-main">
        <div className="chat-top">
          <span className="ti">{activeTitle}</span>
          <span className="acct">{userEmail || "未登录"} ▾</span>
        </div>

        <div className="chat-thread" ref={threadRef}>
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
                <Bubble key={m.id} msg={m} onReEdit={reEdit} onRegenerate={regenerate} />
              ))
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
        </div>

        <div className="chat-composer">
          <div className="composer-box">
            <div className="composer-head">
              {uploadAvail && (
                <button className="cm-upload" title="上传参考素材" type="button">
                  ＋
                </button>
              )}
              <textarea
                ref={taRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  autosize();
                }}
                onKeyDown={onKeyDown}
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

/** pick the result URL from a task (resultMeta.urls[0] → resultUrl). */
function taskResultUrl(t: MessageTaskVO): string {
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
  const first = arr.find((u) => typeof u === "string" && /^(https?:|data:)/.test(u));
  if (typeof first === "string") return first;
  return /^(https?:|data:)/.test(t.resultUrl || "") ? t.resultUrl : "";
}

function Bubble({
  msg,
  onReEdit,
  onRegenerate,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
}) {
  // 生成台 assistant result: rendered from its linked task (single source of truth).
  if (msg.role !== "user" && msg.taskId) {
    return <AssistantResult msg={msg} onReEdit={onReEdit} onRegenerate={onRegenerate} />;
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
            onClick={() =>
              msg.content && window.open(msg.content, "_blank", "noopener,noreferrer")
            }
          />
        ) : isVideo && msg.content ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video className="chat-gen-media" src={msg.content} controls />
        ) : (
          <span>{msg.content}</span>
        )}
      </div>
    </div>
  );
}

/** AssistantResult renders a 生成台 result bubble from its task's live state:
 *  processing / failed / cancelled / expired(no task) / success(image|video). */
function AssistantResult({
  msg,
  onReEdit,
  onRegenerate,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
}) {
  const t = msg.task;
  const isVideo = msg.contentType === "video";

  let body: ReactNode;
  let done = false;
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
    const url = taskResultUrl(t);
    done = !!url;
    if (!url) {
      body = <div className="chat-gen-state err">⚠ 生成结果无效</div>;
    } else if (isVideo) {
      // eslint-disable-next-line jsx-a11y/media-has-caption
      body = <video className="chat-gen-media" src={url} controls />;
    } else {
      body = (
        <div
          className="chat-gen-media"
          title="点击查看大图"
          style={{ cursor: "zoom-in", background: `center / cover no-repeat url("${url}")` }}
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
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
          </div>
        )}
      </div>
    </div>
  );
}
