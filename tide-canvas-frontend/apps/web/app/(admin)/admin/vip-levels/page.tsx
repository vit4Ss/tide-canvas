"use client";

import { useEffect, useState } from "react";
import { Card, Table, InputNumber, Input, Button, Space, Popconfirm, Skeleton } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, SaveOutlined, DeleteOutlined } from "@ant-design/icons";
import { adminApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { VipLevelVO } from "@/types/admin";

export default function AdminVipLevelsPage() {
  const can = useHasPerm();
  const [levels, setLevels] = useState<VipLevelVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.vipLevels.list();
      if (res.success && res.data) {
        setLevels(res.data.length ? res.data : [{ level: 1, name: "VIP1", concurrency: 0 }]);
      }
    } catch {
      toast.error("加载等级配置失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (idx: number, patch: Partial<VipLevelVO>) =>
    setLevels((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLevel = () => {
    const maxLv = levels.reduce((m, l) => Math.max(m, l.level), 0);
    setLevels((prev) => [...prev, { level: maxLv + 1, name: `VIP${maxLv + 1}`, concurrency: 0 }]);
  };
  const removeLevel = (idx: number) => setLevels((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    // 校验：等级 ≥ 1 且不重复
    const seen = new Set<number>();
    for (const l of levels) {
      if (l.level < 1) { toast.error("等级必须 ≥ 1"); return; }
      if (seen.has(l.level)) { toast.error(`等级 ${l.level} 重复`); return; }
      seen.add(l.level);
    }
    setSaving(true);
    try {
      const res = await adminApi.vipLevels.save(levels);
      if (res.success) toast.success("已保存");
      else toast.error(res.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<VipLevelVO> = [
    { title: "等级", dataIndex: "level", width: 130, render: (v: number, _r, idx) => <InputNumber min={1} value={v} onChange={(n) => update(idx, { level: n ?? 1 })} style={{ width: "100%" }} /> },
    { title: "名称", dataIndex: "name", render: (v: string, _r, idx) => <Input value={v} onChange={(e) => update(idx, { name: e.target.value })} placeholder="如 VIP1 / 黄金会员" /> },
    { title: "AI 并发上限（0=不限）", dataIndex: "concurrency", width: 210, render: (v: number, _r, idx) => <InputNumber min={0} value={v} onChange={(n) => update(idx, { concurrency: n ?? 0 })} style={{ width: "100%" }} /> },
    { title: "操作", width: 80, render: (_v, _r, idx) => <Popconfirm title="删除该等级？" onConfirm={() => removeLevel(idx)} okText="删除" cancelText="取消"><Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={levels.length <= 1} /></Popconfirm> },
  ];

  const saveBtn = can("setting:edit") ? <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="会员等级" desc="自定义会员等级与各等级的 AI 并发上限；在「用户管理」里给用户分配等级" extra={saveBtn} />
      {loading ? (
        <Card><Skeleton active paragraph={{ rows: 4 }} /></Card>
      ) : (
        <Card>
          <Table<VipLevelVO> rowKey={(_r, i) => String(i ?? 0)} columns={columns} dataSource={levels} pagination={false} size="middle" />
          <div style={{ marginTop: 16 }}>
            <Space>
              <Button icon={<PlusOutlined />} onClick={addLevel}>新增一档</Button>
              {saveBtn}
            </Space>
          </div>
        </Card>
      )}
    </div>
  );
}
