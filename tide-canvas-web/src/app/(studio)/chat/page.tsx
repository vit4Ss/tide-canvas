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
   the design's cosmetic controls — kept 1:1 for visual fidelity, not yet wired
   to a generation backend.
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
} from "react";
import { chatApi } from "@/lib/chat-api";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ConversationVO, MessageVO } from "@/types/chat";
import { mesh } from "@/lib/mesh";

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
  const [web, setWeb] = useState(true);
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
  const modeVals = mCfg?.modes ?? [];
  const ratioOpts = mCfg?.ratios ?? [];
  const resOpts = mCfg?.resolutions ?? [];
  const durOpts = isVid ? mCfg?.durations ?? [] : [];
  const countOpts = mCfg?.batchOptions?.length ? mCfg.batchOptions : [1, 2, 3, 4];
  const batchMax = Math.max(...countOpts);
  const toggleSel = (k: string) => setOpenSel((cur) => (cur === k ? null : k));

  // load generatable models (image + video; text models are chat-only). Refetch
  // on focus/visibility so 模型管理 edits reflect without a manual refresh.
  const reloadGenModels = useCallback(async () => {
    try {
      const res = await marketApi.studioModels();
      const list = (res.success && Array.isArray(res.data) ? res.data : []).filter(
        (m) => m.type !== "text",
      );
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

    try {
      const res = await chatApi.send(id, v);
      if (res.success) {
        // reload to pick up the persisted user message + canned assistant reply
        await loadMessages(id);
        // bump this conversation's lastMessageAt-driven ordering to the top
        setConvos((prev) => {
          const idx = prev.findIndex((c) => c.id === id);
          if (idx <= 0) return prev;
          const copy = prev.slice();
          const [c] = copy.splice(idx, 1);
          copy.unshift(c);
          return copy;
        });
      }
    } finally {
      setTyping(false);
      setBusy(false);
    }
  }, [draft, busy, activeId, ensureSession, loadMessages, resetTa]);

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
              msgs.map((m) => <Bubble key={m.id} msg={m} />)
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
              <button className="cm-upload" title="上传参考素材" type="button">
                ＋
              </button>
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

function Bubble({ msg }: { msg: MessageVO }) {
  const isMe = msg.role === "user";
  const isImage = msg.contentType === "image";
  return (
    <div className={`msg ${isMe ? "me" : "ai"}`}>
      <span className="av" />
      <div className="bubble">
        {isImage ? (
          <div className="imgrow">
            <div
              className="ph"
              style={{
                background: msg.content
                  ? `center / cover no-repeat url("${msg.content}")`
                  : fallbackImage(msg.id),
              }}
            />
          </div>
        ) : (
          <span>{msg.content}</span>
        )}
      </div>
    </div>
  );
}
