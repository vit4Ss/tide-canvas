"use client";

/* ============================================================================
   /admin/skills — 技能管理（技能广场内容运营）。

   与公开技能广场（/api/skills，chat/创作台/画布三入口的技能选择器）共用同一张
   skill 表：这里的增删改与上下架立即反映到用户端。挂 admin.skills 模块权限。

   运营表单将展示说明与执行内容分层：Skill 内容保存为标准 SKILL.md，
   使用场景、使用方法与输出说明作为目录元数据；底层继续走不可变版本执行链路。
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Plus, RefreshCw, Search, Sparkles, Upload, Wrench } from "lucide-react";
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
import {
  SKILL_CATEGORIES,
  SKILL_KIND_LABEL,
  SKILL_OUTPUT_LABEL,
  type SkillEntryPoint,
  type SkillKind,
  type SkillOutputType,
  type SkillSaveDTO,
} from "@/types/skill";
import type { AiModelVO } from "@/types/ai";
import type { AdminSkillImportPackage, AdminSkillVO } from "@/types/admin-skill";
import {
  ADMIN_SKILL_ENTRY_POINTS,
  constrainAdminSkillEntryPoints,
  defaultAdminSkillBindings,
  defaultAdminSkillEntryPoints,
  defaultAdminSkillOutputTypes,
  starterAdminSkillInputSchema,
  starterAdminSkillManifest,
} from "@/lib/admin-skill-defaults";
import { isOperatorEditablePresetVersion } from "@/lib/admin-skill-operator-compat";
import { SkillVersionModal } from "./_components/skill-version-modal";
import { SkillImportModal } from "./_components/skill-import-modal";
import {
  MAX_OPERATOR_SKILL_DOCUMENT_BYTES,
  OperatorSkillContentEditor,
} from "./_components/operator-skill-content-editor";

const PAGE_SIZE = 20;
const OUTPUT_OPTIONS: readonly SkillOutputType[] = ["image", "video", "audio", "text", "file"];

const KIND_OPTIONS: Array<{
  key: SkillKind;
  title: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    key: "preset",
    title: "预设技能",
    description: "把专业经验封装成提示词、模型和默认参数，单次执行。",
    icon: Sparkles,
  },
  {
    key: "agent",
    title: "智能技能",
    description: "在画布中与用户持续沟通，可跨图片、视频、音频等节点完成任务。",
    icon: Bot,
  },
  {
    key: "tool",
    title: "技能工具",
    description: "在创作台或 API 中生成文件、分析媒体与网页，由受控工具执行。",
    icon: Wrench,
  },
];

interface SkillForm {
  kind: SkillKind;
  entryPoints: SkillEntryPoint[];
  title: string;
  description: string;
  coverUrl: string;
  category: string;
  outputType: SkillOutputType;
  promptTemplate: string;
  usageScenario: string;
  usageGuide: string;
  outputDescription: string;
  modelId: string;
  defaultParams: string;
  authorName: string;
  status: number;
  sortOrder: string;
}

const EMPTY_FORM: SkillForm = {
  kind: "preset",
  entryPoints: defaultAdminSkillEntryPoints("preset"),
  title: "",
  description: "",
  coverUrl: "",
  category: SKILL_CATEGORIES[0],
  outputType: "image",
  promptTemplate: "",
  usageScenario: "",
  usageGuide: "",
  outputDescription: "",
  modelId: "",
  defaultParams: "",
  authorName: "官方",
  status: 1,
  sortOrder: "0",
};

function formFingerprint(value: SkillForm): string {
  return JSON.stringify(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export default function AdminSkillsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<AdminSkillVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catIdx, setCatIdx] = useState(0);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSkillVO | null>(null);
  const [versioning, setVersioning] = useState<AdminSkillVO | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  // An upload may finish after the editor was closed or reopened for another
  // skill. Only the editor generation that started it may update the form.
  const coverUploadSeqRef = useRef(0);
  const executionAuditSeqRef = useRef(0);
  const initialFormFingerprintRef = useRef("");
  const skipCloseConfirmationRef = useRef(false);
  const closeConfirmationPendingRef = useRef(false);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const defaultParamsInputRef = useRef<HTMLInputElement>(null);
  const [contentAccess, setContentAccess] = useState<"editable" | "checking" | "locked">("editable");
  const [coverPreviewFailed, setCoverPreviewFailed] = useState(false);
  const editingVersionedSkill = !!editing && editing.kind !== "preset";

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
    const nextForm = { ...EMPTY_FORM, entryPoints: [...EMPTY_FORM.entryPoints] };
    coverUploadSeqRef.current += 1;
    executionAuditSeqRef.current += 1;
    skipCloseConfirmationRef.current = false;
    closeConfirmationPendingRef.current = false;
    initialFormFingerprintRef.current = formFingerprint(nextForm);
    setCoverUploading(false);
    setCoverPreviewFailed(false);
    setContentAccess("editable");
    setEditing(null);
    setForm(nextForm);
    setModalOpen(true);
  };

  const openEdit = (r: AdminSkillVO) => {
    const kind = r.kind || "preset";
    const nextForm: SkillForm = {
      kind,
      entryPoints: constrainAdminSkillEntryPoints(kind, r.entryPoints),
      title: r.title,
      description: r.description,
      coverUrl: r.coverUrl,
      category: r.category,
      outputType: r.outputType as SkillOutputType,
      promptTemplate: r.promptTemplate,
      usageScenario: r.usageScenario || "",
      usageGuide: r.howTo || "",
      outputDescription: r.outputDescription || "",
      modelId: r.modelId,
      defaultParams: r.defaultParams,
      authorName: r.authorName,
      status: r.status,
      sortOrder: String(r.sortOrder),
    };
    coverUploadSeqRef.current += 1;
    const auditSequence = ++executionAuditSeqRef.current;
    skipCloseConfirmationRef.current = false;
    closeConfirmationPendingRef.current = false;
    initialFormFingerprintRef.current = formFingerprint(nextForm);
    setCoverUploading(false);
    setCoverPreviewFailed(false);
    setContentAccess(r.kind === "preset" && r.currentVersionId ? "checking" : r.kind === "preset" ? "editable" : "locked");
    setEditing(r);
    setForm(nextForm);
    setModalOpen(true);
    if (r.kind !== "preset" || !r.currentVersionId) return;
    void adminSkillsApi.getVersion(r.id, r.currentVersionId)
      .then((res) => {
        if (auditSequence !== executionAuditSeqRef.current) return;
        if (!res.success || !res.data) {
          setContentAccess("locked");
          toast.info("未能确认当前版本文件结构，已保护执行内容；仍可修改展示资料");
          return;
        }
        setContentAccess(isOperatorEditablePresetVersion(res.data, r.outputType) ? "editable" : "locked");
      })
      .catch(() => {
        if (auditSequence !== executionAuditSeqRef.current) return;
        setContentAccess("locked");
        toast.info("未能确认当前版本文件结构，已保护执行内容；仍可修改展示资料");
      });
  };

  const closeEditorImmediately = () => {
    coverUploadSeqRef.current += 1;
    executionAuditSeqRef.current += 1;
    setCoverUploading(false);
    setModalOpen(false);
  };

  const closeEditor = () => {
    if (skipCloseConfirmationRef.current) {
      skipCloseConfirmationRef.current = false;
      closeEditorImmediately();
      return;
    }
    if (formFingerprint(form) === initialFormFingerprintRef.current) {
      closeEditorImmediately();
      return;
    }
    if (closeConfirmationPendingRef.current) return;
    closeConfirmationPendingRef.current = true;
    void confirmDialog({
      title: "放弃未保存的修改？",
      message: "当前 Skill 表单还有未保存内容，关闭后无法恢复。",
      confirmText: "放弃修改",
    }).then((confirmed) => {
      if (confirmed) closeEditorImmediately();
    }).finally(() => {
      closeConfirmationPendingRef.current = false;
    });
  };

  const toggleEntryPoint = (entryPoint: SkillEntryPoint) => {
    setForm((current) => {
      if (current.kind === "agent") return current;
      if (current.kind === "preset" && entryPoint === "api") return current;
      if (current.kind === "tool" && entryPoint !== "studio" && entryPoint !== "api") return current;
      return {
        ...current,
        entryPoints: current.entryPoints.includes(entryPoint)
          ? current.entryPoints.filter((item) => item !== entryPoint)
          : [...current.entryPoints, entryPoint],
      };
    });
  };

  const uploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.toLowerCase().startsWith("image/")) {
      toast.error("封面只能上传图片文件");
      return;
    }
    const uploadSeq = ++coverUploadSeqRef.current;
    setCoverUploading(true);
    try {
      const res = await uploadFileSmart(file, undefined, {
        maxBytes: 10 * 1024 * 1024,
        label: "技能封面",
      });
      if (uploadSeq !== coverUploadSeqRef.current) return;
      if (res.success && res.data?.fileUrl) {
        setCoverPreviewFailed(false);
        setForm((f) => ({ ...f, coverUrl: res.data.fileUrl }));
        toast.success("封面已上传");
      } else {
        toast.error(res.message || "封面上传失败");
      }
    } catch {
      if (uploadSeq === coverUploadSeqRef.current) toast.error("封面上传失败");
    } finally {
      if (uploadSeq === coverUploadSeqRef.current) setCoverUploading(false);
    }
  };

  const buildDTO = (): {
    dto: SkillSaveDTO;
    defaultParams: Record<string, unknown>;
  } | null => {
    if (editing && !editingVersionedSkill && contentAccess === "checking") {
      toast.info("正在检查当前版本，请稍候再保存");
      return null;
    }
    if (
      editing &&
      !editingVersionedSkill &&
      contentAccess === "locked" &&
      (
        form.promptTemplate !== editing.promptTemplate ||
        form.outputType !== editing.outputType ||
        form.modelId !== editing.modelId ||
        form.defaultParams !== editing.defaultParams
      )
    ) {
      toast.error("高级文件包的执行配置只能在“版本与运行配置”中修改");
      return null;
    }
    if (!form.title.trim()) {
      toast.error("请填写技能名称");
      return null;
    }
    if (!editingVersionedSkill && !form.promptTemplate.trim()) {
      toast.error("请填写 Skill 内容");
      return null;
    }
    const executionContentChanged = !editing || form.promptTemplate !== editing.promptTemplate;
    if (
      !editingVersionedSkill &&
      executionContentChanged &&
      utf8ByteLength(form.promptTemplate) > MAX_OPERATOR_SKILL_DOCUMENT_BYTES
    ) {
      toast.error("Skill 内容不能超过 512 KiB，请精简后再保存");
      return null;
    }
    if (!editing && !form.description.trim()) {
      toast.error("请填写一句话介绍");
      return null;
    }
    if (!editing && !form.usageScenario.trim()) {
      toast.error("请填写使用场景");
      return null;
    }
    if (!editing && !form.usageGuide.trim()) {
      toast.error("请填写如何使用");
      return null;
    }
    if (!editing && !form.outputDescription.trim()) {
      toast.error("请填写输出内容");
      return null;
    }
    if (!editing && !form.entryPoints.length) {
      toast.error("请至少选择一个使用入口");
      return null;
    }
    const params = form.defaultParams.trim();
    let defaultParams: Record<string, unknown> = {};
    if (params) {
      try {
        const v = JSON.parse(params);
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not object");
        defaultParams = v as Record<string, unknown>;
      } catch {
        if (advancedRef.current) advancedRef.current.open = true;
        requestAnimationFrame(() => defaultParamsInputRef.current?.focus());
        toast.error('默认参数需为 JSON 对象，如 {"aspectRatio":"16:9","duration":5}');
        return null;
      }
    }
    return {
      defaultParams,
      dto: {
        title: form.title.trim(),
        description: form.description.trim(),
        usageScenario: form.usageScenario.trim(),
        howTo: form.usageGuide.trim(),
        outputDescription: form.outputDescription.trim(),
        coverUrl: form.coverUrl.trim(),
        category: form.category,
        outputType: form.outputType,
        promptTemplate: form.promptTemplate,
        modelId: form.modelId,
        defaultParams: params,
        authorName: form.authorName.trim(),
        status: form.status,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      },
    };
  };

  const save = async () => {
    if (coverUploading) {
      toast.info("封面仍在上传，请稍候再保存");
      return false;
    }
    const prepared = buildDTO();
    if (!prepared) return false;
    setSaving(true);
    try {
      if (editing) {
        const res = await adminSkillsApi.update(editing.id, prepared.dto);
        if (!res.success) {
          toast.error(res.message || "保存失败");
          return false;
        }
      } else {
        const primaryOutputType = form.outputType as SkillOutputType;
        const entryPoints = constrainAdminSkillEntryPoints(form.kind, form.entryPoints);
        const outputTypes = defaultAdminSkillOutputTypes(form.kind, primaryOutputType);
        const skillPackage: AdminSkillImportPackage = {
          title: prepared.dto.title,
          description: prepared.dto.description,
          usageScenario: prepared.dto.usageScenario,
          howTo: prepared.dto.howTo,
          outputDescription: prepared.dto.outputDescription,
          coverUrl: prepared.dto.coverUrl,
          category: prepared.dto.category,
          authorName: prepared.dto.authorName,
          status: prepared.dto.status,
          sortOrder: prepared.dto.sortOrder,
          kind: form.kind,
          entryPoints,
          primaryOutputType,
          outputTypes,
          inputSchema: starterAdminSkillInputSchema(form.kind, primaryOutputType),
          manifest: starterAdminSkillManifest(form.kind, primaryOutputType, form.modelId),
          promptTemplate: prepared.dto.promptTemplate,
          modelId: form.modelId,
          defaultParams: prepared.defaultParams,
          bindings: defaultAdminSkillBindings(entryPoints, primaryOutputType),
          publish: true,
        };
        const res = await adminSkillsApi.importSkills([skillPackage]);
        if (!res.success) {
          toast.error(res.message || "创建 Skill 失败");
          return false;
        }
      }
      toast.success(editing ? "技能已更新" : "技能已创建");
      await load();
      skipCloseConfirmationRef.current = true;
      return true;
    } catch {
      toast.error("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 上/下架沿用旧的目录 DTO；新增运营说明字段未携带时由后端保持原值。
  const toggleStatus = async (r: AdminSkillVO) => {
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

  const remove = async (r: AdminSkillVO) => {
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

  const columns: Column<AdminSkillVO>[] = [
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
    {
      header: "形态",
      cell: (r) => (
        <StatusPill tone={r.kind === "preset" ? "gray" : "blue"}>
          {SKILL_KIND_LABEL[r.kind || "preset"]}
        </StatusPill>
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
            { label: "编辑资料", onClick: () => openEdit(r) },
            { label: "版本与运行配置", onClick: () => setVersioning(r) },
            { label: r.status === 1 ? "下架" : "上架", onClick: () => toggleStatus(r) },
            { label: "删除", danger: true, onClick: () => remove(r) },
          ]}
        />
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Tool files are planned/analyzed by a text model; the deterministic
  // renderer itself has no market-model modality.
  const formModelType = form.kind === "tool" ? "text" : form.outputType;
  const formModels = models.filter((m) => m.type === formModelType);

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
            <button type="button" className="adm-btn ghost" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden size={15} />
              导入 Skill
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
          <AdminTable<AdminSkillVO>
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
        size="xl"
        title={editing ? `编辑技能 · ${editing.title}` : "新建技能"}
        subtitle={editingVersionedSkill
          ? "这里只维护技能广场资料；执行逻辑请在“版本与运行配置”中创建并发布新版本。"
          : editing
            ? "修改 Skill 内容会生成新的不可变版本；仅修改展示说明不会影响执行效果。"
            : "按引导填写内容即可创建 Skill；模型、入口和默认参数收纳在高级设置中。"}
        saveLabel={saving ? "保存中…" : editing ? "保存" : "创建 Skill"}
        onClose={closeEditor}
        onSave={save}
      >
        {!editing ? (
          <FormCard title="执行形态">
            <div className="adm-skill-kind-grid" role="radiogroup" aria-label="技能执行形态">
              {KIND_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = form.kind === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`adm-skill-kind-card${selected ? " selected" : ""}`}
                    onClick={() => setForm((current) => ({
                      ...current,
                      kind: option.key,
                      entryPoints: defaultAdminSkillEntryPoints(option.key),
                      outputType: option.key === "tool" ? "file" : current.outputType === "file" ? "image" : current.outputType,
                      category: option.key === "tool" ? "办公文档" : current.category,
                      modelId: "",
                    }))}
                  >
                    <span className="adm-skill-kind-icon"><Icon aria-hidden size={18} /></span>
                    <span>
                      <strong>
                        {option.title}
                      </strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </FormCard>
        ) : null}

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
            <Field label="一句话介绍" required={!editing} span={4} hint="用一句话告诉用户这个 Skill 能做什么">
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="简短描述该 Skill 的核心能力"
                maxLength={255}
              />
            </Field>
          </FormGrid>
        </FormCard>

        {!editingVersionedSkill ? (
          <FormCard title="Skill 内容 *">
            {contentAccess === "editable" ? (
              <OperatorSkillContentEditor
                value={form.promptTemplate}
                previewValue={form.promptTemplate}
                onChange={(promptTemplate) => setForm((current) => ({ ...current, promptTemplate }))}
                onImport={(promptTemplate) => setForm((current) => ({ ...current, promptTemplate }))}
              />
            ) : (
              <AdminAlert
                tone="info"
                title={contentAccess === "checking" ? "正在检查当前版本" : "高级文件包内容受保护"}
              >
                {contentAccess === "checking"
                  ? "正在确认这个 Skill 是否可以在简化编辑器中安全修改。"
                  : "当前版本包含多个文件、自定义主文件或文件引用。为避免丢失内容，请到“版本与运行配置”修改执行文件；这里仍可维护介绍、使用说明和封面。"}
              </AdminAlert>
            )}
          </FormCard>
        ) : null}

        <FormCard title="使用说明">
          <FormGrid>
            <Field label="使用场景" required={!editing} span={4}>
              <textarea
                rows={3}
                value={form.usageScenario}
                maxLength={2000}
                placeholder="详细描述适合使用这个 Skill 的创作场景"
                onChange={(event) => setForm((current) => ({ ...current, usageScenario: event.target.value }))}
              />
            </Field>
            <Field label="如何使用" required={!editing} span={4}>
              <textarea
                rows={3}
                value={form.usageGuide}
                maxLength={2000}
                placeholder="说明用户需要输入哪些信息，例如主题、风格、时长或参考素材"
                onChange={(event) => setForm((current) => ({ ...current, usageGuide: event.target.value }))}
              />
            </Field>
            <Field label="输出内容" required={!editing} span={4}>
              <textarea
                rows={3}
                value={form.outputDescription}
                maxLength={2000}
                placeholder="描述用户使用后会得到什么结果，以及结果应满足的标准"
                onChange={(event) => setForm((current) => ({ ...current, outputDescription: event.target.value }))}
              />
            </Field>
          </FormGrid>
        </FormCard>

        <FormCard title="输出与封面">
          <FormGrid>
            {!editingVersionedSkill ? (
              <Field label="选择类型" required span={2}>
                <select
                  value={form.outputType}
                  disabled={!!editing && contentAccess !== "editable"}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    outputType: event.target.value as SkillOutputType,
                    modelId: "",
                  }))}
                >
                  {(form.kind === "tool" ? OUTPUT_OPTIONS.filter((type) => type === "text" || type === "file") : OUTPUT_OPTIONS.filter((type) => type !== "file")).map((type) => (
                    <option key={type} value={type}>{SKILL_OUTPUT_LABEL[type]}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="封面图（选填）" span={4} hint="建议上传 16:9 横图，也可以粘贴图片 URL">
              {form.coverUrl.trim() ? (
                <div className={`adm-skill-cover-preview${coverPreviewFailed ? " is-error" : ""}`}>
                  {coverPreviewFailed ? (
                    <span>封面地址无法预览，请检查 URL 或重新上传。</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={form.coverUrl}
                      src={form.coverUrl}
                      alt="技能封面预览"
                      onError={() => setCoverPreviewFailed(true)}
                    />
                  )}
                  <button
                    type="button"
                    className="adm-btn ghost"
                    onClick={() => {
                      setCoverPreviewFailed(false);
                      setForm((current) => ({ ...current, coverUrl: "" }));
                    }}
                  >
                    移除封面
                  </button>
                </div>
              ) : null}
              <div className="adm-skill-cover-row">
                <input
                  value={form.coverUrl}
                  onChange={(event) => {
                    setCoverPreviewFailed(false);
                    setForm((current) => ({ ...current, coverUrl: event.target.value }));
                  }}
                  placeholder="https://…"
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
                <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={uploadCover} />
              </div>
            </Field>
          </FormGrid>
        </FormCard>

        {editingVersionedSkill ? (
          <FormCard title="运行配置受版本保护">
            <p className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
              {form.kind === "tool" ? "技能工具" : "智能技能"}的 Manifest、输入 Schema、模型与文件均属于不可变版本，
              不会在资料编辑中被覆盖。关闭此窗口后，请使用列表中的“版本与运行配置”。
            </p>
          </FormCard>
        ) : null}

        <details ref={advancedRef} className="adm-skill-advanced">
          <summary>
            <span>
              <b>高级设置</b>
              <small>入口、模型、默认参数与上架排序</small>
            </span>
          </summary>
          <div className="adm-skill-advanced-body">
            <FormGrid>
              {!editing ? (
                <Field
                  label="可用入口"
                  required
                  span={4}
                  group
                  hint={form.kind === "agent"
                    ? "智能技能只在画布中运行，通过对话跨多种节点生成内容"
                    : form.kind === "tool"
                      ? "技能工具只在创作台或 API 中运行"
                      : "预设技能可用于创作台、生成页和画布，每次只输出一种内容"}
                >
                  <div className="adm-skill-entry-list">
                    {ADMIN_SKILL_ENTRY_POINTS.map((entry) => (
                      <label key={entry.key}>
                        <input
                          type="checkbox"
                          checked={form.entryPoints.includes(entry.key)}
                          disabled={form.kind === "agent" || (form.kind === "preset" && entry.key === "api") || (form.kind === "tool" && entry.key !== "studio" && entry.key !== "api")}
                          onChange={() => toggleEntryPoint(entry.key)}
                        />
                        {entry.label}
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}
              {!editingVersionedSkill ? (
                <>
                  <Field label="关联模型" span={2} hint="留空时跟随用户当前选择或系统默认模型">
                    <select
                      value={form.modelId}
                      disabled={!!editing && contentAccess !== "editable"}
                      onChange={(event) => setForm((current) => ({ ...current, modelId: event.target.value }))}
                    >
                      <option value="">自动选择</option>
                      {formModels.map((model) => (
                        <option key={model.modelId} value={model.modelId}>{model.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="默认生成参数"
                    span={4}
                    hint={'仅供熟悉配置的人员使用，例如 {"aspectRatio":"16:9","duration":5}'}
                  >
                    <input
                      ref={defaultParamsInputRef}
                      value={form.defaultParams}
                      disabled={!!editing && contentAccess !== "editable"}
                      onChange={(event) => setForm((current) => ({ ...current, defaultParams: event.target.value }))}
                      placeholder="{}"
                      style={{ fontFamily: "var(--mono)" }}
                    />
                  </Field>
                </>
              ) : null}
              <Field label="作者署名" span={2}>
                <input
                  value={form.authorName}
                  maxLength={64}
                  onChange={(event) => setForm((current) => ({ ...current, authorName: event.target.value }))}
                />
              </Field>
              <Field label="排序" span={2} hint="小值在前">
                <input
                  value={form.sortOrder}
                  inputMode="numeric"
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    sortOrder: event.target.value.replace(/[^0-9-]/g, ""),
                  }))}
                />
              </Field>
              <Field label="状态" span={2}>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: Number(event.target.value) }))}
                >
                  <option value={1}>上架</option>
                  <option value={0}>下架</option>
                </select>
              </Field>
            </FormGrid>
          </div>
        </details>
      </AdminModal>

      <SkillVersionModal
        key={versioning ? `version-${versioning.id}` : "version-closed"}
        open={!!versioning}
        skill={versioning}
        onClose={() => setVersioning(null)}
        onChanged={async () => {
          await load();
        }}
      />

      <SkillImportModal
        key={importOpen ? "import-open" : "import-closed"}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />
    </div>
  );
}
