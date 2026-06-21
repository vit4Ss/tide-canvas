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
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { chatApi } from "@/lib/chat-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ConversationVO, MessageVO } from "@/types/chat";
import { mesh } from "@/lib/mesh";

/* ── composer chip options (cosmetic, ported from chat.js) ─────────────────── */

const MODES = ["文生视频", "文生图", "图生视频", "图生图"];
const MODELS = ["Kling-VIDEO-3.0-Pro", "Vidu-2.0", "Hailuo-02", "Seedance-Pro"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const RESOLUTIONS = ["720p", "1080p", "2K", "4K"];
const DURATIONS = ["5s", "10s", "15s"];

/** Cycle through a list of chip options on click. */
function next<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
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

  // composer chips (cosmetic)
  const [web, setWeb] = useState(true);
  const [mode, setMode] = useState(MODES[0]);
  const [model, setModel] = useState(MODELS[0]);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [res, setRes] = useState(RESOLUTIONS[1]);
  const [dur, setDur] = useState(DURATIONS[0]);
  const [batch, setBatch] = useState(2);

  const userEmail = useAuthStore((s) => s.user?.email);
  const ensureSession = useAuthStore((s) => s.ensureSession);

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

  // ~ approx points cost (kept from the design's "约 100 积分")
  const points = useMemo(() => {
    const base = mode.includes("视频") ? 100 : 20;
    const resMul = { "720p": 1, "1080p": 1.6, "2K": 2.6, "4K": 4 }[res] ?? 1;
    const durMul = mode.includes("视频")
      ? ({ "5s": 1, "10s": 2, "15s": 3 }[dur] ?? 1)
      : 1;
    return Math.round(base * resMul * durMul * batch);
  }, [mode, res, dur, batch]);

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
              <button className="cm-chip" type="button" onClick={() => setMode((m) => next(MODES, m))}>
                {mode} ▾
              </button>
              <button className="cm-chip" type="button" onClick={() => setModel((m) => next(MODELS, m))}>
                {model} ▾
              </button>
              <button className="cm-chip" type="button" onClick={() => setRatio((r) => next(RATIOS, r))}>
                {ratio} ▾
              </button>
              <button className="cm-chip" type="button" onClick={() => setRes((r) => next(RESOLUTIONS, r))}>
                {res} ▾
              </button>
              <button className="cm-chip" type="button" onClick={() => setDur((d) => next(DURATIONS, d))}>
                {dur} ▾
              </button>
              <button
                className="cm-chip"
                type="button"
                onClick={() => setBatch((b) => (b >= 4 ? 1 : b + 1))}
              >
                ⚲ {batch} ▾
              </button>
              <span className="sp" />
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
