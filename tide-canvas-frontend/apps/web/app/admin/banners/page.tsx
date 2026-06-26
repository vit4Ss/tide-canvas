"use client";

import { useEffect, useState } from "react";
import { Table, Button, Modal, Input, InputNumber, Select, Tag, Space, Image as AntdImage, Upload, Popconfirm } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeInvisibleOutlined, EyeOutlined, UploadOutlined, LinkOutlined } from "@ant-design/icons";
import { adminApi, uploadFileSmart } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import type { BannerVO, BannerCreateDTO } from "@/types/admin";

interface BannerForm {
  title: string;
  imageUrl: string;
  linkUrl: string;
  sortOrder: number;
  status: number;
}

const emptyForm: BannerForm = { title: "", imageUrl: "", linkUrl: "", sortOrder: 0, status: 1 };

export default function AdminBannersPage() {
  const can = useHasPerm();
  const [banners, setBanners] = useState<BannerVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BannerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadBanners = async () => {
    setLoading(true);
    try {
      const res = await adminApi.banners.list();
      if (res.success) {
        const data = Array.isArray(res.data) ? res.data : [];
        setBanners(data.sort((a, b) => a.sortOrder - b.sortOrder));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBanners(); }, []);

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true); };
  const openEdit = (b: BannerVO) => {
    setEditingId(b.id);
    setForm({ title: b.title, imageUrl: b.imageUrl, linkUrl: b.linkUrl ?? "", sortOrder: b.sortOrder, status: b.status });
    setFormOpen(true);
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    setUploading(true);
    try {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) { setForm((p) => ({ ...p, imageUrl: res.data!.fileUrl })); toast.success("图片已上传"); }
      else toast.error(res.message || "上传失败");
    } catch { toast.error("上传失败，请重试"); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!form.title || !form.imageUrl) { toast.error("请填写标题并上传图片"); return; }
    setSaving(true);
    try {
      const payload: BannerCreateDTO = { title: form.title, imageUrl: form.imageUrl, linkUrl: form.linkUrl || undefined, sortOrder: form.sortOrder, status: form.status };
      const res = editingId ? await adminApi.banners.update(editingId, payload) : await adminApi.banners.create(payload);
      if (res.success) { toast.success("已保存"); setFormOpen(false); setForm(emptyForm); setEditingId(null); loadBanners(); }
      else toast.error(res.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (b: BannerVO) => {
    await adminApi.banners.update(b.id, { status: b.status === 1 ? 0 : 1 });
    loadBanners();
  };

  const handleDelete = async (id: string) => {
    const res = await adminApi.banners.delete(id);
    if (res.success) loadBanners();
  };

  const columns: ColumnsType<BannerVO> = [
    { title: "预览", dataIndex: "imageUrl", key: "imageUrl", render: (v: string) => v ? <AntdImage src={v} width={96} height={40} style={{ objectFit: "cover", borderRadius: 6 }} /> : "-" },
    { title: "标题", dataIndex: "title", key: "title", render: (v) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: "跳转链接", dataIndex: "linkUrl", key: "linkUrl", responsive: ["md"], ellipsis: true, render: (v: string) => v ? <a href={v} target="_blank" rel="noopener noreferrer"><LinkOutlined /> {v}</a> : <span style={{ color: "#bfbfbf" }}>-</span> },
    { title: "排序", dataIndex: "sortOrder", key: "sortOrder", width: 80 },
    { title: "状态", dataIndex: "status", key: "status", render: (s: number) => s === 1 ? <Tag color="green">显示</Tag> : <Tag>隐藏</Tag> },
    {
      title: "操作", key: "action", render: (_, b) => (
        <Space size={0}>
          {can("banner:manage") && <Button type="text" size="small" icon={b.status === 1 ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => handleToggle(b)}>{b.status === 1 ? "隐藏" : "显示"}</Button>}
          {can("banner:manage") && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(b)}>编辑</Button>}
          {can("banner:manage") && (
            <Popconfirm title={`删除 Banner「${b.title}」？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(b.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="Banner 管理"
        desc={`共 ${banners.length} 个 Banner，${banners.filter((b) => b.status === 1).length} 个显示中`}
        extra={can("banner:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增 Banner</Button>}
      />

      <Table<BannerVO>
        rowKey="id"
        columns={columns}
        dataSource={banners}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无 Banner，点击右上角添加" }}
        pagination={false}
      />

      <Modal title={editingId ? "编辑 Banner" : "新增 Banner"} open={formOpen} onCancel={() => setFormOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={560}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          <div><div style={{ marginBottom: 6 }}>标题 *</div><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Banner 标题" /></div>
          <div>
            <div style={{ marginBottom: 6 }}>图片 *</div>
            <Space.Compact style={{ width: "100%" }}>
              <Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="图片 URL，或点击右侧上传" />
              <Upload showUploadList={false} beforeUpload={(file) => { handleUpload(file as File); return false; }}>
                <Button icon={<UploadOutlined />} loading={uploading}>上传</Button>
              </Upload>
            </Space.Compact>
            {form.imageUrl && <AntdImage src={form.imageUrl} width="100%" height={120} style={{ objectFit: "cover", borderRadius: 8, marginTop: 8 }} />}
          </div>
          <div><div style={{ marginBottom: 6 }}>跳转链接</div><Input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://example.com/page（可选）" /></div>
          <Space size="large">
            <div><div style={{ marginBottom: 6 }}>排序（越小越前）</div><InputNumber min={0} value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v ?? 0 })} /></div>
            <div><div style={{ marginBottom: 6 }}>状态</div><Select style={{ width: 120 }} value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: 1, label: "显示" }, { value: 0, label: "隐藏" }]} /></div>
          </Space>
        </div>
      </Modal>
    </div>
  );
}
