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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  FormSection,
  Panel,
  RowActions,
  StatCardGrid,
  StatusPill,
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { FilterChips } from "@/components/admin/filter-bar";
import type { Kpi } from "@/mock/admin";
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
  const [prompts, setPrompts] = useState<PromptVO[]>([]);
  const [promptTotal, setPromptTotal] = useState(0);
  const [promptPage, setPromptPage] = useState(1);
  const [promptLoading, setPromptLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [collFilter, setCollFilter] = useState<CollectionFilter>(COLLECTION_FILTERS[0]);
  const [collDraft, setCollDraft] = useState<CollDraft | null>(null);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);

  // reqId 守卫:切筛选会触发「旧页码」+「重置页码」两次请求,只让最新一次生效,
  // 避免先发的旧请求后到、把过期数据渲染上去。
  const collReqRef = useRef(0);
  const loadCollections = useCallback(async () => {
    const id = ++collReqRef.current;
    setCollLoading(true);
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
      }
    } finally {
      if (id === collReqRef.current) setCollLoading(false);
    }
  }, [ensureSession, collFilter, collPage]);

  const promptReqRef = useRef(0);
  const loadPrompts = useCallback(async () => {
    const id = ++promptReqRef.current;
    setPromptLoading(true);
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
      }
    } finally {
      if (id === promptReqRef.current) setPromptLoading(false);
    }
  }, [ensureSession, promptPage]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const kpis: Kpi[] = useMemo(() => {
    const visible = collections.filter((c) => c.visible).length;
    const adoptions = prompts.reduce((sum, p) => sum + p.adoptions, 0);
    return [
      { k: "合集总数", v: collTotal.toLocaleString(), d: "Collection", dir: "up" },
      { k: "已展示", v: visible.toLocaleString(), d: "本页", dir: "up" },
      { k: "提示词库", v: promptTotal.toLocaleString(), d: "PromptLib", dir: "up" },
      { k: "累计采用", v: adoptions.toLocaleString(), d: "本页", dir: "up" },
    ];
  }, [collections, prompts, collTotal, promptTotal]);

  /* --- collection CRUD --- */

  const openNewColl = () =>
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

  const openEditColl = (c: CollectionVO) =>
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

  const saveColl = useCallback(async () => {
    if (!collDraft) return;
    const title = collDraft.title.trim();
    if (!title) {
      toast.error("请填写标题");
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
        toast.error(res.message || "保存失败");
        return false;
      }
    } catch {
      toast.error("保存失败，请稍后重试");
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
      } finally {
        setBusy(false);
      }
    },
    [loadCollections],
  );

  /* --- prompt CRUD --- */

  const openNewPrompt = () =>
    setPromptDraft({ id: null, text: "", tags: "", adoptions: "0", coverUrl: "" });

  const openEditPrompt = (p: PromptVO) =>
    setPromptDraft({
      id: p.id,
      text: p.text,
      tags: p.tags,
      adoptions: String(p.adoptions),
      coverUrl: p.coverUrl,
    });

  const savePrompt = useCallback(async () => {
    if (!promptDraft) return;
    const text = promptDraft.text.trim();
    if (!text) {
      toast.error("请填写提示词");
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
        toast.error(res.message || "保存失败");
        return false;
      }
    } catch {
      toast.error("保存失败，请稍后重试");
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
      } finally {
        setBusy(false);
      }
    },
    [loadPrompts],
  );

  const dim = busy ? { opacity: 0.6, pointerEvents: "none" as const } : undefined;

  return (
    <>
      <StatCardGrid items={kpis} />

      {/* 灵感配置 */}
      <Panel
        title="灵感配置"
        sub="管理灵感页的合集、主题与展示"
        tools={
          <>
            <FilterChips
              options={[...COLLECTION_FILTERS]}
              value={collFilter}
              onChange={(v) => {
                setCollFilter(v as CollectionFilter);
                setCollPage(1);
              }}
            />
            <button type="button" className="adm-btn" onClick={openNewColl}>
              + 新增合集
            </button>
          </>
        }
      >
        {collLoading ? (
          <TableSkeleton />
        ) : collections.length === 0 ? (
          <div style={{ padding: 28, color: "var(--text-faint)" }}>暂无合集。</div>
        ) : (
          <div style={dim}>
            <AdminTable<CollectionVO>
              rows={collections}
              rowKey={(r) => r.id}
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
        sub="高频提示词与采用情况"
        tools={
          <button type="button" className="adm-btn" onClick={openNewPrompt}>
            + 新增提示词
          </button>
        }
      >
        {promptLoading ? (
          <TableSkeleton />
        ) : prompts.length === 0 ? (
          <div style={{ padding: 28, color: "var(--text-faint)" }}>暂无提示词。</div>
        ) : (
          <div style={dim}>
            <AdminTable<PromptVO>
              rows={prompts}
              rowKey={(r) => r.id}
              server={{ page: promptPage, pageSize: PAGE_SIZE, total: promptTotal, onPage: setPromptPage }}
              columns={[
                { header: "提示词", className: "strong", cell: (r) => r.text },
                {
                  header: "标签",
                  cell: (r) => (
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      {splitTags(r.tags).map((t) => (
                        <StatusPill key={t} tone="gray">
                          {t}
                        </StatusPill>
                      ))}
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
        title={collDraft?.id ? `编辑 · ${collDraft.title || "合集"}` : "新增合集"}
        subtitle={collDraft?.id ? "编辑灵感合集内容与展示" : "新增一个灵感合集"}
        onClose={() => setCollDraft(null)}
        onSave={saveColl}
        saveLabel={busy ? "保存中…" : "保存"}
      >
        {collDraft ? (
          <>
            <FormCard title="合集信息" style={{ marginTop: 0 }}>
              <FormGrid>
                <Field label="标题" required span={2}>
                  <input
                    placeholder="如：国风 Q 版"
                    value={collDraft.title}
                    onChange={(e) =>
                      setCollDraft({ ...collDraft, title: e.target.value })
                    }
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
                  <input
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
                <div className="cfg-card" style={{ boxShadow: "none", padding: "4px 16px" }}>
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
        title={promptDraft?.id ? "编辑提示词" : "新增提示词"}
        subtitle="提示词文本、标签与采用次数"
        onClose={() => setPromptDraft(null)}
        onSave={savePrompt}
        saveLabel={busy ? "保存中…" : "保存"}
      >
        {promptDraft ? (
          <FormCard title="提示词信息" style={{ marginTop: 0 }}>
            <FormGrid>
              <Field label="提示词" required span={4}>
                <input
                  placeholder="如：赛博朋克城市夜景，霓虹反光"
                  value={promptDraft.text}
                  onChange={(e) =>
                    setPromptDraft({ ...promptDraft, text: e.target.value })
                  }
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
    </>
  );
}
