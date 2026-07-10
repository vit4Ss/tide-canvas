"use client";

/* ============================================================================
   /admin/inspiration — 灵感管理 (REAL data).

   Wired to the admin inspiration API (collections + prompt library). Keeps the
   liuguang admin markup/classes + shared components:
     - 4 KPI tiles (合集总数 / 已展示 / 提示词库 / 累计采用)
     - 灵感配置 panel: filter chips (全部 / 合集 / 主题 / 提示词) + 新增合集, table
       (封面 / 标题 / 类型 / 关联作品 / 排序 / 展示[开关] / 操作[编辑·删除])
     - 提示词库 panel: 新增提示词, table
       (提示词 / 标签 / 采用次数 / 操作[编辑·删除])
     - inspModal: 新增/编辑合集 (合集信息 + 展示开关), promptModal: 新增/编辑提示词

   CRUD against the real endpoints, refreshing the lists after each change. The
   展示 switch on a collection writes its `visible` flag inline.
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  FormSection,
  Panel,
  RowActions,
  StatusPill,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { FilterChips } from "@/components/admin/filter-bar";
import { mesh } from "@/lib/mesh";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { adminInspirationApi } from "@/lib/admin-inspiration-api";
import type {
  CollectionUpsertDTO,
  CollectionVO,
  PromptUpsertDTO,
  PromptVO,
} from "@/types/admin-inspiration";

const COLLECTION_FILTERS = ["全部", "合集", "主题", "提示词"] as const;
type CollectionFilter = (typeof COLLECTION_FILTERS)[number];

const COLLECTION_TYPE_OPTIONS = ["合集", "主题", "提示词"] as const;

const PAGE_SIZE = 10;

/** Deterministic mesh cover from an id (fallback when coverUrl is empty). */
function meshCover(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

function coverBg(coverUrl: string, id: string): string {
  return coverUrl ? `center / cover no-repeat url("${coverUrl}")` : meshCover(id);
}

/** Split a comma/space separated tag string into chips. */
function splitTags(tags: string): string[] {
  return tags
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

type CollDraft = {
  id: string | null;
  title: string;
  type: string;
  coverUrl: string;
  linkedWorks: string;
  sortOrder: string;
  tags: string;
  description: string;
  visible: boolean;
};

type PromptDraft = {
  id: string | null;
  text: string;
  tags: string;
  adoptions: string;
  coverUrl: string;
};

export default function AdminInspirationPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [collections, setCollections] = useState<CollectionVO[]>([]);
  const [collTotal, setCollTotal] = useState(0);
  const [collPage, setCollPage] = useState(1);
  const [collLoading, setCollLoading] = useState(true);
  const [collError, setCollError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptVO[]>([]);
  const [promptTotal, setPromptTotal] = useState(0);
  const [promptPage, setPromptPage] = useState(1);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [collFilter, setCollFilter] = useState<CollectionFilter>(COLLECTION_FILTERS[0]);
  const [collDraft, setCollDraft] = useState<CollDraft | null>(null);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [collFormError, setCollFormError] = useState<string | null>(null);
  const [promptFormError, setPromptFormError] = useState<string | null>(null);

  // reqId 守卫:切筛选会触发「旧页码」+「重置页码」两次请求,只让最新一次生效,
  // 避免先发的旧请求后到、把过期数据渲染上去。
  const collReqRef = useRef(0);
  const loadCollections = useCallback(async () => {
    const id = ++collReqRef.current;
    setCollLoading(true);
    setCollError(null);
    try {
      await ensureSession(); // 登录流程暂未做:无 token 时静默登录默认账号
      const type = collFilter === "全部" ? undefined : collFilter;
      const res = await adminInspirationApi.listCollections({
        pageNum: collPage,
        pageSize: PAGE_SIZE,
        type,
      });
      if (id !== collReqRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setCollections(res.data.records);
        setCollTotal(res.data.total);
      } else {
        setCollections([]);
        setCollTotal(0);
        setCollError(res.message || "加载合集失败");
      }
    } catch {
      if (id !== collReqRef.current) return;
      setCollections([]);
      setCollTotal(0);
      setCollError("加载合集失败，请稍后重试");
    } finally {
      if (id === collReqRef.current) setCollLoading(false);
    }
  }, [ensureSession, collFilter, collPage]);

  const promptReqRef = useRef(0);
  const loadPrompts = useCallback(async () => {
    const id = ++promptReqRef.current;
    setPromptLoading(true);
    setPromptError(null);
    try {
      await ensureSession();
      const res = await adminInspirationApi.listPrompts({
        pageNum: promptPage,
        pageSize: PAGE_SIZE,
      });
      if (id !== promptReqRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setPrompts(res.data.records);
        setPromptTotal(res.data.total);
      } else {
        setPrompts([]);
        setPromptTotal(0);
        setPromptError(res.message || "加载提示词失败");
      }
    } catch {
      if (id !== promptReqRef.current) return;
      setPrompts([]);
      setPromptTotal(0);
      setPromptError("加载提示词失败，请稍后重试");
    } finally {
      if (id === promptReqRef.current) setPromptLoading(false);
    }
  }, [ensureSession, promptPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCollections(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCollections]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPrompts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPrompts]);

  /* --- collection CRUD --- */

  const openNewColl = () => {
    setCollFormError(null);
    setCollDraft({
      id: null,
      title: "",
      type: "合集",
      coverUrl: "",
      linkedWorks: "0",
      sortOrder: "0",
      tags: "",
      description: "",
      visible: true,
    });
  };

  const openEditColl = (c: CollectionVO) => {
    setCollFormError(null);
    setCollDraft({
      id: c.id,
      title: c.title,
      type: c.type || "合集",
      coverUrl: c.coverUrl,
      linkedWorks: String(c.linkedWorks),
      sortOrder: String(c.sortOrder),
      tags: c.tags,
      description: c.description,
      visible: c.visible,
    });
  };

  const saveColl = useCallback(async () => {
    if (!collDraft) return;
    setCollFormError(null);
    const title = collDraft.title.trim();
    if (!title) {
      setCollFormError("请填写标题");
      return false;
    }
    const body: CollectionUpsertDTO = {
      title,
      type: collDraft.type,
      coverUrl: collDraft.coverUrl.trim(),
      linkedWorks: Number(collDraft.linkedWorks) || 0,
      sortOrder: Number(collDraft.sortOrder) || 0,
      tags: collDraft.tags,
      description: collDraft.description,
      visible: collDraft.visible,
    };
    setBusy(true);
    try {
      const res = collDraft.id
        ? await adminInspirationApi.updateCollection(collDraft.id, body)
        : await adminInspirationApi.createCollection(body);
      if (res.success) {
        setCollDraft(null);
        toast.success("合集已保存");
        await loadCollections();
      } else {
        const message = res.message || "保存失败";
        setCollFormError(message);
        toast.error(message);
        return false;
      }
    } catch {
      const message = "保存失败，请稍后重试";
      setCollFormError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [collDraft, loadCollections]);

  const toggleVisible = useCallback(
    async (c: CollectionVO, next: boolean) => {
      setBusy(true);
      try {
        const res = await adminInspirationApi.updateCollection(c.id, {
          title: c.title,
          type: c.type,
          coverUrl: c.coverUrl,
          visible: next,
        });
        if (res.success) await loadCollections();
        else toast.error(res.message || "更新展示状态失败");
      } catch {
        toast.error("更新展示状态失败，请稍后重试");
      } finally {
        setBusy(false);
      }
    },
    [loadCollections],
  );

  const deleteColl = useCallback(
    async (c: CollectionVO) => {
      if (
        !(await confirmDialog({
          title: "删除合集",
          message: `确认删除合集「${c.title}」？`,
          confirmText: "删除",
        }))
      )
        return;
      setBusy(true);
      try {
        const res = await adminInspirationApi.deleteCollection(c.id);
        if (res.success) {
          toast.success("合集已删除");
          await loadCollections();
        } else {
          toast.error(res.message || "删除失败");
        }
      } catch {
        toast.error("删除失败，请稍后重试");
      } finally {
        setBusy(false);
      }
    },
    [loadCollections],
  );

  /* --- prompt CRUD --- */

  const openNewPrompt = () => {
    setPromptFormError(null);
    setPromptDraft({ id: null, text: "", tags: "", adoptions: "0", coverUrl: "" });
  };

  const openEditPrompt = (p: PromptVO) => {
    setPromptFormError(null);
    setPromptDraft({
      id: p.id,
      text: p.text,
      tags: p.tags,
      adoptions: String(p.adoptions),
      coverUrl: p.coverUrl,
    });
  };

  const savePrompt = useCallback(async () => {
    if (!promptDraft) return;
    setPromptFormError(null);
    const text = promptDraft.text.trim();
    if (!text) {
      setPromptFormError("请填写提示词");
      return false;
    }
    const body: PromptUpsertDTO = {
      text,
      tags: promptDraft.tags,
      adoptions: Number(promptDraft.adoptions) || 0,
      coverUrl: promptDraft.coverUrl.trim(),
    };
    setBusy(true);
    try {
      const res = promptDraft.id
        ? await adminInspirationApi.updatePrompt(promptDraft.id, body)
        : await adminInspirationApi.createPrompt(body);
      if (res.success) {
        setPromptDraft(null);
        toast.success("提示词已保存");
        await loadPrompts();
      } else {
        const message = res.message || "保存失败";
        setPromptFormError(message);
        toast.error(message);
        return false;
      }
    } catch {
      const message = "保存失败，请稍后重试";
      setPromptFormError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [promptDraft, loadPrompts]);

  const deletePrompt = useCallback(
    async (p: PromptVO) => {
      if (
        !(await confirmDialog({
          title: "删除提示词",
          message: "确认删除该提示词？",
          confirmText: "删除",
        }))
      )
        return;
      setBusy(true);
      try {
        const res = await adminInspirationApi.deletePrompt(p.id);
        if (res.success) {
          toast.success("提示词已删除");
          await loadPrompts();
        } else {
          toast.error(res.message || "删除失败");
        }
      } catch {
        toast.error("删除失败，请稍后重试");
      } finally {
        setBusy(false);
      }
    },
    [loadPrompts],
  );

  const dim = busy ? { opacity: 0.6, pointerEvents: "none" as const } : undefined;

  return (
    <div className="adm-page">
      {/* 灵感配置 */}
      <Panel
        title="灵感配置"
        sub={`共 ${collTotal.toLocaleString()} 个内容组 · 本页 ${collections.filter((c) => c.visible).length} 个正在展示`}
        tools={
          <>
            <FilterChips
              label="灵感内容类型"
              options={[...COLLECTION_FILTERS]}
              value={collFilter}
              onChange={(v) => {
                setCollFilter(v as CollectionFilter);
                setCollPage(1);
              }}
            />
            <button type="button" className="adm-btn" onClick={openNewColl}>
              <Plus aria-hidden size={15} />
              新增合集
            </button>
          </>
        }
      >
        {collLoading ? (
          <TableSkeleton />
        ) : collError ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="灵感内容加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={loadCollections}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {collError}
            </AdminAlert>
          </div>
        ) : collections.length === 0 ? (
          <AdminEmptyState
            title="当前类型下没有灵感内容"
            description="可以新建内容组，或切换到“全部”查看其他类型。"
            action={
              <button type="button" className="adm-btn" onClick={openNewColl}>
                <Plus aria-hidden size={15} />
                新增合集
              </button>
            }
          />
        ) : (
          <div style={dim} aria-busy={busy}>
            <AdminTable<CollectionVO>
              rows={collections}
              rowKey={(r) => r.id}
              label="灵感合集列表"
              server={{ page: collPage, pageSize: PAGE_SIZE, total: collTotal, onPage: setCollPage }}
              columns={[
                {
                  header: "封面",
                  cell: (r) => (
                    <div className="cellflex">
                      <span className="sw" style={{ background: coverBg(r.coverUrl, r.id) }} />
                    </div>
                  ),
                },
                {
                  header: "标题",
                  className: "strong",
                  sortable: true,
                  sortValue: (r) => r.title,
                  cell: (r) => r.title,
                },
                { header: "类型", cell: (r) => <StatusPill tone="blue">{r.type}</StatusPill> },
                {
                  header: "关联作品",
                  className: "mono",
                  sortable: true,
                  sortValue: (r) => r.linkedWorks,
                  cell: (r) => r.linkedWorks.toLocaleString(),
                },
                {
                  header: "排序",
                  className: "mono",
                  sortable: true,
                  sortValue: (r) => r.sortOrder,
                  cell: (r) => r.sortOrder,
                },
                {
                  header: "展示",
                  cell: (r) => (
                    <SwitchToggle
                      checked={r.visible}
                      onChange={(next) => toggleVisible(r, next)}
                      aria-label={`${r.title} 展示`}
                    />
                  ),
                },
                {
                  header: "操作",
                  align: "right",
                  cell: (r) => (
                    <RowActions
                      actions={[
                        { label: "编辑", onClick: () => openEditColl(r) },
                        { label: "删除", onClick: () => deleteColl(r) },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </Panel>

      {/* 提示词库 */}
      <Panel
        title="提示词库"
        sub={`共 ${promptTotal.toLocaleString()} 条 · 本页累计采用 ${prompts.reduce((sum, p) => sum + p.adoptions, 0).toLocaleString()} 次`}
        tools={
          <button type="button" className="adm-btn" onClick={openNewPrompt}>
            <Plus aria-hidden size={15} />
            新增提示词
          </button>
        }
      >
        {promptLoading ? (
          <TableSkeleton />
        ) : promptError ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="提示词库加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={loadPrompts}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {promptError}
            </AdminAlert>
          </div>
        ) : prompts.length === 0 ? (
          <AdminEmptyState
            title="提示词库还是空的"
            description="添加经过验证的提示词，帮助创作者更快开始创作。"
            action={
              <button type="button" className="adm-btn" onClick={openNewPrompt}>
                <Plus aria-hidden size={15} />
                新增提示词
              </button>
            }
          />
        ) : (
          <div style={dim} aria-busy={busy}>
            <AdminTable<PromptVO>
              rows={prompts}
              rowKey={(r) => r.id}
              label="提示词列表"
              server={{ page: promptPage, pageSize: PAGE_SIZE, total: promptTotal, onPage: setPromptPage }}
              columns={[
                { header: "提示词", className: "strong", cell: (r) => r.text },
                {
                  header: "标签",
                  cell: (r) => (
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      {splitTags(r.tags).length > 0 ? (
                        splitTags(r.tags).map((t) => (
                          <StatusPill key={t} tone="gray">
                            {t}
                          </StatusPill>
                        ))
                      ) : (
                        <span className="muted">未标记</span>
                      )}
                    </span>
                  ),
                },
                {
                  header: "采用次数",
                  className: "mono",
                  sortable: true,
                  sortValue: (r) => r.adoptions,
                  cell: (r) => r.adoptions.toLocaleString(),
                },
                {
                  header: "操作",
                  align: "right",
                  cell: (r) => (
                    <RowActions
                      actions={[
                        { label: "编辑", onClick: () => openEditPrompt(r) },
                        { label: "删除", onClick: () => deletePrompt(r) },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </Panel>

      {/* inspModal — 新增/编辑合集 */}
      <AdminModal
        open={collDraft != null}
        size="lg"
        title={collDraft?.id ? `编辑 · ${collDraft.title || "合集"}` : "新增合集"}
        subtitle={collDraft?.id ? "编辑灵感合集内容与展示" : "新增一个灵感合集"}
        footNote={collFormError ? <span role="alert">{collFormError}</span> : "变更将在保存后生效"}
        onClose={() => {
          setCollFormError(null);
          setCollDraft(null);
        }}
        onSave={saveColl}
        saveLabel={busy ? "保存中…" : "保存"}
      >
        {collDraft ? (
          <>
            <FormCard title="合集信息">
              <FormGrid>
                <Field label="标题" required span={2} error={collFormError === "请填写标题" ? collFormError : undefined}>
                  <input
                    placeholder="如：国风 Q 版"
                    value={collDraft.title}
                    onChange={(e) => {
                      setCollFormError(null);
                      setCollDraft({ ...collDraft, title: e.target.value });
                    }}
                  />
                </Field>
                <Field label="类型" span={2}>
                  <select
                    value={collDraft.type}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, type: e.target.value })
                    }
                  >
                    {COLLECTION_TYPE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="关联作品">
                  <input
                    type="number"
                    value={collDraft.linkedWorks}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, linkedWorks: e.target.value })
                    }
                  />
                </Field>
                <Field label="排序">
                  <input
                    type="number"
                    value={collDraft.sortOrder}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, sortOrder: e.target.value })
                    }
                  />
                </Field>
                <Field label="封面图" span={2}>
                  <input
                    placeholder="图片 URL，留空使用自动 mesh 封面"
                    value={collDraft.coverUrl}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, coverUrl: e.target.value })
                    }
                  />
                </Field>
                <Field label="标签" span={2}>
                  <input
                    placeholder="逗号分隔，如：国风, Q 版"
                    value={collDraft.tags}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, tags: e.target.value })
                    }
                  />
                </Field>
                <Field label="描述" span={4}>
                  <textarea
                    placeholder="选填，展示在合集卡片下方"
                    value={collDraft.description}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, description: e.target.value })
                    }
                  />
                </Field>
              </FormGrid>
            </FormCard>

            <FormCard title="选项">
              <FormSection label="展示">
                <div className="cfg-card flat">
                  <div className="cfg-row">
                    <span className="lab">在灵感页展示</span>
                    <SwitchToggle
                      checked={collDraft.visible}
                      onChange={(next) => setCollDraft({ ...collDraft, visible: next })}
                      aria-label="在灵感页展示"
                    />
                  </div>
                </div>
              </FormSection>
            </FormCard>
          </>
        ) : null}
      </AdminModal>

      {/* promptModal — 新增/编辑提示词 */}
      <AdminModal
        open={promptDraft != null}
        size="md"
        title={promptDraft?.id ? "编辑提示词" : "新增提示词"}
        subtitle="提示词文本、标签与采用次数"
        footNote={promptFormError ? <span role="alert">{promptFormError}</span> : "变更将在保存后生效"}
        onClose={() => {
          setPromptFormError(null);
          setPromptDraft(null);
        }}
        onSave={savePrompt}
        saveLabel={busy ? "保存中…" : "保存"}
      >
        {promptDraft ? (
          <FormCard title="提示词信息">
            <FormGrid>
              <Field
                label="提示词"
                required
                span={4}
                error={promptFormError === "请填写提示词" ? promptFormError : undefined}
              >
                <textarea
                  placeholder="如：赛博朋克城市夜景，霓虹反光"
                  value={promptDraft.text}
                  onChange={(e) => {
                    setPromptFormError(null);
                    setPromptDraft({ ...promptDraft, text: e.target.value });
                  }}
                />
              </Field>
              <Field label="标签" span={2}>
                <input
                  placeholder="逗号分隔，如：风格, 场景"
                  value={promptDraft.tags}
                  onChange={(e) =>
                    setPromptDraft({ ...promptDraft, tags: e.target.value })
                  }
                />
              </Field>
              <Field label="采用次数" span={2}>
                <input
                  type="number"
                  value={promptDraft.adoptions}
                  onChange={(e) =>
                    setPromptDraft({ ...promptDraft, adoptions: e.target.value })
                  }
                />
              </Field>
              <Field label="封面图" span={4}>
                <input
                  placeholder="选填，图片 URL"
                  value={promptDraft.coverUrl}
                  onChange={(e) =>
                    setPromptDraft({ ...promptDraft, coverUrl: e.target.value })
                  }
                />
              </Field>
            </FormGrid>
          </FormCard>
        ) : null}
      </AdminModal>
    </div>
  );
}
