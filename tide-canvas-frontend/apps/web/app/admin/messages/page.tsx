"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Avatar, Badge, Button, Empty, Form, Input, List, Segmented, Select, Spin, Tabs, Tag, theme,
} from "antd";
import { CustomerServiceOutlined, MessageOutlined, UsergroupAddOutlined, ReloadOutlined } from "@ant-design/icons";
import { AdminPageHead } from "@/components/admin/page-head";
import { AdminChatWindow, convTitle } from "@/components/admin/admin-chat-window";
import { imApi, adminApi } from "@/lib/api";
import { useImStore } from "@/stores/use-im-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDate } from "@/lib/utils";
import { SupportStatus } from "@/types/im";
import type { ConversationVO } from "@/types/im";

/** 粗略相对时长（用于客服等待时长展示） */
function waitDuration(since: string | null | undefined): string {
  if (!since) return "-";
  const t = new Date(since.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return "-";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时`;
  return `${Math.floor(sec / 86400)} 天`;
}

/** 左右双栏：左侧会话列表，右侧聊天窗 */
function MasterDetail({ left, conversation }: { left: React.ReactNode; conversation: ConversationVO | null }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 260px)",
        minHeight: 420,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        overflow: "hidden",
        background: token.colorBgContainer,
      }}
    >
      <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${token.colorBorderSecondary}`, overflowY: "auto" }}>
        {left}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <AdminChatWindow conversation={conversation} />
      </div>
    </div>
  );
}

/** 会话列表项（我的会话 / 已接入客服共用） */
function ConvListItem({
  conv,
  active,
  onClick,
}: {
  conv: ConversationVO;
  active: boolean;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const isOnline = useImStore((s) => (conv.peer ? s.onlineIds.has(conv.peer.id) : false));
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        cursor: "pointer",
        background: active ? token.colorPrimaryBg : "transparent",
        borderLeft: `3px solid ${active ? token.colorPrimary : "transparent"}`,
      }}
    >
      <Badge dot={!!conv.peer && isOnline} color="green" offset={[-2, 28]}>
        <Avatar src={conv.peer?.avatar || undefined} style={{ background: token.colorPrimary }}>
          {convTitle(conv).charAt(0).toUpperCase()}
        </Avatar>
      </Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: token.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {convTitle(conv)}
          </span>
          {conv.type === "support" && <Tag color="gold" style={{ marginInlineEnd: 0 }}>客服</Tag>}
          {conv.type === "staff" && <Tag color="blue" style={{ marginInlineEnd: 0 }}>同事</Tag>}
        </div>
        <div style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {conv.lastMessageText || "暂无消息"}
        </div>
      </div>
      {conv.unread > 0 && <Badge count={conv.unread} size="small" />}
    </div>
  );
}

/* ----------------------------- 客服工作台 ----------------------------- */
function SupportWorkbench() {
  const { token } = theme.useToken();
  const setActive = useImStore((s) => s.setActive);
  const activeId = useImStore((s) => s.activeId);
  const upsertConversation = useImStore((s) => s.upsertConversation);
  const conversations = useImStore((s) => s.conversations);
  const loadConversations = useImStore((s) => s.loadConversations);

  const [waiting, setWaiting] = useState<ConversationVO[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadWaiting = useCallback(async () => {
    setLoadingQueue(true);
    setError("");
    try {
      const res = await imApi.supportWaiting({ pageSize: 100 });
      if (res.success) setWaiting(res.data.records);
      else setError(res.message || "加载待接入队列失败");
    } catch {
      setError("加载待接入队列失败");
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadWaiting();
    void loadConversations("support"); // 已接入/历史客服会话
  }, [loadWaiting, loadConversations]);

  const accept = async (conv: ConversationVO) => {
    if (acceptingId) return;
    setAcceptingId(conv.id);
    setError("");
    try {
      const res = await imApi.supportAccept(conv.id);
      if (res.success && res.data) {
        upsertConversation(res.data);
        setWaiting((w) => w.filter((c) => c.id !== conv.id));
        setActive(res.data.id);
      } else {
        setError(res.message || "接入失败");
      }
    } catch {
      setError("接入失败");
    } finally {
      setAcceptingId(null);
    }
  };

  // 已接入/进行中的客服会话（从 store 的 support 会话里取）
  const mySupport = useMemo(
    () => conversations.filter((c) => c.type === "support" && c.status !== SupportStatus.WAITING),
    [conversations],
  );
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  const left = (
    <div>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>待接入队列 {waiting.length > 0 && <Badge count={waiting.length} size="small" />}</span>
        <Button type="text" size="small" icon={<ReloadOutlined />} onClick={loadWaiting} loading={loadingQueue} />
      </div>
      {loadingQueue ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
      ) : waiting.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无等待用户" style={{ padding: "24px 0" }} />
      ) : (
        waiting.map((c) => (
          <div key={c.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar size={28} src={c.peer?.avatar || undefined} style={{ background: token.colorPrimary }}>
                {(c.peer?.nickname || convTitle(c)).charAt(0).toUpperCase()}
              </Avatar>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.peer?.nickname || convTitle(c)}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>等待 {waitDuration(c.updateTime || c.lastMessageTime)}</div>
              </div>
              <Button type="primary" size="small" loading={acceptingId === c.id} onClick={() => accept(c)}>
                接入
              </Button>
            </div>
            {c.lastMessageText && (
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4, paddingLeft: 36, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.lastMessageText}
              </div>
            )}
          </div>
        ))
      )}

      <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        进行中 / 历史会话
      </div>
      {mySupport.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无客服会话" style={{ padding: "16px 0" }} />
      ) : (
        mySupport.map((c) => <ConvListItem key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)} />)
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} />}
      <MasterDetail left={left} conversation={activeConv} />
    </div>
  );
}

/* ----------------------------- 我的会话 ----------------------------- */
function MyConversations() {
  const { token } = theme.useToken();
  const conversations = useImStore((s) => s.conversations);
  const loadConversations = useImStore((s) => s.loadConversations);
  const loadingConvs = useImStore((s) => s.loadingConvs);
  const setActive = useImStore((s) => s.setActive);
  const activeId = useImStore((s) => s.activeId);
  const [scope, setScope] = useState<"user" | "staff">("user");

  useEffect(() => {
    void loadConversations(); // 全部类型
  }, [loadConversations]);

  // 用户私信：与用户/客户的会话（私信 + 客服）；员工私信：后台同事会话
  const userConvs = useMemo(() => conversations.filter((c) => c.type !== "staff"), [conversations]);
  const staffConvs = useMemo(() => conversations.filter((c) => c.type === "staff"), [conversations]);
  const shown = scope === "staff" ? staffConvs : userConvs;

  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  const left = (
    <div>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Segmented
          block
          size="small"
          value={scope}
          onChange={(v) => setScope(v as "user" | "staff")}
          style={{ flex: 1 }}
          options={[
            { label: `用户私信${userConvs.length ? ` ${userConvs.length}` : ""}`, value: "user" },
            { label: `员工私信${staffConvs.length ? ` ${staffConvs.length}` : ""}`, value: "staff" },
          ]}
        />
        <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => loadConversations()} loading={loadingConvs} />
      </div>
      {loadingConvs && conversations.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><Spin /></div>
      ) : shown.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={scope === "staff" ? "暂无员工会话" : "暂无用户会话"} style={{ padding: "24px 0" }} />
      ) : (
        shown.map((c) => <ConvListItem key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)} />)
      )}
    </div>
  );

  return <MasterDetail left={left} conversation={activeConv} />;
}

/* ----------------------------- 发起后台会话 ----------------------------- */
interface ColleagueOption {
  value: string; // public_id
  label: string;
  avatar: string;
}

function NewStaffConversation({ onOpened }: { onOpened: () => void }) {
  const selfId = useAuthStore((s) => (s.user ? String(s.user.id) : ""));
  const setActive = useImStore((s) => s.setActive);
  const upsertConversation = useImStore((s) => s.upsertConversation);

  const [options, setOptions] = useState<ColleagueOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const searchSeq = useRef(0);

  const searchUsers = useCallback(
    async (keyword: string) => {
      const seq = ++searchSeq.current;
      setSearching(true);
      try {
        const res = await adminApi.users.list({ pageNum: 1, pageSize: 20, keyword: keyword || undefined });
        if (seq !== searchSeq.current) return; // 丢弃过期响应
        if (res.success) {
          setOptions(
            res.data.records
              // user.id 运行时为 public_id（后端 AdminUserVO.id=public_id）；排除自己
              .map((u) => ({ value: String(u.id), label: `${u.nickname || u.username}（${u.username}）`, avatar: u.avatar }))
              .filter((o) => o.value !== selfId),
          );
        }
      } catch {
        /* 忽略搜索错误 */
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [selfId],
  );

  // 首屏加载一批用户
  useEffect(() => {
    void searchUsers("");
  }, [searchUsers]);

  const submit = async () => {
    if (memberIds.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await imApi.openStaff({ memberIds, title: title.trim() || undefined });
      if (res.success && res.data) {
        upsertConversation(res.data);
        setActive(res.data.id);
        setMemberIds([]);
        setTitle("");
        onOpened(); // 切到「我的会话」查看
      } else {
        setError(res.message || "创建会话失败");
      }
    } catch {
      setError("创建会话失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 520 }}>
      {error && <Alert type="error" message={error} showIcon closable onClose={() => setError("")} style={{ marginBottom: 16 }} />}
      <Form layout="vertical">
        <Form.Item label="选择同事" required help="支持搜索昵称 / 用户名；可多选发起群聊">
          <Select<string[]>
            mode="multiple"
            value={memberIds}
            onChange={setMemberIds}
            placeholder="搜索并选择一个或多个同事"
            showSearch
            filterOption={false}
            onSearch={searchUsers}
            loading={searching}
            notFoundContent={searching ? <Spin size="small" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配用户" />}
            optionLabelProp="label"
            options={options.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        </Form.Item>
        <Form.Item label="会话标题" help="可选；多人会话建议填写，留空则用成员昵称">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：内容审核协作" maxLength={50} />
        </Form.Item>
        <Button type="primary" icon={<UsergroupAddOutlined />} loading={submitting} disabled={memberIds.length === 0} onClick={submit}>
          创建并打开会话
        </Button>
      </Form>
    </div>
  );
}

/* ----------------------------- 页面 ----------------------------- */
export default function AdminMessagesPage() {
  const connect = useImStore((s) => s.connect);
  const setActive = useImStore((s) => s.setActive);
  const [tab, setTab] = useState("support");

  // 进入工作台即建立 WS（幂等）
  useEffect(() => {
    connect();
  }, [connect]);

  // 切换分区时清空当前激活会话，避免跨分区串台
  const onTabChange = (key: string) => {
    setActive(null);
    setTab(key);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="消息" desc="接待用户客服、与后台同事沟通" />
      <Tabs
        activeKey={tab}
        onChange={onTabChange}
        items={[
          {
            key: "support",
            label: (<span><CustomerServiceOutlined /> 客服工作台</span>),
            children: <SupportWorkbench />,
          },
          {
            key: "mine",
            label: (<span><MessageOutlined /> 我的会话</span>),
            children: <MyConversations />,
          },
          {
            key: "new",
            label: (<span><UsergroupAddOutlined /> 发起后台会话</span>),
            children: <NewStaffConversation onOpened={() => onTabChange("mine")} />,
          },
        ]}
      />
    </div>
  );
}
