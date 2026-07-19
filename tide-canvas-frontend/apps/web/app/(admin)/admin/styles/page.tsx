"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Form, Image as AntdImage, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { adminApi, uploadFileSmart } from "@/lib/api";
import { AdminPageHead } from "@/components/admin/page-head";
import { toast } from "@/components/shared/toast";
import { useHasPerm } from "@/stores/use-permission-store";
import { AiModelType, type AiModelVO } from "@/types/ai";
import type { StylePresetSaveDTO, StylePresetVO } from "@/types/style";

interface StyleFormValues {
  name: string;
  shortName?: string;
  category?: string;
  authorName?: string;
  description?: string;
  prompt: string;
  coverUrl?: string;
  tags?: string;
  modelIds?: string[];
  modelPrompts?: Record<string, string>;
  sortOrder?: number;
  status?: number;
  commercial?: boolean;
  publicFlag?: boolean;
  official?: boolean;
}

const defaultCategory = "推荐";
const categoryOptions = [defaultCategory, "Midjourney", "摄影写真", "电商营销", "动漫游戏", "风格插画", "平面设计", "建筑及室内设计", "创意玩法", "文创周边", "小说推文"];

function cleanModelIds(ids?: string[]) {
  const seen = new Set<string>();
  return (ids ?? [])
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function cleanModelPrompts(modelPrompts: Record<string, string> | undefined, modelIds: string[]) {
  const allowed = new Set(modelIds);
  return Object.fromEntries(
    Object.entries(modelPrompts ?? {})
      .map(([modelId, prompt]) => [modelId.trim(), prompt.trim()] as const)
      .filter(([modelId, prompt]) => modelId && prompt && allowed.has(modelId)),
  );
}

function formToPayload(values: StyleFormValues): StylePresetSaveDTO {
  const modelIds = cleanModelIds(values.modelIds);
  return {
    name: values.name.trim(),
    shortName: values.shortName?.trim() || values.name.trim(),
    category: values.category || defaultCategory,
    authorName: values.authorName?.trim() || "TideCanvas",
    description: values.description?.trim(),
    prompt: values.prompt.trim(),
    coverUrl: values.coverUrl?.trim(),
    modelType: "image",
    modelId: modelIds.length === 1 ? modelIds[0] : "",
    modelIds,
    modelPrompts: cleanModelPrompts(values.modelPrompts, modelIds),
    tags: (values.tags || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    sortOrder: values.sortOrder ?? 0,
    status: values.status ?? 1,
    commercial: values.commercial ? 1 : 0,
    publicFlag: values.publicFlag ? 1 : 0,
    official: values.official ? 1 : 0,
  };
}

function toFormValues(row: StylePresetVO): StyleFormValues {
  const modelIds = cleanModelIds(row.modelIds?.length ? row.modelIds : row.modelId ? [row.modelId] : []);
  return {
    name: row.name,
    shortName: row.shortName,
    category: row.category || defaultCategory,
    authorName: row.authorName,
    description: row.description,
    prompt: row.prompt,
    coverUrl: row.coverUrl,
    tags: row.tags?.join(", "),
    modelIds,
    modelPrompts: row.modelPrompts ?? {},
    sortOrder: row.sortOrder,
    status: row.status,
    commercial: row.commercial === 1,
    publicFlag: row.publicFlag === 1,
    official: row.official === 1,
  };
}

export default function AdminStylesPage() {
  const can = useHasPerm();
  const canManage = can("style:manage");
  const [form] = Form.useForm<StyleFormValues>();
  const [records, setRecords] = useState<StylePresetVO[]>([]);
  const [imageModels, setImageModels] = useState<AiModelVO[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<number | undefined>();
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [uploading, setUploading] = useState(false);

  const modelLabelMap = useMemo(() => new Map(imageModels.map((model) => [model.modelId, `${model.name || model.modelId} (${model.modelId})`])), [imageModels]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.styles.list({ pageNum, pageSize, keyword: keyword.trim() || undefined, category, status });
      if (res.success) {
        setRecords(res.data?.records ?? []);
        setTotal(res.data?.total ?? 0);
      } else {
        toast.error(res.message || "风格库加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [category, keyword, pageNum, pageSize, status]);

  const loadImageModels = useCallback(async () => {
    const res = await adminApi.ai.models.list();
    if (!res.success) return;
    setImageModels((res.data ?? []).filter((model) => model.type === AiModelType.IMAGE && ((model as AiModelVO & { status?: number }).status ?? 1) === 1));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    void loadImageModels();
  }, [loadImageModels]);

  const openCreate = () => {
    setEditingId(null);
    form.setFieldsValue({ category: defaultCategory, status: 1, commercial: true, publicFlag: true, official: true, sortOrder: 0, modelIds: [], modelPrompts: {} });
    setModalOpen(true);
  };

  const openEdit = (row: StylePresetVO) => {
    setEditingId(row.id);
    form.setFieldsValue(toFormValues(row));
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = formToPayload(values);
      const res = editingId ? await adminApi.styles.update(editingId, payload) : await adminApi.styles.create(payload);
      if (res.success) {
        toast.success("风格已保存");
        setModalOpen(false);
        form.resetFields();
        void load();
      } else {
        toast.error(res.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await adminApi.styles.delete(id);
    if (res.success) {
      toast.success("风格已删除");
      void load();
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        form.setFieldValue("coverUrl", res.data.fileUrl);
        toast.success("封面已上传");
      } else {
        toast.error(res.message || "上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  const columns: ColumnsType<StylePresetVO> = [
    {
      title: "封面",
      dataIndex: "coverUrl",
      width: 92,
      render: (value: string, row) => value ? (
        <AntdImage src={value} alt={row.name} width={58} height={72} style={{ objectFit: "cover", borderRadius: 8, background: "#f5f5f5" }} />
      ) : (
        <div style={{ width: 58, height: 72, borderRadius: 8, background: "linear-gradient(135deg,#f5f5f5,#e5e7eb)", display: "grid", placeItems: "center", color: "#999" }}>无图</div>
      ),
    },
    {
      title: "风格名称",
      dataIndex: "name",
      width: 220,
      render: (_value, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.name}</div>
          <div style={{ color: "#8c8c8c", fontSize: 12 }}>{row.shortName || "-"} / {row.authorName || "TideCanvas"}</div>
        </div>
      ),
    },
    { title: "分类", dataIndex: "category", width: 130, render: (value: string) => <Tag>{value || defaultCategory}</Tag> },
    {
      title: "适用模型",
      width: 230,
      render: (_, row) => {
        const ids = cleanModelIds(row.modelIds?.length ? row.modelIds : row.modelId ? [row.modelId] : []);
        if (!ids.length) return <Tag>全部图片模型</Tag>;
        return <Space size={[4, 4]} wrap>{ids.map((id) => <Tag key={id}>{modelLabelMap.get(id) ?? id}</Tag>)}</Space>;
      },
    },
    {
      title: "提示词",
      dataIndex: "prompt",
      ellipsis: true,
      render: (value: string, row) => (
        <div>
          <div style={{ color: "#595959" }}>{row.description || "-"}</div>
          <div style={{ color: "#8c8c8c", fontSize: 12, marginTop: 4, maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
        </div>
      ),
    },
    { title: "范围", width: 150, render: (_, row) => <Space size={4}>{row.official ? <Tag color="blue">官方</Tag> : <Tag>用户</Tag>}{row.publicFlag ? <Tag color="green">公开</Tag> : <Tag>私有</Tag>}{row.commercial ? <Tag color="gold">商用</Tag> : null}</Space> },
    { title: "状态", dataIndex: "status", width: 90, render: (value: number) => value === 1 ? <Tag color="green">启用</Tag> : <Tag>停用</Tag> },
    { title: "使用", dataIndex: "usageCount", width: 80 },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, row) => canManage ? (
        <Space size={0}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm title={`删除风格「${row.name}」？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(row.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ) : null,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead
        title="风格库"
        desc="维护图片生成风格预设。可为不同模型配置专用提示词，后续用户发布风格时也能沿用这套审核与上架结构。"
        extra={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增风格</Button>}
      />

      <Space wrap>
        <Input.Search allowClear placeholder="搜索风格名称、作者、描述" value={keyword} onChange={(event) => setKeyword(event.target.value)} onSearch={() => { setPageNum(1); void load(); }} style={{ width: 280 }} />
        <Select allowClear placeholder="分类" value={category} onChange={(value) => { setCategory(value); setPageNum(1); }} style={{ width: 180 }} options={categoryOptions.map((item) => ({ value: item, label: item }))} />
        <Select allowClear placeholder="状态" value={status} onChange={(value) => { setStatus(value); setPageNum(1); }} style={{ width: 120 }} options={[{ value: 1, label: "启用" }, { value: 0, label: "停用" }]} />
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>

      <Table<StylePresetVO>
        rowKey="id"
        columns={columns}
        dataSource={records}
        loading={loading}
        scroll={{ x: 1260 }}
        pagination={{ current: pageNum, pageSize, total, showSizeChanger: true, showTotal: (value) => `共 ${value} 个风格`, onChange: (page, size) => { setPageNum(page); setPageSize(size); } }}
      />

      <Modal title={editingId ? "编辑风格" : "新增风格"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={860} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false} initialValues={{ category: defaultCategory, status: 1, commercial: true, publicFlag: true, official: true, sortOrder: 0, modelIds: [], modelPrompts: {} }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="name" label="风格名称" rules={[{ required: true, message: "请输入风格名称" }]}><Input placeholder="例如：电影质感" /></Form.Item>
            <Form.Item name="shortName" label="短名称"><Input placeholder="例如：电影" /></Form.Item>
            <Form.Item name="category" label="分类"><Select options={categoryOptions.map((item) => ({ value: item, label: item }))} /></Form.Item>
            <Form.Item name="authorName" label="作者"><Input placeholder="TideCanvas" /></Form.Item>
            <Form.Item name="coverUrl" label="封面图" style={{ gridColumn: "1 / 3" }}>
              <Space.Compact style={{ width: "100%" }}>
                <Input placeholder="图片 URL，或点击右侧上传" />
                <Upload showUploadList={false} beforeUpload={(file) => { void handleCoverUpload(file as File); return false; }}>
                  <Button icon={<UploadOutlined />} loading={uploading}>上传</Button>
                </Upload>
              </Space.Compact>
            </Form.Item>
            <Form.Item name="description" label="描述" style={{ gridColumn: "1 / 3" }}><Input placeholder="一句话说明风格适合的场景" /></Form.Item>
            <Form.Item name="prompt" label="通用风格提示词" rules={[{ required: true, message: "请输入风格提示词" }]} style={{ gridColumn: "1 / 3" }}>
              <Input.TextArea rows={5} placeholder="作为所有模型的默认风格提示词；下方模型专用提示词为空时会自动使用这里。" />
            </Form.Item>
            <Form.Item name="tags" label="标签"><Input placeholder="逗号分隔，例如：写实, 产品, 海报" /></Form.Item>
            <Form.Item name="sortOrder" label="排序"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="适用模型" style={{ gridColumn: "1 / 3", marginBottom: 4 }}>
              <Form.Item name="modelIds" noStyle>
                <Checkbox.Group style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {imageModels.map((model) => (
                    <Checkbox key={model.modelId} value={model.modelId}>
                      <span style={{ fontWeight: 500 }}>{model.name || model.modelId}</span>
                      <span style={{ marginLeft: 6, color: "#8c8c8c", fontSize: 12 }}>{model.modelId}</span>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </Form.Item>
              <div style={{ marginTop: 8, color: "#8c8c8c", fontSize: 12 }}>不勾选表示全部图片模型可用；勾选后只会在对应模型下展示。</div>
            </Form.Item>
            <Form.Item shouldUpdate={(prev, next) => prev.modelIds !== next.modelIds} noStyle>
              {({ getFieldValue }) => {
                const selectedIds = cleanModelIds(getFieldValue("modelIds"));
                if (!selectedIds.length) return null;
                return (
                  <div style={{ gridColumn: "1 / 3", display: "grid", gridTemplateColumns: "1fr", gap: 10, padding: 12, border: "1px solid #f0f0f0", borderRadius: 8, background: "#fafafa" }}>
                    <div style={{ color: "#595959", fontSize: 13 }}>模型专用提示词</div>
                    {selectedIds.map((modelId) => {
                      const label = modelLabelMap.get(modelId) ?? modelId;
                      return (
                        <Form.Item key={modelId} name={["modelPrompts", modelId]} label={label} style={{ marginBottom: 0 }}>
                          <Input.TextArea rows={3} placeholder="留空则使用上方通用风格提示词" />
                        </Form.Item>
                      );
                    })}
                  </div>
                );
              }}
            </Form.Item>
            <Form.Item name="status" label="状态"><Select options={[{ value: 1, label: "启用" }, { value: 0, label: "停用" }]} /></Form.Item>
            <Form.Item name="commercial" label="可商用" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="publicFlag" label="公开到广场" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="official" label="官方预设" valuePropName="checked"><Switch /></Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}