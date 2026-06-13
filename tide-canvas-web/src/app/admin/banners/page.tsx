"use client";

import { useEffect, useState } from "react";
import { adminApi, uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import type { BannerVO, BannerCreateDTO } from "@/types/admin";
import {
  Plus,
  Trash2,
  Edit,
  Save,
  Image as ImageIcon,
  Eye,
  EyeOff,
  GripVertical,
  ExternalLink,
  Upload,
  Loader2,
  X,
} from "lucide-react";
import {
  PageHeader,
  ConfirmDialog,
  FormSection,
  TextField,
  NumberField,
  SelectField,
  EmptyState,
  CardSkeleton,
} from "@/components/shared";

interface BannerForm {
  title: string;
  imageUrl: string;
  linkUrl: string;
  sortOrder: number;
  status: number;
}

const emptyForm: BannerForm = {
  title: "",
  imageUrl: "",
  linkUrl: "",
  sortOrder: 0,
  status: 1,
};

export default function AdminBannersPage() {
  const [banners, setBanners] = useState<BannerVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BannerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        setForm((prev) => ({ ...prev, imageUrl: res.data!.fileUrl }));
        toast.success("图片已上传");
      } else {
        toast.error(res.message || "上传失败");
      }
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  };

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

  useEffect(() => {
    loadBanners();
  }, []);

  const handleSave = async () => {
    if (!form.title || !form.imageUrl) return;
    setSaving(true);
    try {
      const payload: BannerCreateDTO = {
        title: form.title,
        imageUrl: form.imageUrl,
        linkUrl: form.linkUrl || undefined,
        sortOrder: form.sortOrder,
        status: form.status,
      };

      if (editingId) {
        const res = await adminApi.banners.update(editingId, payload);
        if (res.success) {
          setEditingId(null);
          setForm(emptyForm);
          loadBanners();
        }
      } else {
        const res = await adminApi.banners.create(payload);
        if (res.success) {
          setShowForm(false);
          setForm(emptyForm);
          loadBanners();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await adminApi.banners.delete(deleteTarget.id);
    if (res.success) loadBanners();
    setDeleteTarget(null);
  };

  const handleToggleStatus = async (banner: BannerVO) => {
    await adminApi.banners.update(banner.id, { status: banner.status === 1 ? 0 : 1 });
    loadBanners();
  };

  const startEdit = (banner: BannerVO) => {
    setEditingId(banner.id);
    setShowForm(false);
    setForm({
      title: banner.title,
      imageUrl: banner.imageUrl,
      linkUrl: banner.linkUrl ?? "",
      sortOrder: banner.sortOrder,
      status: banner.status,
    });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const isFormOpen = showForm || editingId !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banner 管理"
        description={`共 ${banners.length} 个 Banner，${banners.filter((b) => b.status === 1).length} 个显示中`}
        actions={
          !isFormOpen ? (
            <button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setForm(emptyForm);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
            >
              <Plus className="h-4 w-4" /> 新增 Banner
            </button>
          ) : undefined
        }
      />

      {/* 新增/编辑表单 */}
      {isFormOpen && (
        <FormSection title={editingId ? "编辑 Banner" : "新增 Banner"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="标题"
              required
              value={form.title}
              onChange={(v) => setForm({ ...form, title: v })}
              placeholder="Banner 标题"
            />
            <div>
              <TextField
                label="图片 URL"
                required
                value={form.imageUrl}
                onChange={(v) => setForm({ ...form, imageUrl: v })}
                placeholder="https://example.com/banner.jpg 或点击下方上传"
              />
              <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploading ? "上传中..." : "上传图片"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <TextField
              label="跳转链接"
              value={form.linkUrl}
              onChange={(v) => setForm({ ...form, linkUrl: v })}
              placeholder="https://example.com/page"
            />
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                label="排序"
                value={form.sortOrder}
                onChange={(v) => setForm({ ...form, sortOrder: v })}
                min={0}
                hint="数字越小越靠前"
              />
              <SelectField
                label="状态"
                value={form.status}
                onChange={(v) => setForm({ ...form, status: Number(v) })}
                options={[
                  { value: 1, label: "显示" },
                  { value: 0, label: "隐藏" },
                ]}
              />
            </div>
          </div>
          {/* 图片预览 */}
          {form.imageUrl && (
            <div>
              <label className="block text-sm font-medium text-neutral-500">图片预览</label>
              <div className="mt-1 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
                <img
                  src={form.imageUrl}
                  alt="预览"
                  className="h-32 w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              <Save className="h-4 w-4" /> {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={cancelForm}
              className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              取消
            </button>
          </div>
        </FormSection>
      )}

      {/* Banner 列表 */}
      {loading ? (
        <CardSkeleton count={3} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" />
      ) : banners.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="暂无 Banner"
          description="点击上方按钮添加第一个 Banner"
          className="h-64 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {banners.map((banner) => (
            <div
              key={banner.id}
              className={`group overflow-hidden rounded-xl border bg-white transition-all hover:shadow-md dark:bg-neutral-950 ${
                banner.status === 1
                  ? "border-neutral-200 dark:border-neutral-800"
                  : "border-dashed border-neutral-300 opacity-60 dark:border-neutral-700"
              }`}
            >
              {/* 图片预览 */}
              <div className="relative h-36 bg-neutral-100 dark:bg-neutral-800">
                {banner.imageUrl ? (
                  <img
                    src={banner.imageUrl}
                    alt={banner.title}
                    className="h-full w-full object-cover cursor-pointer"
                    onClick={() => setPreviewUrl(banner.imageUrl)}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="h-8 w-8 text-neutral-400" />
                  </div>
                )}
                {/* 排序标签 */}
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 text-xs text-white">
                  <GripVertical className="h-3 w-3" />
                  排序: {banner.sortOrder}
                </div>
                {/* 状态标签 */}
                <div
                  className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    banner.status === 1
                      ? "bg-green-500 text-white"
                      : "bg-neutral-500 text-white"
                  }`}
                >
                  {banner.status === 1 ? "显示" : "隐藏"}
                </div>
              </div>

              {/* 信息 */}
              <div className="p-4">
                <h3 className="font-semibold truncate">{banner.title}</h3>
                {banner.linkUrl && (
                  <a
                    href={banner.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1 text-xs text-blue-500 hover:underline truncate"
                  >
                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    {banner.linkUrl}
                  </a>
                )}
                <p className="mt-2 text-xs text-neutral-400">
                  {banner.createTime ? new Date(banner.createTime).toLocaleDateString("zh-CN") : "-"}
                </p>

                {/* 操作按钮 */}
                <div className="mt-3 flex items-center gap-1 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                  <button
                    onClick={() => handleToggleStatus(banner)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      banner.status === 1
                        ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        : "text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                    }`}
                  >
                    {banner.status === 1 ? (
                      <>
                        <EyeOff className="h-3.5 w-3.5" /> 隐藏
                      </>
                    ) : (
                      <>
                        <Eye className="h-3.5 w-3.5" /> 显示
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => startEdit(banner)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    <Edit className="h-3.5 w-3.5" /> 编辑
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: banner.id, title: banner.title })}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除 Banner"
        message={deleteTarget ? `确定删除 Banner「${deleteTarget.title}」？此操作不可撤销。` : ""}
        danger
        confirmText="删除"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 图片预览弹窗 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-h-[80vh] max-w-[80vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewUrl}
              alt="预览"
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-600 shadow-lg hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
