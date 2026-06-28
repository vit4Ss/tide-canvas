"use client";

/* ============================================================================
   Chat / 对话式生成 — client view.

   Ported from design-ref/对话.html + design-ref/liuguang/chat.js into React.
   Renders ONLY the content to the right of the (studio) ws-rail (the rail comes
   from the (studio) layout). Uses the exact liuguang chat.css class names so the
   imported stylesheet applies.

   AI replies are SIMULATED client-side (~1.1s delay, seeded thread + random
   replies + a mesh-gradient image grid). Real generation API is a later phase.
   ========================================================================== */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CREATE_MODELS, coverBg, type MeshHues } from "@/mock";
import { toast } from "@/components/shared/toast";

/* ── data (mirrors chat.js CONVOS / SEED / REPLIES) ───────────────────────── */

const CONVOS: string[] = [
  "守护者 · 影片创作",
  "赛博朋克城市海报",
  "国风 Q 版头像",
  "产品视频脚本",
];

type Block =
  | { kind: "html"; html: string }
  | { kind: "images"; covers: MeshHues[] };

interface Msg {
  who: "ai" | "me";
  /** Plain text (user) or rich blocks (assistant). */
  text?: string;
  blocks?: Block[];
}

/** Four key-scene concept covers — MeshHues triplets → coverBg via mesh(). */
const SEED_COVERS: MeshHues[] = [
  [258, 282, 258],
  [198, 240, 258],
  [282, 318, 0],
  [40, 0, 318],
];

const SEED: Msg[] = [
  {
    who: "ai",
    blocks: [
      {
        kind: "html",
        html: "你好！我是你的 流光 创作助手。告诉我你想创作的内容 —— 图片、视频、剧本或灵感，我来帮你一步步完成。",
      },
    ],
  },
  {
    who: "me",
    text: "帮我构思一个 20 分钟的抗战题材短片，主题是「守护」。",
  },
  {
    who: "ai",
    blocks: [
      {
        kind: "html",
        html: "<p>好的，已为「守护」主题搭建创作框架：</p><ol><li><strong>外部风暴</strong>：以纪实语言表现 1941–1942 年的大规模扫荡，铁蹄、拉网战术。</li><li><strong>内部守护</strong>：普通农民像守护生命一样守护一面旗帜，强调「守」而非「战」。</li><li><strong>最终结局</strong>：抗战胜利后，旗帜被迎回再次升起。</li></ol><p>下一步，你想先确认 20 分钟整体结构，还是直接推进「扫荡与守护」段落的分镜？</p>",
      },
    ],
  },
  {
    who: "me",
    text: "先生成几张关键场景的概念图。",
  },
  {
    who: "ai",
    blocks: [
      {
        kind: "html",
        html: "<p>已根据剧情生成 4 张关键场景概念图（雪原扫荡 / 山洞藏旗 / 守护群像 / 旗帜升起）：</p>",
      },
      { kind: "images", covers: SEED_COVERS },
    ],
  },
];

const REPLIES: string[] = [
  "收到，我来基于你的描述继续推进。可以告诉我更偏向哪种风格或情绪吗？",
  "好的，已记录。要我先出分镜脚本，还是直接生成画面？",
  "明白！我建议先确定主色调与镜头节奏，这样成片更统一。需要我给几个方案吗？",
  "这个方向很棒 ✦ 我已经准备好了，确认后即可开始生成。",
];

/* ── composer chip options ────────────────────────────────────────────────── */

const MODES = ["文生视频", "文生图", "图生视频", "图生图"];
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const RESOLUTIONS = ["720p", "1080p", "2K", "4K"];
const DURATIONS = ["5s", "10s", "15s"];

/* ── small helpers ────────────────────────────────────────────────────────── */

/** Cycle through a list of chip options on click. */
function next<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

/* ── component ────────────────────────────────────────────────────────────── */

export default function ChatView() {
  const [convoIdx, setConvoIdx] = useState(0);
  const [title, setTitle] = useState(CONVOS[0]);
  const [msgs, setMsgs] = useState<Msg[]>(() => SEED.slice());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

  // composer chips
  const [web, setWeb] = useState(true);
  const [mode, setMode] = useState(MODES[0]);
  const [model, setModel] = useState("Kling-VIDEO-3.0-Pro");
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [res, setRes] = useState(RESOLUTIONS[1]);
  const [dur, setDur] = useState(DURATIONS[0]);
  const [batch, setBatch] = useState(2);

  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  const send = useCallback(() => {
    const v = draft.trim();
    if (!v || busy) return;
    setMsgs((prev) => [...prev, { who: "me", text: v }]);
    setDraft("");
    setBusy(true);
    setTyping(true);
    // reset textarea height after clearing
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
    setTimeout(() => {
      const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)];
      setMsgs((prev) => [...prev, { who: "ai", blocks: [{ kind: "html", html: reply }] }]);
      setTyping(false);
      setBusy(false);
    }, 1100);
  }, [draft, busy]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const newChat = useCallback(() => {
    setMsgs([{ who: "ai", blocks: [{ kind: "html", html: "新对话已开启 ✦ 想创作点什么？" }] }]);
    setTitle("新对话");
    setConvoIdx(-1);
    setDraft("");
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.style.height = "auto";
    });
  }, []);

  const pickConvo = useCallback((i: number) => {
    setConvoIdx(i);
    setTitle(CONVOS[i]);
  }, []);

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
          <button className="chat-new" onClick={newChat}>
            <span>＋</span> 新对话
          </button>
        </div>
        <div className="chat-convos">
          <div className="chat-ch">最近对话</div>
          {CONVOS.map((c, i) => (
            <div
              key={c}
              className={`convo ${i === convoIdx ? "on" : ""}`}
              onClick={() => pickConvo(i)}
            >
              <svg viewBox="0 0 24 24">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="t">{c}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* chat main */}
      <main className="chat-main">
        <div className="chat-top">
          <span className="ti">{title}</span>
        </div>

        <div className="chat-thread" ref={threadRef}>
          <div className="chat-inner">
            {msgs.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}
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
              <button
                className="cm-upload"
                title="上传参考素材"
                onClick={() => toast.info("上传参考素材 · 高保真原型")}
              >
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
                onClick={() => setWeb((w) => !w)}
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
                </svg>
                联网
              </button>
              <button className="cm-chip" onClick={() => setMode((m) => next(MODES, m))}>
                {mode} ▾
              </button>
              <button
                className="cm-chip"
                onClick={() => setModel((m) => next(CREATE_MODELS, CREATE_MODELS.includes(m) ? m : CREATE_MODELS[0]))}
              >
                {model} ▾
              </button>
              <button className="cm-chip" onClick={() => setRatio((r) => next(RATIOS, r))}>
                {ratio} ▾
              </button>
              <button className="cm-chip" onClick={() => setRes((r) => next(RESOLUTIONS, r))}>
                {res} ▾
              </button>
              <button className="cm-chip" onClick={() => setDur((d) => next(DURATIONS, d))}>
                {dur} ▾
              </button>
              <button
                className="cm-chip"
                onClick={() => setBatch((b) => (b >= 4 ? 1 : b + 1))}
              >
                ⚲ {batch} ▾
              </button>
              <span className="sp" />
              <span className="cm-pts">约 {points} 积分</span>
              <button
                className="cm-send"
                aria-label="发送"
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

function Bubble({ msg }: { msg: Msg }) {
  return (
    <div className={`msg ${msg.who === "me" ? "me" : "ai"}`}>
      <span className="av" />
      <div className="bubble">
        {msg.who === "me" ? (
          <span>{msg.text}</span>
        ) : (
          msg.blocks?.map((b, i) =>
            b.kind === "html" ? (
              <div key={i} dangerouslySetInnerHTML={{ __html: b.html }} />
            ) : (
              <div key={i} className="imgrow">
                {b.covers.map((c, j) => (
                  <div key={j} className="ph" style={{ background: coverBg(c) }} />
                ))}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
