import { create } from "zustand";
import { imApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { ConversationVO, ConversationType, MessageVO, WSEvent } from "@/types/im";

// WebSocket 基址：
//   - 开发：NEXT_PUBLIC_API_BASE_URL 指向 localhost 后端 → 直连后端（如 http://localhost:8080）。
//   - 生产：走同源（window.location.origin），由反向代理(Caddy)把 /api/im/ws 升级转发到后端。
//   - 可用 NEXT_PUBLIC_WS_URL 显式覆盖（如 ws://localhost:8080 或 wss://your-domain）。
// 浏览器无法用 compose 内网名(backend:8080)，故生产一律同源。
function resolveWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const api = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (api && api.includes("localhost")) return api;
  if (typeof window !== "undefined") return window.location.origin;
  return api || "";
}

// 按 createTime 升序排（不依赖后端返回顺序）。
function sortByTime(list: MessageVO[]): MessageVO[] {
  return [...list].sort((a, b) => a.createTime.localeCompare(b.createTime));
}

interface ImState {
  connected: boolean;
  conversations: ConversationVO[];
  activeId: string | null;
  messages: Record<string, MessageVO[]>; // 会话 id → 消息（按时间升序）
  onlineIds: Set<string>;
  loadingConvs: boolean;
  loadingMsgs: boolean;
  notifUnread: number; // 站内通知未读数（通知中心角标的单一数据源；REST 初始化 + WS 实时 +1）

  connect: () => void;
  disconnect: () => void;
  setNotifUnread: (n: number) => void; // 用 REST unreadCount 结果初始化角标
  bumpNotif: () => void; // 收到通知 WS 事件时角标 +1
  resetNotif: () => void; // 全部已读后角标清零
  loadConversations: (type?: ConversationType) => Promise<void>;
  refreshStatus: (userIds: string[]) => Promise<void>;
  setActive: (id: string | null) => void;
  loadMessages: (convId: string) => Promise<void>;
  send: (convId: string, content: string, contentType?: string) => Promise<boolean>;
  markRead: (convId: string) => Promise<void>;
  recall: (convId: string, msgId: string) => Promise<void>;
  upsertConversation: (c: ConversationVO) => void;
  isOnline: (userId?: string) => boolean;
  totalUnread: () => number;
}

// WebSocket 与重连定时器保存在模块作用域（不进 store，避免无谓 re-render）。
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;

export const useImStore = create<ImState>((set, get) => {
  // 追加一条消息：按 id 去重，并更新会话摘要与未读（自己发的不计未读）。
  const appendMessage = (msg: MessageVO, isSelf: boolean) => {
    set((s) => {
      const convId = msg.conversationId;
      const existing = s.messages[convId] || [];
      if (existing.some((m) => m.id === msg.id)) return s;
      const messages = { ...s.messages, [convId]: [...existing, msg] };
      const activeId = s.activeId;
      const conversations = s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessageText: msg.content,
              lastMessageTime: msg.createTime,
              unread: !isSelf && activeId !== convId ? (c.unread || 0) + 1 : c.unread,
            }
          : c,
      );
      return { messages, conversations };
    });
  };

  // 处理 WebSocket 下行事件。
  const handleEvent = (ev: WSEvent) => {
    switch (ev.type) {
      case "message":
        if (ev.message) {
          // UserVO.id 运行时是 public_id 字符串（前端类型暂标 number，历史债），String() 规避比较告警
          const selfId = useAuthStore.getState().user?.id;
          const isSelf = selfId != null && ev.message.sender?.id === String(selfId);
          appendMessage(ev.message, isSelf);
          // 正在查看的会话：收到对方消息即自动已读。
          if (!isSelf && get().activeId === ev.message.conversationId) {
            void get().markRead(ev.message.conversationId);
          }
        }
        break;
      case "online":
        if (ev.userId) set((s) => { const n = new Set(s.onlineIds); n.add(ev.userId!); return { onlineIds: n }; });
        break;
      case "offline":
        if (ev.userId) set((s) => { const n = new Set(s.onlineIds); n.delete(ev.userId!); return { onlineIds: n }; });
        break;
      case "notification":
        // 新站内通知到达：角标 +1（信封不带正文；打开通知中心时另行 REST 拉全量）。
        set((s) => ({ notifUnread: s.notifUnread + 1 }));
        break;
      default:
        break; // read / system 暂不特殊处理
    }
  };

  return {
    connected: false,
    conversations: [],
    activeId: null,
    messages: {},
    onlineIds: new Set<string>(),
    loadingConvs: false,
    loadingMsgs: false,
    notifUnread: 0,

    setNotifUnread: (n) => set({ notifUnread: Math.max(0, n) }),
    bumpNotif: () => set((s) => ({ notifUnread: s.notifUnread + 1 })),
    resetNotif: () => set({ notifUnread: 0 }),

    connect: () => {
      if (typeof window === "undefined") return;
      const token = localStorage.getItem("access_token");
      if (!token) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      manualClose = false;
      const base = resolveWsBase().replace(/^http/, "ws"); // http→ws, https→wss
      const sock = new WebSocket(`${base}/api/im/ws?token=${encodeURIComponent(token)}`);
      ws = sock;
      sock.onopen = () => set({ connected: true });
      sock.onmessage = (e) => {
        try { handleEvent(JSON.parse(e.data) as WSEvent); } catch { /* 忽略非法帧 */ }
      };
      sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
      sock.onclose = () => {
        set({ connected: false });
        if (ws === sock) ws = null;
        if (!manualClose) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => get().connect(), 3000); // 简单定时重连
        }
      };
    },

    disconnect: () => {
      manualClose = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
      set({ connected: false });
    },

    loadConversations: async (type) => {
      set({ loadingConvs: true });
      const res = await imApi.conversations(type, { pageSize: 100 });
      if (res.success) {
        set({ conversations: res.data.records });
        // 主动拉一次对端在线状态：online 事件只在"上线那刻"广播，对端在本端连接
        // 之前就在线时收不到，故进入会话列表时按 peer/members 查当前在线状态。
        const ids = new Set<string>();
        for (const c of res.data.records) {
          if (c.peer) ids.add(c.peer.id);
          c.members?.forEach((m) => ids.add(m.id));
        }
        if (ids.size > 0) void get().refreshStatus([...ids]);
      }
      set({ loadingConvs: false });
    },

    refreshStatus: async (userIds) => {
      if (userIds.length === 0) return;
      const res = await imApi.status(userIds);
      if (res.success && res.data) {
        set((s) => {
          const next = new Set(s.onlineIds);
          for (const st of res.data) {
            if (st.online) next.add(st.id);
            else next.delete(st.id);
          }
          return { onlineIds: next };
        });
      }
    },

    setActive: (id) => {
      set({ activeId: id });
      if (id) {
        void get().loadMessages(id);
        void get().markRead(id);
      }
    },

    loadMessages: async (convId) => {
      set({ loadingMsgs: true });
      const res = await imApi.messages(convId, { limit: 50 });
      if (res.success) set((s) => ({ messages: { ...s.messages, [convId]: sortByTime(res.data) } }));
      set({ loadingMsgs: false });
    },

    send: async (convId, content, contentType = "text") => {
      const res = await imApi.send({ conversationId: convId, content, contentType });
      if (res.success && res.data) {
        appendMessage(res.data, true); // 乐观追加；WS 回推同 id 会被去重
        return true;
      }
      return false;
    },

    markRead: async (convId) => {
      await imApi.markRead(convId);
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)) }));
    },

    recall: async (convId, msgId) => {
      const res = await imApi.recall(msgId);
      if (res.success) {
        set((s) => ({
          messages: {
            ...s.messages,
            [convId]: (s.messages[convId] || []).map((m) => (m.id === msgId ? { ...m, status: 1 } : m)),
          },
        }));
      }
    },

    upsertConversation: (c) =>
      set((s) => {
        const idx = s.conversations.findIndex((x) => x.id === c.id);
        if (idx >= 0) { const next = [...s.conversations]; next[idx] = c; return { conversations: next }; }
        return { conversations: [c, ...s.conversations] };
      }),

    isOnline: (userId) => (userId ? get().onlineIds.has(userId) : false),
    totalUnread: () => get().conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
  };
});
