"use client";

import { useEffect, useState } from "react";
import { Table, InputNumber, Button, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CoinsIcon } from "lucide-react";
import { SaveOutlined, CheckOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { AdminPageHead } from "@/components/admin/page-head";

interface HandlerRow {
  handlerName: string;
  displayName: string;
  description: string;
  pointCost: number;
}

export default function AdminAiHandlersPage() {
  const can = useHasPerm();
  const [handlers, setHandlers] = useState<HandlerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.ai.handlers.list();
      if (res.success) setHandlers(res.data as unknown as HandlerRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setCost = (name: string, cost: number | null) => {
    setHandlers((prev) => prev.map((h) => (h.handlerName === name ? { ...h, pointCost: cost ?? 0 } : h)));
  };

  const handleSave = async (h: HandlerRow) => {
    setSavingName(h.handlerName);
    setSavedName(null);
    try {
      const res = await adminApi.ai.handlers.update(h.handlerName, { pointCost: Math.max(0, h.pointCost ?? 0) });
      if (res.success) {
        setSavedName(h.handlerName);
        setTimeout(() => setSavedName((cur) => (cur === h.handlerName ? null : cur)), 2000);
      }
    } finally {
      setSavingName(null);
    }
  };

  const columns: ColumnsType<HandlerRow> = [
    {
      title: "能力", key: "displayName", render: (_, h) => (
        <Space>
          <span style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, background: "#fff7e6", color: "#d97706" }}>
            <CoinsIcon size={16} />
          </span>
          <div>
            <div style={{ fontWeight: 500 }}>{h.displayName}</div>
            {h.description && <div style={{ fontSize: 12, color: "#bfbfbf" }}>{h.description}</div>}
          </div>
        </Space>
      ),
    },
    { title: "标识", dataIndex: "handlerName", key: "handlerName", render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{v}</span> },
    {
      title: "消耗积分", key: "pointCost", render: (_, h) => (
        <InputNumber min={0} value={h.pointCost ?? 0} onChange={(v) => setCost(h.handlerName, v)} style={{ width: 120 }} prefix={<CoinsIcon size={13} color="#f59e0b" />} />
      ),
    },
    {
      title: "操作", key: "action", render: (_, h) => (
        can("handler:manage") && (
          savedName === h.handlerName
            ? <Button size="small" type="primary" icon={<CheckOutlined />} ghost>已保存</Button>
            : <Button size="small" type="primary" icon={<SaveOutlined />} loading={savingName === h.handlerName} onClick={() => handleSave(h)}>保存</Button>
        )
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="Handler 积分配置" desc="配置各 AI 能力每次调用消耗的积分，前台生成时按此扣减" />
      <Table<HandlerRow>
        rowKey="handlerName"
        columns={columns}
        dataSource={handlers}
        loading={loading}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无 Handler 数据" }}
      />
    </div>
  );
}
