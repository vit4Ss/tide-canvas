"use client";

/* ============================================================================
   /admin/skills — 技能管理（技能广场内容运营）。

   与公开技能广场（/api/skills，chat/创作台/画布三入口的技能选择器）共用同一张
   skill 表：这里的增删改与上下架立即反映到用户端。挂 admin.skills 模块权限。

   表单要点：outputType 决定各入口的模态过滤；promptTemplate 是技能核心（发送
   时模板在前、用户描述在后合并）；关联模型可选（选了则用户点技能时自动切换
   模型卡）；defaultParams 为 JSON 对象（aspectRatio/resolution/duration/quality）。
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, Sparkles, Upload } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FilterChips,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
  TableSkeleton,
  type Column,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminSkillsApi } from "@/lib/admin-skills-api";
import { aiApi, uploadFileSmart } from "@/lib/api";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { SKILL_CATEGORIES, SKILL_OUTPUT_LABEL, type SkillSaveDTO, type SkillVO } from "@/types/skill";
import type { AiModelVO } from "@/types/ai";

const PAGE_SIZE = 20;
const OUTPUT_OPTIONS = ["image", "video", "audio", "text"] as const;

interface SkillForm {
  title: string;
  description: string;
  coverUrl: string;
  category: string;
  outputType: string;
  promptTemplate: string;
  modelId: string;
  defaultParams: string;
  authorName: string;
  status: number;
  sortOrder: string;
}

const EMPTY_FORM: SkillForm = {
  title: "",
  description: "",
  coverUrl: "",
  category: SKILL_CATEGORIES[0],
  outputType: "image",
  promptTemplate: "",
  modelId: "",
  defaultParams: "",
  authorName: "官方",
  status: 1,
  sortOrder: "0",
};

export default function AdminSkillsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<SkillVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catIdx, setCatIdx] = useState(0);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SkillVO | null>(null);
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // 关联模型下拉：全部启用模型，按表单 outputType 过滤同模态的卡
  const [models, setModels] = useState<AiModelVO[]>([]);
  useEffect(() => {
    let alive = true;
    aiApi
      .listModels()
      .then((res) => {
        if (alive && res.success) setModels(res.data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const CAT_FILTERS = ["全部", ...SKILL_CATEGORIES];

  // reqId 守卫:快速切分类/搜索时旧响应后到不覆盖新结果
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const category = catIdx > 0 ? CAT_FILTERS[catIdx] : undefined;
      const res = await adminSkillsApi.list({
        pageNum,
        pageSize: PAGE_SIZE,
        category,
        keyword: keyword || undefined,
      });
      if (id !== reqIdRef.current) return;
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载失败");
      }
    } catch {
      if (id === reqIdRef.current) setError("加载失败，请稍后重试");
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureSession, catIdx, pageNum, keyword]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (r: SkillVO) => {
    setEditing(r);
    setForm({
      title: r.title,
      description: r.description,
      coverUrl: r.coverUrl,
      category: r.category,
      outputType: r.outputType,
      promptTemplate: r.promptTemplate,
      modelId: r.modelId,
      defaultParams: r.defaultParams,
      authorName: r.authorName,
      status: r.status,
      sortOrder: String(r.sortOrder),
    });
    setModalOpen(true);
  };

  const uploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverUploading(true);
    try {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        setForm((f) => ({ ...f, coverUrl: res.data.fileUrl }));
        toast.success("封面已上传");
      } else {
        toast.error(res.message || "封面上传失败");
      }
    } catch {
      toast.error("封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  };

  const buildDTO = (): SkillSaveDTO | null => {
    if (!form.title.trim()) {
      toast.error("请填写技能名称");
      return null;
    }
    if (!form.promptTemplate.trim()) {
      toast.error("请填写技能提示词模板");
      return null;
    }
    const params = form.defaultParams.trim();
    if (params) {
      try {
        const v = JSON.parse(params);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not object");
      } catch {
        toast.error('默认参数需为 JSON 对象，如 {"aspectRatio":"16:9","duration":5}');
        return null;
      }
    }
    return {
      title: form.title.trim(),
      description: form.description.trim(),
      coverUrl: form.coverUrl.trim(),
      category: form.category,
      outputType: form.outputType,
      promptTemplate: form.promptTemplate,
      modelId: form.modelId,
      defaultParams: params,
      authorName: form.authorName.trim(),
      status: form.status,
      sortOrder: parseInt(form.sortOrder, 10) || 0,
    };
  };

  const save = async () => {
    const dto = buildDTO();
    if (!dto) return false;
    setSaving(true);
    try {
      const res = editing
        ? await adminSkillsApi.update(editing.id, dto)
        : await adminSkillsApi.create(dto);
      if (!res.success) {
        toast.error(res.message || "保存失败");
        return false;
      }
      toast.success(editing ? "技能已更新" : "技能已创建");
      setModalOpen(false);
      await load();
    } catch {
      toast.error("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 上/下架：用行数据构造完整 DTO（update 为全量覆盖），只翻转 status
  const toggleStatus = async (r: SkillVO) => {
    const res = await adminSkillsApi.update(r.id, {
      title: r.title,
      description: r.description,
      coverUrl: r.coverUrl,
      category: r.category,
      outputType: r.outputType,
      promptTemplate: r.promptTemplate,
      modelId: r.modelId,
      defaultParams: r.defaultParams,
      authorName: r.authorName,
      status: r.status === 1 ? 0 : 1,
      sortOrder: r.sortOrder,
    });
    if (res.success) await load();
    else toast.error(res.message || "状态更新失败");
  };

  const remove = async (r: SkillVO) => {
    if (
      !(await confirmDialog({
        title: "删除技能",
        message: `确定删除技能「${r.title}」？用户端技能广场将立即不可见。此操作不可恢复。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminSkillsApi.delete(r.id);
    if (res.success) {
      toast.success("已删除");
      if (rows.length === 1 && pageNum > 1) setPageNum(pageNum - 1);
      else await load();
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const modelName = (modelId: string) => models.find((m) => m.modelId === modelId)?.name || modelId;

  const columns: Column<SkillVO>[] = [
    {
      header: "技能",
      width: "32%",
      cell: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 64,
              height: 44,
              borderRadius: 8,
              overflow: "hidden",
              flex: "none",
              background: "var(--panel-hover, #f0f0f2)",
              display: "grid",
              placeItems: "center",
            }}
          >
            {r.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Sparkles size={16} style={{ opacity: 0.4 }} />
            )}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="strong" style={{ display: "block" }}>{r.title}</span>
            <span className="muted" style={{ display: "block", fontSize: 12, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.description || "—"}
            </span>
          </span>
        </div>
      ),
    },
    { header: "分类", className: "muted", cell: (r) => r.category || "—" },
    {
      header: "输出",
      cell: (r) => <StatusPill tone="blue">{SKILL_OUTPUT_LABEL[r.outputType] ?? r.outputType}</StatusPill>,
    },
    { header: "关联模型", className: "muted", cell: (r) => (r.modelId ? modelName(r.modelId) : "跟随用户") },
    { header: "使用数", align: "right", cell: (r) => r.useCount, sortValue: (r) => r.useCount },
    { header: "排序", align: "right", className: "muted", cell: (r) => r.sortOrder },
    {
      header: "状态",
      cell: (r) => (
        <StatusPill tone={r.status === 1 ? "green" : "gray"}>{r.status === 1 ? "已上架" : "已下架"}</StatusPill>
      ),
    },
    {
      header: "操作",
      align: "right",
      cell: (r) => (
        <RowActions
          actions={[
            { label: "编辑", onClick: () => openEdit(r) },
            { label: r.status === 1 ? "下架" : "上架", onClick: () => toggleStatus(r) },
            { label: "删除", danger: true, onClick: () => remove(r) },
          ]}
        />
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const formModels = models.filter((m) => m.type === form.outputType);

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="操作未完成"
          action={
            <button type="button" className="adm-btn ghost" onClick={load}>
              <RefreshCw aria-hidden size={15} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="技能广场"
        sub={`共 ${total} 个技能 · 第 ${pageNum}/${pageCount} 页 · 上下架即时生效于对话 / 创作台 / 画布`}
        tools={
          <>
            <div className="adm-search" role="search">
              <Search aria-hidden size={15} />
              <input
                aria-label="搜索技能"
                placeholder="名称 / 描述"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setKeyword(query.trim());
                    setPageNum(1);
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="adm-btn ghost"
              onClick={() => {
                setKeyword(query.trim());
                setPageNum(1);
              }}
            >
              搜索
            </button>
            <button type="button" className="adm-btn" onClick={openCreate}>
              <Plus aria-hidden size={15} />
              新建技能
            </button>
          </>
        }
      >
        <div className="adm-tools" style={{ padding: "14px 20px 6px" }}>
          <FilterChips
            label="分类"
            options={CAT_FILTERS}
            value={CAT_FILTERS[catIdx]}
            onChange={(_, i) => {
              setCatIdx(i);
              setPageNum(1);
            }}
          />
        </div>

        {loading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title="还没有技能"
            description="创建技能后，会出现在对话、创作台与画布节点的技能选择器里。"
            action={
              <button type="button" className="adm-btn" onClick={openCreate}>
                <Plus aria-hidden size={15} />
                新建技能
              </button>
            }
          />
        ) : (
          <AdminTable<SkillVO>
            rows={rows}
            rowKey={(r) => r.id}
            columns={columns}
            label="技能列表"
            server={{ page: pageNum, pageSize: PAGE_SIZE, total, onPage: setPageNum }}
          />
        )}
      </Panel>

      {/* 新建 / 编辑 */}
      <AdminModal
        open={modalOpen}
        size="lg"
        title={editing ? `编辑技能 · ${editing.title}` : "新建技能"}
        subtitle="技能 = 提示词模板 + 指定模型 + 默认参数的打包卡片"
        saveLabel={saving ? "保存中…" : "保存"}
        onClose={() => setModalOpen(false)}
        onSave={save}
      >
        <FormCard title="基本信息">
          <FormGrid>
            <Field label="技能名称" required span={2}>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="如：韦斯安德森电影美学"
                maxLength={64}
              />
            </Field>
            <Field label="分类" span={2}>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {SKILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="一句话描述" span={4} hint="技能卡片上的副标题">
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="如：深度还原韦氏标志性视听语言，适用 15 秒-5 分钟电影短片或广告"
                maxLength={255}
              />
            </Field>
            <Field label="封面图" span={4} hint="技能卡片封面，建议 16:9 横图；可直接上传或粘贴 URL">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={form.coverUrl}
                  onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
                  placeholder="https://…"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="adm-btn ghost"
                  disabled={coverUploading}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <Upload aria-hidden size={14} />
                  {coverUploading ? "上传中…" : "上传"}
                </button>
                <input ref={coverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadCover} />
              </div>
            </Field>
            <Field label="作者署名" span={2} hint="卡片上的作者展示">
              <input
                value={form.authorName}
                onChange={(e) => setForm((f) => ({ ...f, authorName: e.target.value }))}
                maxLength={64}
              />
            </Field>
            <Field label="排序" span={2} hint="小值在前">
              <input
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value.replace(/[^0-9-]/g, "") }))}
                inputMode="numeric"
              />
            </Field>
            <Field label="状态" span={2}>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: Number(e.target.value) }))}
              >
                <option value={1}>上架</option>
                <option value={0}>下架</option>
              </select>
            </Field>
          </FormGrid>
        </FormCard>

        <FormCard title="生成配置">
          <FormGrid>
            <Field label="输出类型" required span={2} hint="决定技能出现在哪些入口（图片节点只列图片技能）">
              <select
                value={form.outputType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, outputType: e.target.value, modelId: "" }))
                }
              >
                {OUTPUT_OPTIONS.map((t) => (
                  <option key={t} value={t}>{SKILL_OUTPUT_LABEL[t]}</option>
                ))}
              </select>
            </Field>
            <Field label="关联模型" span={2} hint="选定后用户点技能时自动切到该模型卡；留空跟随用户当前模型">
              <select
                value={form.modelId}
                onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
              >
                <option value="">跟随用户当前模型</option>
                {formModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field
              label="技能提示词模板"
              required
              span={4}
              hint="技能核心：发送时模板在前、用户描述在后合并为最终提示词"
            >
              <textarea
                rows={6}
                value={form.promptTemplate}
                onChange={(e) => setForm((f) => ({ ...f, promptTemplate: e.target.value }))}
                placeholder="如：以韦斯·安德森的电影美学呈现：对称构图、马卡龙色调、平移镜头、复古字体标题卡……"
              />
            </Field>
            <Field
              label="默认参数"
              span={4}
              hint={'可选 JSON 对象：aspectRatio / resolution / duration / quality，如 {"aspectRatio":"16:9","duration":5}'}
            >
              <input
                value={form.defaultParams}
                onChange={(e) => setForm((f) => ({ ...f, defaultParams: e.target.value }))}
                placeholder='{"aspectRatio":"16:9"}'
                style={{ fontFamily: "var(--mono)" }}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}
