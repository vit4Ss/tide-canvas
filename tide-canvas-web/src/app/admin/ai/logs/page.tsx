"use client";

import { useCallback, useEffect, useState } from "react";
import { Table, Tag, Button, Modal, Input, Select, Segmented, Space, Descriptions, Tooltip, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, RollbackOutlined, StopOutlined } from "@ant-design/icons";
import { adminApi, type BanInfo } from "@/lib/api";
import { toast } from "@/components/shared";
import { AdminPageHead } from "@/components/admin/page-head";
import { formatDate } from "@/lib/utils";
import type { AiGenerationLogVO } from "@/types/ai";

const PAGE_SIZE = 20;

const OP_TYPE_OPTIONS = [
  { value: "", label: "全部" },
  { value: "ai_generate", label: "AI 生成" },
  { value: "file_upload", label: "文件上传" },
  { value: "file_delete", label: "文件删除" },
  { value: "asset_save", label: "保存素材" },
  { value: "abuse_block", label: "刷流拦截" },
];
const OP_TYPE_LABEL: Record<string, string> = { ai_generate: "AI 生成", file_upload: "文件上传", file_delete: "文件删除", asset_save: "保存素材", abuse_block: "刷流拦截" };
const OP_TYPE_COLOR: Record<string, string> = { ai_generate: "purple", file_upload: "blue", file_delete: "gold", asset_save: "green", abuse_block: "red" };
const OP_LABEL: Record<string, string> = { t2i: "文生图", i2i: "图生图", t2v: "文生视频", i2v: "图生视频", keyframe: "首尾帧", omni_ref: "全能参考", generation: "文生图", edits: "图生图", video: "视频" };
const TASK_STATUS: Record<number, string> = { 0: "处理中", 1: "成功", 2: "失败", 3: "已取消" };

function pretty(s?: string): string | undefined {
  if (!s) return s;
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}
function fmtRemain(seconds: number): string {
  if (!seconds || seconds <= 0) return "已过期";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)} 分`;
}

function CodeBlock({ label, text, danger }: { label: string; text?: string; danger?: boolean }) {
  if (!text) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#bfbfbf", marginBottom: 4 }}>{label}</div>
      <pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", borderRadius: 8, padding: 12, fontSize: 12, margin: 0, fontFamily: "monospace", border: `1px solid ${danger ? "#ffccc7" : "var(--ant-color-border-secondary, #f0f0f0)"}`, background: danger ? "#fff2f0" : "var(--ant-color-fill-quaternary, #fafafa)", color: danger ? "#cf1322" : undefined }}>{text}</pre>
    </div>
  );
}

export default function AdminAiLogsPage() {
  const [logs, setLogs] = useState<AiGenerationLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [operationType, setOperationType] = useState("");
  const [success, setSuccess] = useState<"" | "0" | "1">("");
  const [taskIdInput, setTaskIdInput] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [taskId, setTaskId] = useState<number | undefined>();
  const [userId, setUserId] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [costSum, setCostSum] = useState(0);
  const [detail, setDetail] = useState<AiGenerationLogVO | null>(null);

  const [refundTarget, setRefundTarget] = useState<AiGenerationLogVO | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  const [bansOpen, setBansOpen] = useState(false);
  const [bans, setBans] = useState<BanInfo[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banType, setBanType] = useState<"user" | "ip">("user");
  const [banValue, setBanValue] = useState("");
  const [banMinutes, setBanMinutes] = useState("10");
  const [banReason, setBanReason] = useState("");

  const load = useCallback(async () => {
    const filters = {
      ...(operationType ? { operationType } : {}),
      ...(success !== "" ? { success: Number(success) } : {}),
      ...(taskId != null ? { taskId } : {}),
      ...(userId != null ? { userId } : {}),
    };
    try {
      const [res, sumRes] = await Promise.all([
        adminApi.ai.logs.list({ pageNum, pageSize: PAGE_SIZE, ...filters }),
        adminApi.ai.logs.costSum({ pageNum: 1, pageSize: 1, ...filters }),
      ]);
      if (res.success) { setLogs(res.data.records); setTotal(res.data.total); }
      if (sumRes.success) setCostSum(Number(sumRes.data) || 0);
    } finally {
      setLoading(false);
    }
  }, [pageNum, operationType, success, taskId, userId]);

  useEffect(() => { void load(); }, [load]);

  const applySearch = () => {
    setPageNum(1);
    const tid = taskIdInput.trim();
    const uid = userIdInput.trim();
    setTaskId(tid && /^\d+$/.test(tid) ? Number(tid) : undefined);
    setUserId(uid && /^\d+$/.test(uid) ? Number(uid) : undefined);
  };

  const handleRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    try {
      const res = await adminApi.points.refundTask({ taskId: refundTarget.taskId, reason: refundReason.trim() || undefined });
      if (res.success) { toast.success(`已退还 ${res.data} 积分`); setRefundTarget(null); setRefundReason(""); void load(); }
      else toast.error(res.message || "退款失败");
    } finally {
      setRefunding(false);
    }
  };

  const loadBans = useCallback(async () => {
    setBansLoading(true);
    try {
      const res = await adminApi.security.bans();
      if (res.success) setBans(res.data || []);
    } finally {
      setBansLoading(false);
    }
  }, []);

  const handleUnban = async (actor: string) => {
    const res = await adminApi.security.unban(actor);
    if (res.success) { toast.success("已解封"); void loadBans(); } else toast.error(res.message || "解封失败");
  };

  const handleManualBan = async () => {
    if (!banValue.trim()) { toast.error("请输入用户ID或IP"); return; }
    const minutes = Number(banMinutes) || 10;
    const res = await adminApi.security.ban({ type: banType, value: banValue.trim(), seconds: minutes * 60, reason: banReason.trim() || undefined });
    if (res.success) { toast.success("已封禁"); setBanValue(""); setBanReason(""); void loadBans(); } else toast.error(res.message || "封禁失败");
  };

  const columns: ColumnsType<AiGenerationLogVO> = [
    { title: "时间", dataIndex: "createTime", key: "createTime", render: (v: string) => <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)", whiteSpace: "nowrap" }}>{v ? formatDate(v) : "-"}</span> },
    { title: "类型", dataIndex: "operationType", key: "operationType", render: (t: string) => <Tag color={OP_TYPE_COLOR[t] || "default"}>{OP_TYPE_LABEL[t] || t || "AI 生成"}</Tag> },
    { title: "用户", key: "user", render: (_, l) => <span style={{ fontSize: 12 }}>{l.userName || "-"}{l.userId != null && <span style={{ color: "#bfbfbf" }}> #{l.userId}</span>}</span> },
    { title: "画布", dataIndex: "projectName", key: "projectName", responsive: ["lg"], ellipsis: true, render: (v) => v || "-" },
    { title: "任务ID", dataIndex: "taskId", key: "taskId", responsive: ["md"], render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--ant-color-text-secondary, #8c8c8c)" }}>{v ?? "-"}</span> },
    {
      title: "内容", key: "operation", render: (_, l) => { const isAi = l.operationType === "ai_generate" || !l.operationType; return isAi ? <span style={{ fontSize: 12 }}>{OP_LABEL[l.operation] || l.operation || "-"}{l.model && <span style={{ fontFamily: "monospace", color: "#bfbfbf" }}> {l.model}</span>}</span> : (l.operation || "-"); },
    },
    { title: "状态", dataIndex: "success", key: "success", render: (s: number, l) => s === 1 ? <Tag color="green">成功</Tag> : <Tag color="red">失败 {l.httpStatus || ""}</Tag> },
    { title: "耗时", dataIndex: "durationMs", key: "durationMs", responsive: ["lg"], render: (v) => v != null ? `${(v / 1000).toFixed(1)}s` : "-" },
    { title: "成本", dataIndex: "cost", key: "cost", responsive: ["lg"], render: (v) => v != null ? <span style={{ fontFamily: "monospace", color: "#16a34a" }}>${Number(v).toFixed(4)}</span> : "-" },
    {
      title: "操作", key: "action", align: "right", render: (_, l) => {
        const canRefund = (l.operationType === "ai_generate" || !l.operationType) && l.taskId != null;
        return (
          <Space size={0}>
            {canRefund && <Tooltip title="按该任务实际扣分全额退还"><Button type="text" size="small" icon={<RollbackOutlined />} style={{ color: "#d97706" }} onClick={() => { setRefundTarget(l); setRefundReason(""); }}>退积分</Button></Tooltip>}
            <Button type="link" size="small" onClick={() => setDetail(l)}>详情</Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="操作日志"
        desc={`共 ${total} 条`}
        extra={
          <Space>
            {costSum > 0 && <Tag color="green">上游成本 ${costSum.toFixed(4)}</Tag>}
            <Button danger icon={<StopOutlined />} onClick={() => { setBansOpen(true); void loadBans(); }}>封禁管理</Button>
            <Button icon={<ReloadOutlined />} onClick={() => load()}>刷新</Button>
          </Space>
        }
      />

      <Space wrap>
        <Segmented options={OP_TYPE_OPTIONS} value={operationType} onChange={(v) => { setPageNum(1); setOperationType(String(v)); }} />
        <Input placeholder="用户ID" style={{ width: 110 }} value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} onPressEnter={applySearch} allowClear />
        <Input placeholder="任务ID" style={{ width: 140 }} value={taskIdInput} onChange={(e) => setTaskIdInput(e.target.value)} onPressEnter={applySearch} allowClear />
        <Select style={{ width: 120 }} value={success} onChange={(v) => { setPageNum(1); setSuccess(v); }}
          options={[{ value: "", label: "全部状态" }, { value: "1", label: "成功" }, { value: "0", label: "失败" }]} />
        <Button type="primary" onClick={applySearch}>搜索</Button>
      </Space>

      <Table<AiGenerationLogVO>
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无日志" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
      />

      {/* 详情 */}
      <Modal title={`操作日志 #${detail?.id ?? ""}`} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={760}>
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered items={[
              { key: "type", label: "类型", children: OP_TYPE_LABEL[detail.operationType] || detail.operationType || "AI 生成" },
              { key: "user", label: "用户", children: detail.userName ? `${detail.userName} (#${detail.userId})` : String(detail.userId ?? "-") },
              { key: "proj", label: "画布", children: detail.projectName || (detail.projectId ? `#${detail.projectId}` : "-") },
              { key: "task", label: "任务ID", children: String(detail.taskId ?? "-") },
              { key: "tstatus", label: "任务状态", children: detail.taskStatus != null ? (TASK_STATUS[detail.taskStatus] ?? String(detail.taskStatus)) : "-" },
              { key: "handler", label: "Handler", children: detail.handlerName || "-" },
              { key: "model", label: "模型", children: detail.model || "-" },
              { key: "op", label: "操作", children: OP_LABEL[detail.operation] || detail.operation || "-" },
              { key: "http", label: "HTTP", children: String(detail.httpStatus ?? "-") },
              { key: "up", label: "上游任务ID", children: detail.upstreamTaskId || "-" },
              { key: "dur", label: "耗时", children: detail.durationMs != null ? `${detail.durationMs} ms` : "-" },
              { key: "cost", label: "成本(USD)", children: detail.cost != null ? `$${Number(detail.cost).toFixed(4)}` : "-" },
            ]} />
            {detail.requestUrl && <CodeBlock label="上游请求地址" text={detail.requestUrl} />}
            {detail.inputParams && <CodeBlock label="用户输入参数（前端 → 后端）" text={pretty(detail.inputParams)} />}
            <CodeBlock label="上游请求体（后端 → 供应商）" text={pretty(detail.requestBody)} />
            <CodeBlock label="上游响应体" text={pretty(detail.responseBody)} />
            {detail.errorMsg && <CodeBlock label="错误" text={detail.errorMsg} danger />}
            {detail.resultUrl && <CodeBlock label="结果地址" text={detail.resultUrl} />}
          </>
        )}
      </Modal>

      {/* 退积分 */}
      <Modal title="退还积分" open={!!refundTarget} onCancel={() => setRefundTarget(null)} onOk={handleRefund} confirmLoading={refunding} okText="确认退还" cancelText="取消" okButtonProps={{ style: { background: "#d97706", borderColor: "#d97706" } }}>
        {refundTarget && (
          <div style={{ paddingTop: 8 }}>
            <p style={{ color: "var(--ant-color-text-secondary, #8c8c8c)" }}>将按任务 <b style={{ fontFamily: "monospace" }}>#{refundTarget.taskId}</b> 的实际扣分<b>全额退还</b>给用户{refundTarget.userName ? ` ${refundTarget.userName}` : ""}。重复退款会被自动拦截。</p>
            <Input.TextArea rows={3} placeholder="退款原因（可选，将记入积分流水）" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} style={{ marginTop: 12 }} />
          </div>
        )}
      </Modal>

      {/* 封禁管理 */}
      <Modal title="封禁管理" open={bansOpen} onCancel={() => setBansOpen(false)} footer={null} width={680}>
        <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
          <Select style={{ width: 100 }} value={banType} onChange={setBanType} options={[{ value: "user", label: "用户ID" }, { value: "ip", label: "IP" }]} />
          <Input placeholder={banType === "user" ? "用户ID" : "IP 地址"} value={banValue} onChange={(e) => setBanValue(e.target.value)} />
          <Input placeholder="分钟" style={{ width: 80 }} value={banMinutes} onChange={(e) => setBanMinutes(e.target.value)} />
          <Input placeholder="原因(可选)" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
          <Button danger type="primary" onClick={handleManualBan}>封禁</Button>
        </Space.Compact>
        <Table<BanInfo>
          rowKey="actor"
          size="small"
          loading={bansLoading}
          dataSource={bans}
          pagination={false}
          locale={{ emptyText: "暂无封禁" }}
          columns={[
            { title: "类型", dataIndex: "type", render: (t) => t === "ip" ? "IP" : t === "user" ? "用户" : t },
            { title: "目标", dataIndex: "value", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{v}</span> },
            { title: "原因", dataIndex: "reason", ellipsis: true, render: (v) => v || "-" },
            { title: "剩余", dataIndex: "expireSeconds", render: (v) => fmtRemain(v) },
            { title: "", key: "act", align: "right", render: (_, b) => <Popconfirm title="确定解封？" okText="解封" cancelText="取消" onConfirm={() => handleUnban(b.actor)}><Button type="link" size="small">解封</Button></Popconfirm> },
          ]}
        />
      </Modal>
    </div>
  );
}
