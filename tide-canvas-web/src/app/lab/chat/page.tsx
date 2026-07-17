"use client";

/* ============================================================================
   /lab/chat — @lobehub/ui 技术验证页（不入正式导航）。

   验证目标：LobeChat 同款交互组件（ChatList / ChatInputArea）能否与本项目
   共存 —— antd v6 peer 匹配、React 19、深色主题与 imini 体系的观感契合度。

   数据链路完全复用现有后端：aiApi.listModels 取 TEXT 模型（只列后台配置的
   模型），assistant_chat handler 创建任务后轮询 —— 与画布助手面板同一条链路，
   不新增任何后端接口。
   ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { Markdown, ThemeProvider } from "@lobehub/ui";
import { ChatInputActionBar, ChatInputArea, ChatList, ChatSendButton, LoadingDots } from "@lobehub/ui/chat";
import type { ChatMessage } from "@lobehub/ui/chat";
import { Select } from "antd";
import { Sparkles, UserRound } from "lucide-react";
import { aiApi } from "@/lib/api";
import { AuthGuard } from "@/components/auth-guard";
import { useAuthStore } from "@/stores/use-auth-store";
import { AiModelType, AiTaskStatus, type AiModelVO, type AiTaskVO } from "@/types/ai";

const HANDLER = "assistant_chat";
const POLL_MS = 1500;
const MAX_POLL_MS = 60 * 1000;

/* 头像用 lucide 图标（项目统一图标库）——lobe-ui 的 emoji 头像会去 npmmirror
   拉 fluent-emoji 图片，既是外链依赖也不合项目"禁 emoji"规范。 */
const USER_META = { avatar: <UserRound size={20} />, backgroundColor: "rgba(255,255,255,.08)", title: "我" };
const ASSISTANT_META = { avatar: <Sparkles size={20} />, backgroundColor: "rgba(255,255,255,.08)", title: "流光助手" };

/* 气泡内 Markdown 的溢出治理：长代码行在 pre 内横向滚动，不许把气泡撑出画面 */
const MD_CSS = `
.labmd{min-width:0;max-width:100%;}
.labmd pre{overflow-x:auto;max-width:100%;}
.labmd code{word-break:break-word;}
`;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** assistant_chat 的文本结果在 resultMeta 常见键里（与画布助手面板同规则）。 */
function textFromTask(task: AiTaskVO): string {
  const raw = task.resultMeta;
  let meta: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      meta = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      meta = { text: raw };
    }
  } else if (raw && typeof raw === "object") {
    meta = raw as Record<string, unknown>;
  }
  for (const key of ["answer", "content", "text", "message", "response", "output"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "已完成，但接口没有返回可展示的文本。";
}

/** 登录门槛：未登录跳 /login（与 (studio) 页面一致），也避免匿名触发计费接口。 */
export default function LabChatPage() {
  return (
    <AuthGuard>
      <LabChat />
    </AuthGuard>
  );
}

function LabChat() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingId, setLoadingId] = useState<string>();
  const [models, setModels] = useState<AiModelVO[]>([]);
  const [modelId, setModelId] = useState("");
  const seqRef = useRef(0);
  const unmountedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  /* 每轮发送的序号：停止/新一轮都会推进它，旧轮的轮询醒来发现号不对就退出，
     不会把迟到的结果/错误写进已停止的气泡。 */
  const runSeqRef = useRef(0);
  const activeTaskRef = useRef<string | number | null>(null);

  // 挂载时归位、卸载时置位——React StrictMode 的“卸载再挂载”若只置位不归位，
  // ref 会永远停在 true，首次发送后 sending 就再也回不来（use-ai-generation 同款写法）。
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  // 只列后台配置的 TEXT 模型 —— 没有任何内置供应商。
  useEffect(() => {
    let cancelled = false;
    aiApi.listModels().then((res) => {
      if (cancelled || !res.success) return;
      const all = res.data ?? [];
      const text = all.filter((m) => m.type === AiModelType.TEXT);
      const usable = text.length ? text : all;
      setModels(usable);
      setModelId((cur) => cur || usable[0]?.modelId || "");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 新消息到达时滚到底部。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const nextId = (role: string) => {
    seqRef.current += 1;
    return `${role}-${Date.now()}-${seqRef.current}`;
  };

  /** failed=true 标记错误回复（extra.failed），发下一条时不带进上下文历史。 */
  const patch = (id: string, content: string, failed = false) =>
    setMessages((cur) =>
      cur.map((m) =>
        m.id === id ? { ...m, content, updateAt: Date.now(), extra: failed ? { failed: true } : m.extra } : m,
      ),
    );

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const now = Date.now();
    const history = messages
      .filter((m) => m.content.trim() && !(m.extra as { failed?: boolean } | undefined)?.failed)
      .map((m) => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = {
      id: nextId("user"), role: "user", content: text,
      createAt: now, updateAt: now, meta: USER_META,
    };
    const assistantId = nextId("assistant");
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "",
      createAt: now + 1, updateAt: now + 1, meta: ASSISTANT_META,
    };
    setMessages((cur) => [...cur, userMsg, assistantMsg]);
    setInput("");
    setSending(true);
    setLoadingId(assistantId);

    const seq = (runSeqRef.current += 1);
    // 本轮是否仍是“现役”：停止按钮或组件卸载都会让它变 false
    const alive = () => !unmountedRef.current && runSeqRef.current === seq;

    try {
      await ensureSession();
      const res = await aiApi.generate({
        handler: HANDLER,
        modelId: modelId || "default",
        input: { prompt: text, messages: history },
      });
      if (!alive()) return;
      if (!res.success) {
        patch(assistantId, res.message || "发送失败，请重试。", true);
        return;
      }
      let task = res.data;
      activeTaskRef.current = task.id;
      const deadline = Date.now() + MAX_POLL_MS;
      while (
        task.status !== AiTaskStatus.SUCCESS &&
        task.status !== AiTaskStatus.FAILED &&
        task.status !== AiTaskStatus.CANCELLED
      ) {
        if (Date.now() > deadline) {
          patch(assistantId, "回复超时，请稍后重试。", true);
          return;
        }
        await wait(POLL_MS);
        if (!alive()) return;
        const poll = await aiApi.getTask(String(task.id));
        if (!alive()) return;
        if (!poll.success || !poll.data) {
          patch(assistantId, poll.message || "获取回复失败。", true);
          return;
        }
        task = poll.data;
      }
      const ok = task.status === AiTaskStatus.SUCCESS;
      patch(assistantId, ok ? textFromTask(task) : task.errorMsg || "生成失败。", !ok);
    } catch (error) {
      if (alive()) patch(assistantId, (error as Error)?.message || "网络错误，请重试。", true);
    } finally {
      activeTaskRef.current = null;
      if (alive()) {
        setSending(false);
        setLoadingId(undefined);
      }
    }
  };

  /** 停止当前回合：退出本地轮询并 best-effort 取消后端任务（取消即退积分）。 */
  const stop = () => {
    if (!sending) return;
    runSeqRef.current += 1;
    if (loadingId) patch(loadingId, "已停止。", true);
    setSending(false);
    setLoadingId(undefined);
    const taskId = activeTaskRef.current;
    activeTaskRef.current = null;
    if (taskId != null) void aiApi.cancelTask(taskId).catch(() => {});
  };

  return (
    // enableCustomFonts=false：默认会从 npmmirror 拉 geist/harmony webfont 和
    // katex CSS（外链依赖）；字体走项目自己的字体栈，本页不渲染 LaTeX。
    <ThemeProvider themeMode="dark" enableCustomFonts={false}>
      <style>{MD_CSS}</style>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0a0b0e" }}>
        <header
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,.08)", flex: "none",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,.85)" }}>
            对话实验室 <span style={{ color: "rgba(255,255,255,.35)", fontWeight: 400 }}>· @lobehub/ui 验证</span>
          </span>
          <Select
            size="small"
            style={{ minWidth: 200 }}
            value={modelId || undefined}
            placeholder="选择模型"
            onChange={setModelId}
            options={models.map((m) => ({ value: m.modelId, label: m.name }))}
          />
        </header>

        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {messages.length === 0 ? (
            <div
              style={{
                height: "100%", display: "grid", placeItems: "center",
                color: "rgba(255,255,255,.35)", fontSize: 14,
              }}
            >
              发一句话试试 —— 走的是画布助手同款 assistant_chat 链路
            </div>
          ) : (
            <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 0" }}>
              <ChatList
                data={messages}
                loadingId={loadingId}
                showAvatar
                style={{ width: "100%" }}
                renderMessages={{
                  // Streamdown 流式渲染在本环境下不出内容（详见验证记录），
                  // 用静态 Markdown 渲染替代 —— 视觉排版一致，只少了逐字动画。
                  // 等待回复时气泡内给 LoadingDots（ChatItem 的 loading 只作用于头像）。
                  default: (item) =>
                    item.id === loadingId && !item.content ? (
                      <LoadingDots size={6} variant="typing" />
                    ) : (
                      <Markdown className="labmd" variant="chat" enableStream={false}>
                        {String(item.content ?? "")}
                      </Markdown>
                    ),
                }}
              />
            </div>
          )}
        </div>

        <div
          style={{
            flex: "none", position: "relative", maxWidth: 860, width: "100%",
            margin: "0 auto", padding: "0 20px 20px",
          }}
        >
          <ChatInputArea
            expand={false}
            value={input}
            onInput={setInput}
            onSend={send}
            loading={sending}
            placeholder="输入内容，Enter 发送，Shift+Enter 换行…"
            heights={{ minHeight: 88, maxHeight: 320 }}
            bottomAddons={
              <ChatInputActionBar
                rightAddons={
                  <ChatSendButton
                    loading={sending}
                    onSend={send}
                    onStop={stop}
                    texts={{ send: "发送", stop: "停止", warp: "换行" }}
                  />
                }
              />
            }
          />
        </div>
      </div>
    </ThemeProvider>
  );
}
