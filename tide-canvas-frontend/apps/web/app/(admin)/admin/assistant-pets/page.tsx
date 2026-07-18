"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SaveOutlined,
  StarFilled,
  StarOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { AdminPageHead } from "@/components/admin/page-head";
import { AssistantPetSprite, useResolvedAssistantPetSprite } from "@/components/canvas/assistant/assistant-pet-sprite";
import { toast } from "@/components/shared/toast";
import { detectAssistantPetSpriteFromFile } from "@/lib/assistant-pet-sprite";
import { adminApi, fileApi } from "@/lib/api";
import {
  ASSISTANT_PET_STYLE_ACCEPT,
  ASSISTANT_PET_STYLE_MAX_BYTES,
  ASSISTANT_PET_STYLES_SETTING_KEY,
  createAssistantPetStyle,
  ensureAssistantPetDefault,
  isSupportedAssistantPetFile,
  normalizeAssistantPetStyles,
  serializeAssistantPetStyles,
} from "@/lib/assistant-pet-styles";
import { formatUploadSize } from "@/lib/upload-limits";
import { useHasPerm } from "@/stores/use-permission-store";
import type { AssistantPetStyle } from "@/types/assistant";

function nowIso() {
  return new Date().toISOString();
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function imageNameFromUrl(value: string) {
  const fallback = "宠物样式图片";
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return name.replace(/^\d+_+/, "") || fallback;
  } catch {
    const name = value.split("?")[0]?.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(name).replace(/^\d+_+/, "") || fallback;
  }
}

function hydrateStyles(raw: unknown) {
  const now = nowIso();
  return ensureAssistantPetDefault(normalizeAssistantPetStyles(raw).map((style) => ({
    ...style,
    createdAt: style.createdAt || now,
    updatedAt: style.updatedAt || style.createdAt || now,
    createdBy: style.createdBy || "管理员",
  })));
}

function AssistantPetActionSummary({ style }: { style: AssistantPetStyle }) {
  const { sprite, detecting, source } = useResolvedAssistantPetSprite(style);
  if (detecting) return <Tag>识别中</Tag>;
  if (!sprite) return <Tag>单图</Tag>;
  return (
    <Tooltip title={`${source === "saved" ? "已保存" : "自动识别"}：${sprite.rows} 组动作，每组最多 ${sprite.columns} 帧`}>
      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
        {sprite.actions.length} 组 / {sprite.columns} 帧
      </Tag>
    </Tooltip>
  );
}

function AssistantPetPreviewModal({
  style,
  onClose,
}: {
  style: AssistantPetStyle | null;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { sprite, detecting, source } = useResolvedAssistantPetSprite(style);
  const [actionId, setActionId] = useState<string | undefined>();

  useEffect(() => {
    setActionId(sprite?.defaultAction || sprite?.actions[0]?.id);
  }, [sprite?.defaultAction, sprite?.actions, style?.id]);

  return (
    <Modal
      open={Boolean(style)}
      title="动作预览"
      footer={null}
      width={560}
      destroyOnHidden
      onCancel={onClose}
    >
      {style && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ width: 144, height: 144, borderRadius: 16, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillTertiary, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AssistantPetSprite petStyle={style} sprite={sprite} actionId={actionId} size={112} alt={style.name} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>{style.name}</Typography.Title>
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
                {sprite ? `${sprite.rows} 组动作，${sprite.columns} 列帧，默认 ${sprite.fps ?? 8} FPS` : detecting ? "正在自动识别动作帧..." : "未识别到动作帧，将按单图显示"}
              </Typography.Text>
              {source && (
                <Tag color={source === "saved" ? "blue" : "processing"} style={{ marginTop: 10 }}>
                  {source === "saved" ? "已保存动作配置" : "自动识别动作配置"}
                </Tag>
              )}
            </div>
          </div>

          {sprite?.actions.length ? (
            <div>
              <Typography.Text strong>动作</Typography.Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {sprite.actions.map((action) => (
                  <Button
                    key={action.id}
                    size="small"
                    type={action.id === actionId ? "primary" : "default"}
                    onClick={() => setActionId(action.id)}
                  >
                    {action.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={detecting ? "正在识别 spritesheet..." : "没有可播放动作"} />
          )}

          <Typography.Text copyable={{ text: style.imageUrl }} ellipsis style={{ maxWidth: "100%" }}>
            {imageNameFromUrl(style.imageUrl)}
          </Typography.Text>
        </div>
      )}
    </Modal>
  );
}

export default function AdminAssistantPetsPage() {
  const can = useHasPerm();
  const canEdit = can("setting:edit");
  const { token } = theme.useToken();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [styles, setStyles] = useState<AssistantPetStyle[]>([]);
  const [originalSignature, setOriginalSignature] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewStyle, setPreviewStyle] = useState<AssistantPetStyle | null>(null);

  const normalizedStyles = useMemo(() => (
    ensureAssistantPetDefault(styles)
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  ), [styles]);
  const currentSignature = useMemo(() => serializeAssistantPetStyles(normalizedStyles), [normalizedStyles]);
  const hasChanges = currentSignature !== originalSignature;
  const enabledCount = normalizedStyles.filter((style) => style.enabled).length;
  const defaultStyle = normalizedStyles.find((style) => style.isDefault && style.enabled);
  const bluePrimaryButtonStyle = {
    background: token.colorInfo,
    borderColor: token.colorInfo,
    color: token.colorWhite,
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await adminApi.settings.get();
      if (!res.success) {
        toast.error(res.message || "加载助手样式失败");
        return;
      }
      const next = hydrateStyles(res.data?.[ASSISTANT_PET_STYLES_SETTING_KEY]);
      const signature = serializeAssistantPetStyles(next);
      setStyles(next);
      setOriginalSignature(signature);
    } catch (error) {
      toast.error((error as Error)?.message || "加载助手样式失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const updateStyle = (id: string, patch: Partial<AssistantPetStyle>) => {
    const updatedAt = nowIso();
    setStyles((current) => ensureAssistantPetDefault(current.map((style) => (
      style.id === id ? { ...style, ...patch, updatedAt } : style
    ))));
  };

  const setDefaultStyle = (id: string) => {
    const updatedAt = nowIso();
    setStyles((current) => current.map((style) => ({
      ...style,
      enabled: style.id === id ? true : style.enabled,
      isDefault: style.id === id,
      updatedAt: style.id === id ? updatedAt : style.updatedAt,
    })));
  };

  const removeStyle = (id: string) => {
    setStyles((current) => ensureAssistantPetDefault(current.filter((style) => style.id !== id)));
  };

  const resetChanges = () => {
    setStyles(hydrateStyles(originalSignature));
  };

  const saveStyles = async () => {
    setSaving(true);
    try {
      const payload = {
        [ASSISTANT_PET_STYLES_SETTING_KEY]: currentSignature,
      };
      const res = await adminApi.settings.update(payload);
      if (!res.success) {
        toast.error(res.message || "保存助手样式失败");
        return;
      }
      setOriginalSignature(currentSignature);
      toast.success("助手样式已保存");
    } catch (error) {
      toast.error((error as Error)?.message || "保存助手样式失败");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!canEdit) {
      toast.error("没有编辑权限");
      return;
    }
    if (!isSupportedAssistantPetFile(file)) {
      toast.error("请上传 webp、png 或 gif 图片");
      return;
    }
    if (file.size > ASSISTANT_PET_STYLE_MAX_BYTES) {
      toast.error(`宠物样式不能超过 ${formatUploadSize(ASSISTANT_PET_STYLE_MAX_BYTES)}`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const sprite = await detectAssistantPetSpriteFromFile(file);
      const res = await fileApi.systemUploadProgress(file, setUploadProgress, {
        maxBytes: ASSISTANT_PET_STYLE_MAX_BYTES,
        label: "宠物样式",
        bizType: "assistant_pet",
      });
      if (!res.success || !res.data?.fileUrl) {
        toast.error(res.message || "上传失败");
        return;
      }
      setStyles((current) => ensureAssistantPetDefault([
        ...current,
        createAssistantPetStyle(file, res.data.fileUrl, current, sprite),
      ]));
      toast.success(sprite ? `样式已添加，已识别 ${sprite.actions.length} 组动作，保存后对用户生效` : "样式已添加，保存后对用户生效");
    } catch (error) {
      toast.error((error as Error)?.message || "上传失败");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const columns: ColumnsType<AssistantPetStyle> = [
    {
      title: "样式",
      dataIndex: "name",
      width: 300,
      render: (_, style) => (
        <Space size={12} style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setPreviewStyle(style)}
            style={{ width: 56, height: 56, borderRadius: 8, background: token.colorFillTertiary, border: `1px solid ${token.colorBorderSecondary}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, cursor: "pointer", padding: 0 }}
            title="点击预览动作"
          >
            <AssistantPetSprite petStyle={style} size={52} alt={style.name} />
          </button>
          <div style={{ minWidth: 0 }}>
            <Input
              disabled={!canEdit}
              value={style.name}
              maxLength={24}
              onChange={(event) => updateStyle(style.id, { name: event.target.value })}
              style={{ width: 190 }}
            />
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 4, maxWidth: 190, fontSize: 12 }} ellipsis copyable>
              {style.id}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 96,
      render: (_, style) => (
        <Tag color={style.enabled ? "success" : "default"} style={{ marginInlineEnd: 0 }}>
          {style.enabled ? "已启用" : "已停用"}
        </Tag>
      ),
    },
    {
      title: "默认",
      dataIndex: "isDefault",
      width: 118,
      render: (_, style) => (
        style.isDefault ? (
          <Tag color="blue" icon={<StarFilled />} style={{ marginInlineEnd: 0 }}>默认</Tag>
        ) : (
          <Button
            disabled={!canEdit || !style.enabled}
            size="small"
            icon={<StarOutlined />}
            onClick={() => setDefaultStyle(style.id)}
          >
            设默认
          </Button>
        )
      ),
    },
    {
      title: "排序",
      dataIndex: "sortOrder",
      width: 92,
      render: (_, style) => (
        <InputNumber
          disabled={!canEdit}
          min={0}
          value={style.sortOrder ?? 0}
          onChange={(value) => updateStyle(style.id, { sortOrder: Number(value ?? 0) })}
          style={{ width: 88 }}
        />
      ),
    },
    {
      title: "图片",
      dataIndex: "imageUrl",
      width: 220,
      ellipsis: true,
      render: (_, style) => (
        <Tooltip title={style.imageUrl}>
          <Typography.Text copyable={{ text: style.imageUrl }} ellipsis style={{ maxWidth: "100%" }}>
            {imageNameFromUrl(style.imageUrl)}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: "动作",
      dataIndex: "sprite",
      width: 128,
      render: (_, style) => <AssistantPetActionSummary style={style} />,
    },
    {
      title: "添加人",
      dataIndex: "createdBy",
      width: 100,
      render: (_, style) => (
        <Typography.Text ellipsis style={{ maxWidth: 84 }}>
          {style.createdBy || "-"}
        </Typography.Text>
      ),
    },
    {
      title: "添加时间",
      dataIndex: "createdAt",
      width: 152,
      render: (_, style) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatTime(style.createdAt)}
        </Typography.Text>
      ),
    },
    {
      title: "操作",
      width: 172,
      render: (_, style) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            icon={<EyeOutlined />}
            onClick={() => setPreviewStyle(style)}
          >
            预览
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canEdit}
            style={{ paddingInline: 0 }}
            onClick={() => updateStyle(style.id, { enabled: !style.enabled, isDefault: !style.enabled ? style.isDefault : false })}
          >
            {style.enabled ? "停用" : "启用"}
          </Button>
          <Popconfirm
            title="删除这个助手样式？"
            description="保存后用户将不能再选择该样式。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => removeStyle(style.id)}
            disabled={!canEdit}
          >
            <Button danger type="text" size="small" icon={<DeleteOutlined />} disabled={!canEdit}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const extra = (
    <Space>
      <Tooltip title={`支持 webp、png、gif，单文件不超过 ${formatUploadSize(ASSISTANT_PET_STYLE_MAX_BYTES)}`}>
        <Button
          icon={<UploadOutlined />}
          loading={uploading}
          disabled={!canEdit}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? `上传中 ${uploadProgress}%` : "上传样式"}
        </Button>
      </Tooltip>
      <Button icon={<ReloadOutlined />} onClick={loadSettings} disabled={loading || saving || uploading}>
        刷新
      </Button>
      <Button disabled={!hasChanges || saving || uploading} onClick={resetChanges}>
        重置
      </Button>
      {canEdit && (
        <Button icon={<SaveOutlined />} loading={saving} disabled={!hasChanges || uploading} style={hasChanges && !uploading ? bluePrimaryButtonStyle : undefined} onClick={saveStyles}>
          保存配置
        </Button>
      )}
    </Space>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AdminPageHead title="助手宠物" desc="管理员维护画布助手的可选样式，用户只能从已启用样式中选择。" extra={extra} />

      <input
        ref={fileInputRef}
        type="file"
        accept={ASSISTANT_PET_STYLE_ACCEPT}
        style={{ display: "none" }}
        onChange={handleUpload}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(160px, 1fr))", gap: 12, maxWidth: 620 }}>
        <Card size="small">
          <Typography.Text type="secondary">样式总数</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{normalizedStyles.length}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">已启用</Typography.Text>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#52c41a" }}>{enabledCount}</div>
        </Card>
        <Card size="small">
          <Typography.Text type="secondary">默认样式</Typography.Text>
          <div style={{ marginTop: 6 }}>
            {defaultStyle?.name ? (
              <Tag color="blue">{defaultStyle.name}</Tag>
            ) : (
              <Tag>未设置</Tag>
            )}
          </div>
        </Card>
      </div>

      <Card styles={{ body: { padding: 12 } }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : normalizedStyles.length ? (
          <Table
            rowKey="id"
            size="middle"
            tableLayout="fixed"
            columns={columns}
            dataSource={normalizedStyles}
            pagination={false}
          />
        ) : (
          <Empty description="还没有助手样式">
            <Button icon={<UploadOutlined />} disabled={!canEdit} style={canEdit ? bluePrimaryButtonStyle : undefined} onClick={() => fileInputRef.current?.click()}>
              上传第一个样式
            </Button>
          </Empty>
        )}
      </Card>

      <AssistantPetPreviewModal style={previewStyle} onClose={() => setPreviewStyle(null)} />
    </div>
  );
}
