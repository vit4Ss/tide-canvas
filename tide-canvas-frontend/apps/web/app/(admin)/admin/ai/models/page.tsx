"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Empty,
  Image as AntImage,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  FileImageOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { adminApi, fileApi } from "@/lib/api";
import { useHasPerm } from "@/stores/use-permission-store";
import { toast } from "@/components/shared/toast";
import { AdminPageHead } from "@/components/admin/page-head";
import { CLARITY_OPTIONS, QUALITY_OPTIONS, RATIO_OPTIONS } from "@/components/canvas/nodes/quality-ratio-picker";
import {
  LEGACY_VIDEO_DURATIONS,
  LEGACY_VIDEO_RESOLUTIONS,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  type VideoSecondPrice,
} from "@/lib/video-model-config";
import type { AiIconAssetVO, AiModelCapabilities } from "@/types/ai";
import styles from "./page.module.css";

const { CheckableTag } = Tag;

const DURATION_CHOICES = VIDEO_DURATIONS;
const ICON_FILE_MAX_MB = 2;
const ICON_FILE_MAX_BYTES = ICON_FILE_MAX_MB * 1024 * 1024;

const HANDLER_CHOICES: Record<string, { value: string; label: string }[]> = {
  image: [
    { value: "text_to_image", label: "文生图" },
    { value: "image_to_image", label: "图生图" },
  ],
  video: [
    { value: "text_to_video", label: "文生视频" },
    { value: "image_to_video", label: "图生视频" },
    { value: "start_end_to_video", label: "首尾帧" },
    { value: "reference_to_video", label: "全能参考" },
  ],
};

const MODEL_TYPES = [
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
  { value: "text", label: "文本生成" },
  { value: "audio", label: "语音合成" },
];

const TYPE_COLOR: Record<string, string> = {
  image: "purple",
  video: "blue",
  text: "gold",
  audio: "green",
};

const QUALITY_LABELS: Record<string, string> = {
  low: "低画质",
  standard: "标准画质",
  high: "高画质",
};

interface AdminAiModelVO {
  id: string;
  name: string;
  icon?: string;
  modelId: string;
  type: string;
  pointCost: number;
  costPerCall?: number;
  config?: string;
  supportedHandlers?: string[] | null;
  capabilities?: AiModelCapabilities;
  status: number;
  createTime?: string;
}

interface ModelForm {
  name: string;
  icon: string;
  modelId: string;
  type: string;
  pointCost: number;
  costPerCall: number;
  description: string;
  estSeconds: number;
  qualities: string[];
  clarities: string[];
  batchSizes: number[];
  gridOutput: boolean;
  ratios: string[];
  resolutions: string[];
  durations: number[];
  audio: boolean;
  videoInputs: boolean;
  supportedHandlers: string[];
  voices: { id: string; name: string }[];
  pricing: Record<string, Record<string, number>>;
  secondPricing: Record<string, VideoSecondPrice>;
  referenceImageMaxMB: number;
  referenceVideoMaxMB: number;
  multimodal: boolean;
  streaming: boolean;
  nativeFiles: boolean;
  contextWindow: number;
  maxInputFiles: number;
  maxFileSizeMB: number;
  allowedMimeTypes: string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceFiles: number;
}

const emptyForm: ModelForm = {
  name: "",
  icon: "",
  modelId: "",
  type: "image",
  pointCost: 0,
  costPerCall: 0,
  description: "",
  estSeconds: 0,
  qualities: QUALITY_OPTIONS.map((quality) => quality.value),
  clarities: [...CLARITY_OPTIONS],
  batchSizes: [1, 2, 4],
  gridOutput: false,
  ratios: RATIO_OPTIONS.map((ratio) => ratio.value),
  resolutions: [],
  durations: [],
  audio: true,
  videoInputs: false,
  supportedHandlers: [],
  voices: [],
  pricing: {},
  secondPricing: {},
  referenceImageMaxMB: 50,
  referenceVideoMaxMB: 50,
  multimodal: false,
  streaming: true,
  nativeFiles: false,
  contextWindow: 128000,
  maxInputFiles: 10,
  maxFileSizeMB: 20,
  allowedMimeTypes: ["image/*", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  maxReferenceImages: 4,
  maxReferenceVideos: 2,
  maxReferenceFiles: 12,
};

function normalizeIconName(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "模型图标";
}

function isImageIcon(value?: string) {
  if (!value) return false;
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:image") || value.startsWith("blob:");
}

function isSupportedIconFile(file: File) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(file.type);
}

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function qualityLabel(value: string) {
  return QUALITY_LABELS[value] ?? value;
}

function ratioLabel(value: string) {
  return value === "auto" ? "自动" : value;
}

function videoRatioLabel(value: string) {
  return value === "auto" ? "自动" : value;
}

function hasCompleteVideoPricing(form: Pick<ModelForm, "resolutions" | "audio" | "secondPricing">): boolean {
  return form.resolutions.every((resolution) => {
    const price = form.secondPricing[resolution];
    if (!price || !Number.isFinite(Number(price.withoutAudio)) || Number(price.withoutAudio) <= 0) return false;
    return !form.audio || (Number.isFinite(Number(price.withAudio)) && Number(price.withAudio) > 0);
  });
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      {children}
      {hint && <div className={styles.fieldHint}>{hint}</div>}
    </div>
  );
}

function IconPreview({ value }: { value?: string }) {
  if (!value) {
    return (
      <span className={styles.iconPreview}>
        <PictureOutlined />
      </span>
    );
  }

  if (isImageIcon(value)) {
    return (
      <span className={styles.iconPreview}>
        <AntImage src={value} alt="模型图标" width={38} height={38} preview={false} fallback="" />
      </span>
    );
  }

  return <span className={styles.iconPreview}>{value}</span>;
}

function TagGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <div className={styles.sectionTitle}>{label}</div>
      <Space wrap size={[6, 6]}>
        {options.map((option) => (
          <CheckableTag
            key={option.value}
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
            className={styles.optionTag}
          >
            {option.label}
          </CheckableTag>
        ))}
      </Space>
      {hint && <div className={styles.fieldHint}>{hint}</div>}
    </div>
  );
}

function PricingMatrix({
  corner,
  rows,
  cols,
  pricing,
  onSet,
}: {
  corner: string;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  pricing: Record<string, Record<string, number>>;
  onSet: (row: string, col: string, value: number | null) => void;
}) {
  return (
    <div>
      <div className={styles.sectionTitle}>积分定价（{corner.replace("/", " × ")}）</div>
      <div className={styles.fieldHint}>不同档位可设不同积分；留空或 0 时回退到上方“消耗积分”。</div>
      {rows.length === 0 || cols.length === 0 ? (
        <div className={styles.fieldHint}>请先选择上方的两个维度。</div>
      ) : (
        <div className={styles.pricingWrap}>
          <table className={styles.pricingTable}>
            <thead>
              <tr className={styles.pricingHead}>
                <th className={styles.pricingHeader}>{corner}</th>
                {cols.map((col) => (
                  <th key={col.key} className={styles.pricingHeader}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={styles.pricingRow}>
                  <td className={styles.pricingCell}>{row.label}</td>
                  {cols.map((col) => (
                    <td key={col.key} className={styles.pricingCell}>
                      <InputNumber
                        size="small"
                        min={0}
                        step={0.1}
                        controls={false}
                        style={{ width: 66 }}
                        placeholder="-"
                        value={pricing[row.key]?.[col.key] ?? null}
                        onChange={(value) => onSet(row.key, col.key, value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VideoSecondPricing({
  resolutions,
  allowAudio,
  pricing,
  onSet,
}: {
  resolutions: string[];
  allowAudio: boolean;
  pricing: Record<string, VideoSecondPrice>;
  onSet: (resolution: string, field: keyof VideoSecondPrice, value: number | null) => void;
}) {
  return (
    <div>
      <div className={styles.sectionTitle}>每秒积分单价</div>
      <div className={styles.fieldHint}>最终积分按“时长 × 对应单价 × 团队倍率”计算并向上取整；启用模型前必须补齐所有已选分辨率。</div>
      {resolutions.length === 0 ? (
        <div className={styles.fieldHint}>请先选择支持的清晰度。</div>
      ) : (
        <div className={styles.pricingWrap}>
          <table className={styles.pricingTable}>
            <thead>
              <tr className={styles.pricingHead}>
                <th className={styles.pricingHeader}>清晰度</th>
                <th className={styles.pricingHeader}>无音频 / 秒</th>
                <th className={styles.pricingHeader}>有音频 / 秒</th>
              </tr>
            </thead>
            <tbody>
              {resolutions.map((resolution) => (
                <tr key={resolution} className={styles.pricingRow}>
                  <td className={styles.pricingCell}>{resolution}</td>
                  <td className={styles.pricingCell}>
                    <InputNumber
                      size="small"
                      min={0}
                      step={0.1}
                      controls={false}
                      style={{ width: 112 }}
                      placeholder="必填"
                      value={pricing[resolution]?.withoutAudio ?? null}
                      onChange={(value) => onSet(resolution, "withoutAudio", value)}
                    />
                  </td>
                  <td className={styles.pricingCell}>
                    <InputNumber
                      size="small"
                      min={0}
                      step={0.1}
                      controls={false}
                      disabled={!allowAudio}
                      style={{ width: 112 }}
                      placeholder={allowAudio ? "必填" : "不支持音频"}
                      value={allowAudio ? pricing[resolution]?.withAudio ?? null : null}
                      onChange={(value) => onSet(resolution, "withAudio", value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminAiModelsPage() {
  const can = useHasPerm();
  const router = useRouter();
  const iconFileInputRef = useRef<HTMLInputElement>(null);

  const [models, setModels] = useState<AdminAiModelVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState(0);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");

  const [icons, setIcons] = useState<AiIconAssetVO[]>([]);
  const [iconsLoading, setIconsLoading] = useState(false);
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconUploadProgress, setIconUploadProgress] = useState(0);
  const [manualIconValue, setManualIconValue] = useState("");

  const imageRatioOptions = useMemo(
    () => RATIO_OPTIONS.map((ratio) => ({ value: ratio.value, label: ratioLabel(ratio.value) })),
    [],
  );
  const videoRatioOptions = useMemo(
    () => VIDEO_RATIOS.map((ratio) => ({ value: ratio.value, label: videoRatioLabel(ratio.value) })),
    [],
  );

  const updateForm = (patch: Partial<ModelForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.ai.models.list();
      if (response.success) {
        setModels(response.data as unknown as AdminAiModelVO[]);
      } else {
        toast.error(response.message || "模型列表加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIcons = useCallback(async () => {
    setIconsLoading(true);
    try {
      const response = await adminApi.ai.icons.list();
      if (response.success) {
        setIcons(response.data ?? []);
      } else {
        toast.error(response.message || "图标库加载失败");
      }
    } finally {
      setIconsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [modelsResponse, iconsResponse] = await Promise.all([
          adminApi.ai.models.list(),
          adminApi.ai.icons.list(),
        ]);
        if (cancelled) return;
        if (modelsResponse.success) {
          setModels(modelsResponse.data as unknown as AdminAiModelVO[]);
        } else {
          toast.error(modelsResponse.message || "模型列表加载失败");
        }
        if (iconsResponse.success) {
          setIcons(iconsResponse.data ?? []);
        } else {
          toast.error(iconsResponse.message || "图标库加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildConfig = () => {
    const pricing = Object.keys(form.pricing).length ? { pricing: form.pricing } : {};
    const meta = {
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.estSeconds > 0 ? { estSeconds: form.estSeconds } : {}),
    };
    const referenceLimits = {
      referenceImageMaxMB: Math.min(50, Math.max(1, Math.round(form.referenceImageMaxMB || 50))),
      referenceVideoMaxMB: Math.min(50, Math.max(1, Math.round(form.referenceVideoMaxMB || 50))),
    };

    if (form.type === "image") {
      return JSON.stringify({
        qualities: form.qualities,
        clarities: form.clarities,
        ratios: form.ratios,
        batchSizes: form.batchSizes,
        ...(form.gridOutput ? { gridOutput: true } : {}),
        ...pricing,
        ...referenceLimits,
        ...meta,
      });
    }

    if (form.type === "video") {
      const secondPricing = Object.fromEntries(
        form.resolutions
          .map((resolution) => [resolution, form.secondPricing[resolution]] as const)
          .filter((entry): entry is readonly [string, VideoSecondPrice] => Boolean(entry[1])),
      );
      return JSON.stringify({
        resolutions: form.resolutions,
        ratios: form.ratios,
        durations: form.durations,
        audio: form.audio,
        ...(Object.keys(secondPricing).length ? { secondPricing } : {}),
        ...(form.videoInputs ? { videoInputs: true } : {}),
        ...referenceLimits,
        ...meta,
      });
    }

    if (form.type === "audio") {
      return JSON.stringify({
        voices: form.voices
          .filter((voice) => voice.id.trim())
          .map((voice) => ({ id: voice.id.trim(), name: voice.name.trim() || voice.id.trim() })),
        ...referenceLimits,
        ...meta,
      });
    }

    return JSON.stringify({ ...referenceLimits, ...meta });
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingStatus(0);
    setForm(emptyForm);
    setManualIconValue("");
    setFormOpen(true);
  };

  const startEdit = (model: AdminAiModelVO) => {
    let parsedConfig: Record<string, unknown> = {};
    if (model.config) {
      try {
        parsedConfig = JSON.parse(model.config) as Record<string, unknown>;
      } catch {
        parsedConfig = {};
      }
    }
    const config = parsedConfig as {
      qualities?: string[];
      clarities?: string[];
      ratios?: string[];
      batchSizes?: number[];
      gridOutput?: boolean;
      resolutions?: string[];
      durations?: number[];
      audio?: boolean;
      videoInputs?: boolean;
      voices?: { id: string; name: string }[];
      pricing?: Record<string, Record<string, number>>;
      secondPricing?: Record<string, VideoSecondPrice>;
      description?: string;
      estSeconds?: number;
      referenceImageMaxMB?: number;
      maxReferenceImageMB?: number;
      referenceVideoMaxMB?: number;
      maxReferenceVideoMB?: number;
    };

    setEditingId(model.id);
    setEditingStatus(model.status);
    setManualIconValue(model.icon ?? "");
    setForm({
      name: model.name,
      icon: model.icon ?? "",
      modelId: model.modelId,
      type: model.type,
      pointCost: Number(model.pointCost ?? 0),
      costPerCall: Number(model.costPerCall ?? 0),
      description: config.description ?? "",
      estSeconds: config.estSeconds ?? 0,
      referenceImageMaxMB: config.referenceImageMaxMB ?? config.maxReferenceImageMB ?? 50,
      referenceVideoMaxMB: config.referenceVideoMaxMB ?? config.maxReferenceVideoMB ?? 50,
      qualities: config.qualities ?? QUALITY_OPTIONS.map((quality) => quality.value),
      clarities: config.clarities ?? [...CLARITY_OPTIONS],
      batchSizes: config.batchSizes ?? [1, 2, 4],
      gridOutput: config.gridOutput ?? false,
      ratios: config.ratios ?? (model.type === "video" ? VIDEO_RATIOS.map((ratio) => ratio.value) : RATIO_OPTIONS.map((ratio) => ratio.value)),
      resolutions: config.resolutions ?? [...LEGACY_VIDEO_RESOLUTIONS],
      durations: config.durations ?? [...LEGACY_VIDEO_DURATIONS],
      audio: config.audio ?? true,
      videoInputs: config.videoInputs ?? false,
      supportedHandlers: model.supportedHandlers ?? [],
      multimodal: model.capabilities?.multimodal ?? false,
      streaming: model.capabilities?.streaming ?? true,
      nativeFiles: model.capabilities?.nativeFiles ?? false,
      contextWindow: Number(model.capabilities?.contextWindow ?? 128000),
      maxInputFiles: Number(model.capabilities?.maxInputFiles ?? 10),
      maxFileSizeMB: Number(model.capabilities?.maxFileSizeMB ?? 20),
      allowedMimeTypes: model.capabilities?.allowedMimeTypes ?? emptyForm.allowedMimeTypes,
      maxReferenceImages: Number(model.capabilities?.maxReferenceImages ?? 4),
      maxReferenceVideos: Number(model.capabilities?.maxReferenceVideos ?? 2),
      maxReferenceFiles: Number(model.capabilities?.maxReferenceFiles ?? 12),
      voices: config.voices ?? [],
      pricing: config.pricing ?? {},
      secondPricing: config.secondPricing ?? {},
    });
    setFormOpen(true);
  };

  const openIconLibrary = () => {
    setManualIconValue(form.icon);
    setIconModalOpen(true);
    void loadIcons();
  };

  const selectIcon = (iconValue: string) => {
    updateForm({ icon: iconValue });
    setManualIconValue(iconValue);
    setIconModalOpen(false);
  };

  const uploadIconFile = async (file: File) => {
    if (!isSupportedIconFile(file)) {
      toast.error("仅支持 PNG、JPG、WEBP、GIF、SVG 图标文件");
      return;
    }
    if (file.size > ICON_FILE_MAX_BYTES) {
      toast.error(`图标文件不能超过 ${ICON_FILE_MAX_MB}MB`);
      return;
    }

    setIconUploading(true);
    setIconUploadProgress(0);
    try {
      const uploadResponse = await fileApi.uploadProgress(
        file,
        (progress) => setIconUploadProgress(progress),
        { maxBytes: ICON_FILE_MAX_BYTES },
      );
      if (!uploadResponse.success || !uploadResponse.data) {
        toast.error(uploadResponse.message || "图标上传失败");
        return;
      }

      const fileData = uploadResponse.data;
      const createResponse = await adminApi.ai.icons.create({
        name: normalizeIconName(file.name),
        iconUrl: fileData.fileUrl,
        fileId: fileData.id,
        mimeType: fileData.mimeType || file.type,
        fileSize: fileData.fileSize || file.size,
        status: 1,
      });
      if (!createResponse.success) {
        toast.error(createResponse.message || "图标入库失败");
        return;
      }

      toast.success("图标已上传");
      updateForm({ icon: createResponse.data.iconUrl });
      setManualIconValue(createResponse.data.iconUrl);
      await loadIcons();
    } finally {
      setIconUploading(false);
      setIconUploadProgress(0);
      if (iconFileInputRef.current) iconFileInputRef.current.value = "";
    }
  };

  const handleIconFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void uploadIconFile(file);
  };

  const handleIconDelete = async (id: string) => {
    const response = await adminApi.ai.icons.delete(id);
    if (response.success) {
      toast.success("图标已删除");
      await loadIcons();
    } else {
      toast.error(response.message || "删除失败");
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.modelId.trim()) {
      toast.error("请填写名称和前端模型标识");
      return;
    }
    if (form.type === "video" && (!form.ratios.length || !form.resolutions.length || !form.durations.length)) {
      toast.error("视频模型的比例、清晰度和时长都必须至少选择一项");
      return;
    }
    if (form.type === "video" && editingStatus === 1 && !hasCompleteVideoPricing(form)) {
      toast.error("启用中的视频模型必须补齐各清晰度的每秒积分单价");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        icon: form.icon.trim(),
        modelId: form.modelId.trim(),
        type: form.type,
        pointCost: form.type === "video" ? 0 : form.pointCost,
        costPerCall: form.costPerCall,
        config: buildConfig(),
        supportedHandlers: form.supportedHandlers,
        ...(!editingId ? { status: form.type === "video" ? 0 : 1 } : {}),
        capabilities: {
          multimodal: form.multimodal,
          streaming: form.streaming,
          nativeFiles: form.nativeFiles,
          contextWindow: Math.max(1024, Math.round(form.contextWindow || 128000)),
          maxInputFiles: Math.min(10, Math.max(1, Math.round(form.maxInputFiles || 10))),
          maxFileSizeMB: Math.min(20, Math.max(1, Math.round(form.maxFileSizeMB || 20))),
          allowedMimeTypes: form.allowedMimeTypes,
          maxReferenceImages: Math.max(0, Math.round(form.maxReferenceImages || 0)),
          maxReferenceVideos: Math.max(0, Math.round(form.maxReferenceVideos || 0)),
          maxReferenceFiles: Math.max(0, Math.round(form.maxReferenceFiles || 0)),
        },
      };
      const response = editingId
        ? await adminApi.ai.models.update(editingId, payload)
        : await adminApi.ai.models.create(payload);

      if (response.success) {
        toast.success("已保存");
        setFormOpen(false);
        setEditingId(null);
        setEditingStatus(0);
        setForm(emptyForm);
        await loadModels();
      } else {
        toast.error(response.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const response = await adminApi.ai.models.delete(id);
    if (response.success) {
      toast.success("模型已删除");
      await loadModels();
    } else {
      toast.error(response.message || "删除失败");
    }
  };

  const handleToggleStatus = async (model: AdminAiModelVO) => {
    const response = await adminApi.ai.models.update(model.id, { status: model.status === 1 ? 0 : 1 });
    if (response.success) {
      await loadModels();
    } else {
      toast.error(response.message || "状态更新失败");
    }
  };

  const toggleArr = (field: "qualities" | "clarities" | "ratios" | "resolutions" | "supportedHandlers", value: string) => {
    setForm((prev) => {
      const values = prev[field];
      const removing = values.includes(value);
      const next = { ...prev, [field]: removing ? values.filter((item) => item !== value) : [...values, value] } as ModelForm;
      if (field === "resolutions" && removing) {
        const secondPricing = { ...prev.secondPricing };
        delete secondPricing[value];
        next.secondPricing = secondPricing;
      }
      return next;
    });
  };

  const toggleDuration = (duration: number) => {
    setForm((prev) => ({
      ...prev,
      durations: prev.durations.includes(duration)
        ? prev.durations.filter((item) => item !== duration)
        : [...prev.durations, duration].sort((a, b) => a - b),
    }));
  };

  const toggleBatchSize = (count: number) => {
    setForm((prev) => ({
      ...prev,
      batchSizes: prev.batchSizes.includes(count)
        ? prev.batchSizes.filter((item) => item !== count)
        : [...prev.batchSizes, count].sort((a, b) => a - b),
    }));
  };

  const handleTypeChange = (type: string) => {
    updateForm({
      type,
      ratios: type === "video" ? [] : RATIO_OPTIONS.map((ratio) => ratio.value),
      resolutions: [],
      durations: [],
      audio: true,
      pricing: {},
      secondPricing: {},
    });
  };

  const setPricing = (row: string, col: string, value: number | null) => {
    setForm((prev) => {
      const pricing = { ...prev.pricing };
      const rowValue = { ...(pricing[row] ?? {}) };
      if (value == null || !Number.isFinite(value) || value <= 0) {
        delete rowValue[col];
      } else {
        rowValue[col] = value;
      }
      if (Object.keys(rowValue).length === 0) {
        delete pricing[row];
      } else {
        pricing[row] = rowValue;
      }
      return { ...prev, pricing };
    });
  };

  const setSecondPricing = (resolution: string, field: keyof VideoSecondPrice, value: number | null) => {
    setForm((prev) => {
      const secondPricing = { ...prev.secondPricing };
      const row = { ...(secondPricing[resolution] ?? {}) };
      if (value == null || !Number.isFinite(value) || value <= 0) {
        delete row[field];
      } else {
        row[field] = value;
      }
      if (Object.keys(row).length === 0) delete secondPricing[resolution];
      else secondPricing[resolution] = row;
      return { ...prev, secondPricing };
    });
  };

  const filteredModels = searchKeyword
    ? models.filter((model) =>
        model.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        model.modelId.toLowerCase().includes(searchKeyword.toLowerCase()),
      )
    : models;

  const columns: ColumnsType<AdminAiModelVO> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (value: string, model) => (
        <Space>
          <IconPreview value={model.icon} />
          <span style={{ fontWeight: 500 }}>{value}</span>
        </Space>
      ),
    },
    {
      title: "前端模型标识",
      dataIndex: "modelId",
      key: "modelId",
      responsive: ["md"],
      render: (value: string) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8c8c8c" }}>{value}</span>,
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      render: (type: string) => <Tag color={TYPE_COLOR[type] || "default"}>{MODEL_TYPES.find((item) => item.value === type)?.label || type}</Tag>,
    },
    {
      title: "消耗积分",
      dataIndex: "pointCost",
      key: "pointCost",
      render: (value: number, model) => model.type === "video"
        ? <span style={{ color: "#2563eb", fontWeight: 500 }}>按秒计费</span>
        : <span style={{ color: "#d97706", fontWeight: 500 }}>{value}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: number) => (status === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>),
    },
    {
      title: "操作",
      key: "action",
      render: (_, model) => (
        <Space size={0}>
          {can("model:manage") && (
            <Button type="text" size="small" onClick={() => void handleToggleStatus(model)} style={{ color: model.status === 1 ? "#ef4444" : "#16a34a" }}>
              {model.status === 1 ? "禁用" : "启用"}
            </Button>
          )}
          {can("model:manage") && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => startEdit(model)}>编辑</Button>}
          {can("model:manage") && (
            <Button type="text" size="small" icon={<ApartmentOutlined />} onClick={() => router.push(`/admin/ai/routing?modelId=${model.id}`)}>
              映射
            </Button>
          )}
          {can("model:manage") && (
            <Popconfirm title={`删除模型“${model.name}”？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void handleDelete(model.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <AdminPageHead
        title="前端模型管理"
        desc={`共 ${models.length} 个用户可见模型`}
        extra={can("model:manage") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增前端模型</Button>}
      />

      <Input.Search
        className={styles.searchBar}
        placeholder="搜索模型名称、前端模型标识"
        allowClear
        value={searchKeyword}
        onChange={(event) => setSearchKeyword(event.target.value)}
      />

      <Table<AdminAiModelVO>
        rowKey="id"
        columns={columns}
        dataSource={filteredModels}
        loading={loading}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: "暂无模型数据，点击右上角添加" }}
        pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal
        title={editingId ? "编辑前端模型" : "新增前端模型"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={980}
        styles={{ body: { maxHeight: "74vh", overflowY: "auto", paddingRight: 12 } }}
      >
        <div className={styles.formStack}>
          <div className={styles.notice}>
            这里配置的是用户端可见的逻辑模型；真实供应商、上游 model_id 和路由策略请到“模型映射”里维护。
          </div>

          <div className={styles.formGrid}>
            <Field label="名称 *">
              <Input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder="如：nano Image" />
            </Field>
            <Field label="前端模型标识 *" hint="用户端和生成接口传递的逻辑模型 ID，不需要等于真实上游 model_id。">
              <Input value={form.modelId} onChange={(event) => updateForm({ modelId: event.target.value })} placeholder="如：nano-banana-2" />
            </Field>
            <Field label="类型">
              <Select style={{ width: "100%" }} value={form.type} onChange={handleTypeChange} options={MODEL_TYPES} />
            </Field>
            {form.type !== "video" && (
              <Field label="消耗积分" hint="支持小数；最终扣费按生成张数、团队系数等规则向上取整。">
                <InputNumber style={{ width: "100%" }} min={0} step={0.1} value={form.pointCost} onChange={(value) => updateForm({ pointCost: value ?? 0 })} />
              </Field>
            )}
            <Field label="成本价（USD）" hint="上游单次成本，仅后台参考毛利，不对用户暴露。">
              <InputNumber style={{ width: "100%" }} min={0} step={0.0001} value={form.costPerCall} onChange={(value) => updateForm({ costPerCall: value ?? 0 })} />
            </Field>
            <Field label="图标" hint="显示在用户端模型选择处；推荐从图标库选择，便于复用和统一维护。">
              <div className={styles.iconField}>
                <IconPreview value={form.icon} />
                <Input value={form.icon} onChange={(event) => updateForm({ icon: event.target.value })} placeholder="emoji、图片 URL 或从图库选择" />
                <Button icon={<FileImageOutlined />} onClick={openIconLibrary}>选择图标</Button>
                <Button onClick={() => updateForm({ icon: "" })}>清空</Button>
              </div>
            </Field>
            <Field label="描述" hint="模型选择列表名称下方的副标题（选填）。">
              <Input value={form.description} onChange={(event) => updateForm({ description: event.target.value })} placeholder="如：文本能力突出，细节稳定" />
            </Field>
            <Field label="预计耗时（秒）" hint="模型选择列表右侧耗时徽标，0 表示不显示。">
              <InputNumber style={{ width: "100%" }} min={0} value={form.estSeconds} onChange={(value) => updateForm({ estSeconds: value ?? 0 })} />
            </Field>
            <Field label="参考图上限（MB）" hint="单文件硬上限 50MB，可按模型设置更小。">
              <InputNumber style={{ width: "100%" }} min={1} max={50} precision={0} value={form.referenceImageMaxMB} onChange={(value) => updateForm({ referenceImageMaxMB: value ?? 50 })} />
            </Field>
            <Field label="参考视频上限（MB）" hint="单文件硬上限 50MB，可按模型设置更小。">
              <InputNumber style={{ width: "100%" }} min={1} max={50} precision={0} value={form.referenceVideoMaxMB} onChange={(value) => updateForm({ referenceVideoMaxMB: value ?? 50 })} />
            </Field>
            {form.type === "image" && (
              <Field label="最多参考图数量" hint="首页图片对话每次允许添加的参考图数量。">
                <InputNumber style={{ width: "100%" }} min={0} max={20} precision={0} value={form.maxReferenceImages} onChange={(value) => updateForm({ maxReferenceImages: value ?? 4 })} />
              </Field>
            )}
            {form.type === "video" && (
              <>
                <Field label="最多参考文件数量" hint="图片与视频参考素材合计上限。">
                  <InputNumber style={{ width: "100%" }} min={0} max={20} precision={0} value={form.maxReferenceFiles} onChange={(value) => updateForm({ maxReferenceFiles: value ?? 12 })} />
                </Field>
                <Field label="最多参考视频数量">
                  <InputNumber style={{ width: "100%" }} min={0} max={10} precision={0} value={form.maxReferenceVideos} onChange={(value) => updateForm({ maxReferenceVideos: value ?? 2 })} />
                </Field>
              </>
            )}
          </div>

          {form.type === "text" && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>文本对话能力</div>
              <Space wrap>
                <CheckableTag checked={form.streaming} onChange={() => updateForm({ streaming: !form.streaming })} className={styles.optionTag}>流式输出</CheckableTag>
                <CheckableTag checked={form.multimodal} onChange={() => updateForm({ multimodal: !form.multimodal })} className={styles.optionTag}>原生多模态</CheckableTag>
                <CheckableTag checked={form.nativeFiles} onChange={() => updateForm({ nativeFiles: !form.nativeFiles })} className={styles.optionTag}>原生文件输入</CheckableTag>
              </Space>
              <div className={styles.formGrid}>
                <Field label="上下文窗口（tokens）">
                  <InputNumber style={{ width: "100%" }} min={1024} step={1024} precision={0} value={form.contextWindow} onChange={(value) => updateForm({ contextWindow: value ?? 128000 })} />
                </Field>
                <Field label="每条消息附件数" hint="平台硬上限为 10。">
                  <InputNumber style={{ width: "100%" }} min={1} max={10} precision={0} value={form.maxInputFiles} onChange={(value) => updateForm({ maxInputFiles: value ?? 10 })} />
                </Field>
                <Field label="单附件大小（MB）" hint="平台硬上限为 20MB。">
                  <InputNumber style={{ width: "100%" }} min={1} max={20} precision={0} value={form.maxFileSizeMB} onChange={(value) => updateForm({ maxFileSizeMB: value ?? 20 })} />
                </Field>
                <Field label="允许的 MIME 类型" hint="支持 image/* 通配；可直接输入并回车添加。">
                  <Select mode="tags" style={{ width: "100%" }} value={form.allowedMimeTypes} onChange={(values) => updateForm({ allowedMimeTypes: values })} tokenSeparators={[","]} />
                </Field>
              </div>
              <div className={styles.fieldHint}>非多模态模型会通过文档解析、RAG 与已配置的多模态模型 OCR 后继续对话；切换模型不会清空会话上下文。</div>
            </div>
          )}

          {form.type !== "text" && (
            <div className={styles.section}>
              {form.type === "image" && (
                <>
                  <TagGroup label="支持的生成方式" hint="不勾选表示不限制，画布显示全部模式。" options={HANDLER_CHOICES.image} selected={form.supportedHandlers} onToggle={(value) => toggleArr("supportedHandlers", value)} />
                  <TagGroup label="出图张数档位" hint="Midjourney 等固定 4 张只勾“4张”；不勾选时使用默认 1/2/4。" options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `${count}张` }))} selected={form.batchSizes.map(String)} onToggle={(value) => toggleBatchSize(Number(value))} />
                  <div>
                    <div className={styles.sectionTitle}>上游四宫格输出</div>
                    <Space>
                      <CheckableTag checked={form.gridOutput} onChange={() => updateForm({ gridOutput: true })} className={styles.optionTag}>是（单张 2×2 合图）</CheckableTag>
                      <CheckableTag checked={!form.gridOutput} onChange={() => updateForm({ gridOutput: false })} className={styles.optionTag}>否（独立多张）</CheckableTag>
                    </Space>
                    <div className={styles.fieldHint}>Midjourney 原生输出为一张 2×2 合图时选择“是”，生成后会自动切成 4 张组图。</div>
                  </div>
                  <TagGroup label="支持画质" options={QUALITY_OPTIONS.map((quality) => ({ value: quality.value, label: qualityLabel(quality.value) }))} selected={form.qualities} onToggle={(value) => toggleArr("qualities", value)} />
                  <TagGroup label="支持清晰度" options={CLARITY_OPTIONS.map((clarity) => ({ value: clarity, label: clarity }))} selected={form.clarities} onToggle={(value) => toggleArr("clarities", value)} />
                  <TagGroup label="支持比例" options={imageRatioOptions} selected={form.ratios} onToggle={(value) => toggleArr("ratios", value)} />
                  <PricingMatrix
                    corner="画质/清晰度"
                    rows={form.qualities.map((quality) => ({ key: quality, label: qualityLabel(quality) }))}
                    cols={form.clarities.map((clarity) => ({ key: clarity, label: clarity }))}
                    pricing={form.pricing}
                    onSet={setPricing}
                  />
                </>
              )}

              {form.type === "video" && (
                <>
                  <TagGroup label="支持的生成方式" hint="不勾选表示不限制；勾选后画布视频节点只显示所选模式 Tab。" options={HANDLER_CHOICES.video} selected={form.supportedHandlers} onToggle={(value) => toggleArr("supportedHandlers", value)} />
                  <TagGroup label="支持清晰度 *" options={VIDEO_RESOLUTIONS.map((resolution) => ({ value: resolution, label: resolution }))} selected={form.resolutions} onToggle={(value) => toggleArr("resolutions", value)} />
                  <TagGroup label="支持比例 *" options={videoRatioOptions} selected={form.ratios} onToggle={(value) => toggleArr("ratios", value)} />
                  <TagGroup
                    label="支持时长（秒） *"
                    hint="可选 4–30 秒；前台滑轨只展示已勾选档位。"
                    options={DURATION_CHOICES.map((duration) => ({ value: String(duration), label: `${duration}s` }))}
                    selected={form.durations.map(String)}
                    onToggle={(value) => toggleDuration(Number(value))}
                  />
                  <div>
                    <div className={styles.sectionTitle}>生成音频</div>
                    <Space>
                      <CheckableTag checked={form.audio} onChange={() => updateForm({ audio: true })} className={styles.optionTag}>支持</CheckableTag>
                      <CheckableTag checked={!form.audio} onChange={() => updateForm({ audio: false })} className={styles.optionTag}>不支持</CheckableTag>
                    </Space>
                  </div>
                  <div>
                    <div className={styles.sectionTitle}>Runware 参数结构</div>
                    <Space>
                      <CheckableTag checked={form.videoInputs} onChange={() => updateForm({ videoInputs: true })} className={styles.optionTag}>v2（inputs 嵌套）</CheckableTag>
                      <CheckableTag checked={!form.videoInputs} onChange={() => updateForm({ videoInputs: false })} className={styles.optionTag}>旧版（顶层平铺）</CheckableTag>
                    </Space>
                    <div className={styles.fieldHint}>Runware 新版视频模型（Seedance 2.0 等）通常使用 v2；非 Runware 或旧版保持“顶层平铺”。</div>
                  </div>
                  <VideoSecondPricing
                    resolutions={form.resolutions}
                    allowAudio={form.audio}
                    pricing={form.secondPricing}
                    onSet={setSecondPricing}
                  />
                </>
              )}

              {form.type === "audio" && (
                <div>
                  <div className={styles.sectionTitle}>音色列表</div>
                  <div className={styles.fieldHint}>音色 ID 来自供应商文档；显示名是画布音频节点下拉里的名称。</div>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    {form.voices.map((voice, index) => (
                      <Space key={`${voice.id}-${index}`}>
                        <Input
                          style={{ width: 220, fontFamily: "monospace", fontSize: 12 }}
                          placeholder="音色 ID"
                          value={voice.id}
                          onChange={(event) => setForm((prev) => ({
                            ...prev,
                            voices: prev.voices.map((item, voiceIndex) => voiceIndex === index ? { ...item, id: event.target.value } : item),
                          }))}
                        />
                        <Input
                          style={{ width: 180 }}
                          placeholder="显示名"
                          value={voice.name}
                          onChange={(event) => setForm((prev) => ({
                            ...prev,
                            voices: prev.voices.map((item, voiceIndex) => voiceIndex === index ? { ...item, name: event.target.value } : item),
                          }))}
                        />
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setForm((prev) => ({ ...prev, voices: prev.voices.filter((_, voiceIndex) => voiceIndex !== index) }))} />
                      </Space>
                    ))}
                  </Space>
                  <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => setForm((prev) => ({ ...prev, voices: [...prev.voices, { id: "", name: "" }] }))}>添加音色</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title="模型图标库"
        open={iconModalOpen}
        onCancel={() => setIconModalOpen(false)}
        footer={null}
        width={780}
      >
        <div className={styles.iconLibraryToolbar}>
          <div className={styles.fieldHint}>管理员上传后可在多个前端模型中复用；支持图片 URL、SVG 文件和常用位图格式。</div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void loadIcons()} loading={iconsLoading}>刷新</Button>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => iconFileInputRef.current?.click()} loading={iconUploading}>上传图标</Button>
          </Space>
        </div>
        <input
          ref={iconFileInputRef}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={handleIconFileChange}
        />
        {iconUploading && <Progress percent={iconUploadProgress} size="small" />}

        {icons.length === 0 && !iconsLoading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图标，点击右上角上传" />
        ) : (
          <div className={styles.iconGrid}>
            {icons.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.iconCard} ${form.icon === item.iconUrl ? styles.iconCardSelected : ""}`}
                onClick={() => selectIcon(item.iconUrl)}
              >
                <span className={styles.iconThumb}>
                  {isImageIcon(item.iconUrl) ? <AntImage src={item.iconUrl} alt={item.name} width={44} height={44} preview={false} fallback="" /> : item.iconUrl}
                </span>
                <span className={styles.iconName} title={item.name}>{item.name}</span>
                {item.fileSize > 0 && <Tag>{formatSize(item.fileSize)}</Tag>}
                {can("model:manage") && (
                  <span className={styles.iconDelete} onClick={(event) => event.stopPropagation()}>
                    <Popconfirm title={`删除图标“${item.name}”？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void handleIconDelete(item.id)}>
                      <Button size="small" danger shape="circle" icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className={styles.iconFooter}>
          <Field label="手动输入图标">
            <Input value={manualIconValue} onChange={(event) => setManualIconValue(event.target.value)} placeholder="emoji、图片 URL、data:image..." />
          </Field>
          <Button onClick={() => selectIcon(manualIconValue.trim())} disabled={!manualIconValue.trim()}>使用当前输入</Button>
        </div>
      </Modal>
    </div>
  );
}
