"use client";

import { useCallback, useEffect, useState } from "react";
import { Table, Tag, Button, Modal, Input, InputNumber, DatePicker, Select, Space, Typography, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ReloadOutlined, CopyOutlined, DeleteOutlined, StopOutlined, PoweroffOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { RedeemCodeVO } from "@/types/redeem";

const PAGE_SIZE = 20;
const STATUS_TAG: Record<number, { label: string; color: string }> = {
  0: { label: "未使用", color: "green" },
  1: { label: "已使用", color: "default" },
  2: { label: "已停用", color: "red" },
};

export default function AdminRedeemPage() {
  const [list, setList] = useState<RedeemCodeVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [showGen, setShowGen] = useState(false);
  const [genCount, setGenCount] = useState<number | null>(10);
  const [genPoints, setGenPoints] = useState<number | null>(100);
  const [genExpire, setGenExpire] = useState<string>("");
  const [genRemark, setGenRemark] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.redeem.list({ pageNum, pageSize: PAGE_SIZE, ...(statusFilter !== "" ? { status: Number(statusFilter) } : {}) });
      if (res.success) { setList(res.data.records); setTotal(res.data.total); }
    } finally {
      setLoading(false);
    }
  }, [pageNum, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleGenerate = async () => {
    if (!genCount || !genPoints || genCount < 1 || genPoints < 1) { toast.error("数量和积分需大于 0"); return; }
    setGenerating(true);
    try {
      const res = await adminApi.redeem.generate({
        count: genCount, points: genPoints,
        ...(genExpire ? { expireTime: `${genExpire} 23:59:59` } : {}),
        ...(genRemark ? { remark: genRemark } : {}),
      });
      if (res.success) {
        setGeneratedCodes(res.data);
        setShowGen(false);
        toast.success(`已生成 ${res.data.length} 个兑换码`);
        void load();
      } else {
        toast.error(res.message || "生成失败");
      }
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("已复制"); } catch { toast.error("复制失败"); }
  };

  const toggleStatus = async (r: RedeemCodeVO) => {
    if (r.status === 1) { toast.info("已使用的兑换码不可更改"); return; }
    const res = await adminApi.redeem.updateStatus(r.id, r.status === 2 ? 0 : 2);
    if (res.success) void load();
  };

  const del = async (id: number) => {
    const res = await adminApi.redeem.delete(id);
    if (res.success) void load();
  };

  const columns: ColumnsType<RedeemCodeVO> = [
    { title: "兑换码", dataIndex: "code", key: "code", render: (v: string) => <Button type="link" size="small" style={{ fontFamily: "monospace", padding: 0 }} icon={<CopyOutlined />} onClick={() => copyText(v)}>{v}</Button> },
    { title: "积分", dataIndex: "points", key: "points", render: (v: number) => <span style={{ color: "#d97706", fontWeight: 500 }}>+{v}</span> },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => { const t = STATUS_TAG[s] ?? { label: String(s), color: "default" }; return <Tag color={t.color}>{t.label}</Tag>; } },
    { title: "有效期", dataIndex: "expireTime", key: "expireTime", responsive: ["md"], render: (v) => v ? v.replace("T", " ").slice(0, 16) : "永久" },
    { title: "备注", dataIndex: "remark", key: "remark", responsive: ["lg"], ellipsis: true, render: (v) => v || "-" },
    { title: "创建时间", dataIndex: "createTime", key: "createTime", responsive: ["lg"], render: (v) => v?.replace("T", " ").slice(0, 16) },
    {
      title: "操作", key: "action", align: "right", render: (_, r) => (
        <Space size={0}>
          {r.status !== 1 && (
            <Button type="text" size="small" title={r.status === 2 ? "启用" : "停用"}
              icon={r.status === 2 ? <PoweroffOutlined style={{ color: "#16a34a" }} /> : <StopOutlined />}
              onClick={() => toggleStatus(r)} />
          )}
          <Popconfirm title="确定删除该兑换码？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => del(r.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="兑换码"
        desc={`共 ${total} 条`}
        extra={
          <Space>
            <Select style={{ width: 130 }} value={statusFilter} onChange={(v) => { setPageNum(1); setStatusFilter(v); }}
              options={[{ value: "", label: "全部状态" }, { value: "0", label: "未使用" }, { value: "1", label: "已使用" }, { value: "2", label: "已停用" }]} />
            <Button icon={<ReloadOutlined />} onClick={() => void load()} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setShowGen(true); setGeneratedCodes(null); }}>生成兑换码</Button>
          </Space>
        }
      />

      <Table<RedeemCodeVO>
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无兑换码，点击右上角生成" }}
        pagination={{ current: pageNum, pageSize: PAGE_SIZE, total, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: setPageNum }}
      />

      {/* 生成弹窗 */}
      <Modal title="生成兑换码" open={showGen} onCancel={() => setShowGen(false)} onOk={handleGenerate} confirmLoading={generating} okText="确认生成" cancelText="取消">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div><div style={{ marginBottom: 6 }}>数量</div><InputNumber style={{ width: "100%" }} min={1} max={1000} value={genCount} onChange={setGenCount} /></div>
          <div><div style={{ marginBottom: 6 }}>每个兑换积分</div><InputNumber style={{ width: "100%" }} min={1} value={genPoints} onChange={setGenPoints} /></div>
          <div><div style={{ marginBottom: 6 }}>有效期（留空=永久）</div><DatePicker style={{ width: "100%" }} onChange={(_, ds) => setGenExpire(Array.isArray(ds) ? "" : (ds ?? ""))} /></div>
          <div><div style={{ marginBottom: 6 }}>备注</div><Input placeholder="如：双十一活动" value={genRemark} onChange={(e) => setGenRemark(e.target.value)} /></div>
        </div>
      </Modal>

      {/* 生成结果 */}
      <Modal
        title={`已生成 ${generatedCodes?.length ?? 0} 个`}
        open={!!generatedCodes}
        onCancel={() => setGeneratedCodes(null)}
        footer={<Button type="primary" onClick={() => setGeneratedCodes(null)}>完成</Button>}
      >
        <Button size="small" icon={<CopyOutlined />} style={{ marginBottom: 8 }} onClick={() => copyText((generatedCodes ?? []).join("\n"))}>复制全部</Button>
        <Typography.Paragraph>
          <pre style={{ maxHeight: 280, overflow: "auto", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, margin: 0 }}>
            {(generatedCodes ?? []).join("\n")}
          </pre>
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
