"use client";

/* 风格管理 — 维护画布图片节点「风格广场」的风格预设（增删改查、上下架、官方标记）。
   数据与用户端 /api/styles 同源（style_preset 表），此页写入即时反映到画布选择器。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  Field,
  FormCard,
  FormGrid,
  Panel,
  RowActions,
  StatusPill,
  TableSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminStyleApi } from "@/lib/admin-style-api";
import type { StylePresetVO, StylePresetSaveDTO } from "@/types/style";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

// 与画布选择器(image-style-picker CATEGORY_OPTIONS)保持同一套分类页签；
// 「推荐」在用户端是聚合页签(展示全部)，此处仍可作为分类值保存。
const CATEGORY_OPTIONS = [
  "推荐",
  "Midjourney",
  "摄影写真",
  "电商营销",
  "动漫游戏",
  "风格插画",
  "平面设计",
  "建筑及室内设计",
  "创意玩法",
  "文创周边",
  "小说推文",
];

interface StyleForm {
  name: string;
  shortName: string;
  description: string;
  prompt: string;
  coverUrl: string;
  category: string;
  authorName: string;
  commercial: number;
  publicFlag: number;
  official: number;
  status: number;
  sortOrder: number;
}

const emptyForm = (): StyleForm => ({
  name: "",
  shortName: "",
  description: "",
  prompt: "",
  coverUrl: "",
  category: "推荐",
  authorName: "官方",
  commercial: 0,
  publicFlag: 1,
  official: 1,
  status: 1,
  sortOrder: 0,
});

function toForm(row: StylePresetVO): StyleForm {
  return {
    name: row.name,
    shortName: row.shortName,
    description: row.description,
    prompt: row.prompt,
    coverUrl: row.coverUrl,
    category: row.category || "推荐",
    authorName: row.authorName,
    commercial: row.commercial,
    publicFlag: row.publicFlag,
    official: row.official,
    status: row.status,
    sortOrder: row.sortOrder,
  };
}

export default function AdminStylesPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  const [rows, setRows] = useState<StylePresetVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const keywordRef = useRef("");
  const [category, setCategory] = useState("");
  const categoryRef = useRef("");
  const [status, setStatus] = useState("");
  const statusRef = useRef("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StylePresetVO | null>(null);
  const [form, setForm] = useState<StyleForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const loadReqRef = useRef(0);

  const load = useCallback(
    async (page = 1, opts?: { silent?: boolean }) => {
      const id = ++loadReqRef.current;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const res = await adminStyleApi.list({
          pageNum: page,
          pageSize,
          keyword: keywordRef.current || undefined,
          category: categoryRef.current || undefined,
          status: statusRef.current || undefined,
        });
        if (id !== loadReqRef.current) return;
        if (res.success && res.data) {
          setRows(res.data.records ?? []);
          setTotal(res.data.total ?? 0);
          setPageNum(page);
        } else {
          setError(res.message || "加载风格列表失败");
        }
      } catch {
        if (id !== loadReqRef.current) return;
        setError("加载失败，请稍后重试");
      } finally {
        if (id === loadReqRef.current && !opts?.silent) setLoading(false);
      }
    },
    [ensureSession, pageSize],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load(1));
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (row: StylePresetVO) => {
    setEditing(row);
    setForm(toForm(row));
    setModalOpen(true);
  };

  const save = async () => {
    const dto: StylePresetSaveDTO = {
      name: form.name.trim(),
      shortName: form.shortName.trim() || form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      coverUrl: form.coverUrl.trim(),
      category: form.category,
      authorName: form.authorName.trim(),
      modelType: editing?.modelType || "image",
      // 模型级提示词等结构化字段此页不编辑,原样带回避免更新时被清空
      modelIds: editing?.modelIds ?? [],
      modelPrompts: editing?.modelPrompts ?? {},
      tags: editing?.tags ?? [],
      commercial: form.commercial,
      publicFlag: form.publicFlag,
      official: form.official,
      status: form.status,
      sortOrder: form.sortOrder,
    };
    if (!dto.name) {
      toast.error("请填写风格名称");
      return false;
    }
    if (!dto.prompt) {
      toast.error("请填写风格提示词");
      return false;
    }
    setSaving(true);
    try {
      const res = editing
        ? await adminStyleApi.update(editing.id, dto)
        : await adminStyleApi.create(dto);
      if (res.success) {
        toast.success(editing ? "风格已更新" : "风格已创建");
        setModalOpen(false);
        load(editing ? pageNum : 1, { silent: true });
        return true;
      }
      toast.error(res.message || "保存失败");
      return false;
    } catch {
      toast.error("保存失败，请稍后重试");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: StylePresetVO) => {
    if (
      !(await confirmDialog({
        title: "删除风格",
        message: `确认删除风格「${row.name}」？画布风格广场将同步移除，用户的收藏与最近使用记录一并清理。`,
        confirmText: "删除",
      }))
    )
      return;
    try {
      const res = await adminStyleApi.remove(row.id);
      if (res.success) {
        toast.success("风格已删除");
        load(pageNum, { silent: true });
      } else toast.error(res.message || "删除失败");
    } catch {
      toast.error("删除失败，请稍后重试");
    }
  };

  const resetFilters = () => {
    keywordRef.current = "";
    categoryRef.current = "";
    statusRef.current = "";
    setQuery("");
    setKeyword("");
    setCategory("");
    setStatus("");
    load(1);
  };

  const hasFilter = Boolean(keyword || category || status);

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="风格列表加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={() => load(pageNum)}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      <Panel
        title="风格预设"
        sub="画布风格广场 · 与图片节点风格选择器同源，改动即时生效"
        tools={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const kw = query.trim();
                keywordRef.current = kw;
                setKeyword(kw);
                load(1);
              }}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div className="adm-search" style={{ margin: 0 }}>
                <Search aria-hidden size={15} />
                <input
                  placeholder="名称 / 描述 / 作者"
                  aria-label="搜索风格"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="按分类筛选"
                value={category}
                onChange={(e) => {
                  categoryRef.current = e.target.value;
                  setCategory(e.target.value);
                  load(1);
                }}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(15,23,42,.12)",
                  background: "#fff",
                  fontSize: 13,
                  color: "inherit",
                }}
              >
                <option value="">全部分类</option>
                {CATEGORY_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <select
                aria-label="按状态筛选"
                value={status}
                onChange={(e) => {
                  statusRef.current = e.target.value;
                  setStatus(e.target.value);
                  load(1);
                }}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(15,23,42,.12)",
                  background: "#fff",
                  fontSize: 13,
                  color: "inherit",
                }}
              >
                <option value="">全部状态</option>
                <option value="1">已上架</option>
                <option value="0">已下架</option>
              </select>
              <button type="submit" className="adm-btn ghost">
                搜索
              </button>
              {hasFilter ? (
                <button type="button" className="adm-btn ghost" onClick={resetFilters}>
                  <X aria-hidden size={14} />
                  清除
                </button>
              ) : null}
            </form>
            <button type="button" className="adm-btn" onClick={openCreate}>
              <Plus aria-hidden size={15} />
              新建风格
            </button>
          </div>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title={hasFilter ? "未找到匹配风格" : "暂无风格预设"}
            description={
              hasFilter
                ? "没有符合当前筛选条件的风格。"
                : "新建风格后会立即出现在画布图片节点的风格广场中。"
            }
            action={
              hasFilter ? (
                <button type="button" className="adm-btn ghost" onClick={resetFilters}>
                  <X aria-hidden size={14} />
                  清除筛选
                </button>
              ) : (
                <button type="button" className="adm-btn" onClick={openCreate}>
                  <Plus aria-hidden size={15} />
                  新建风格
                </button>
              )
            }
          />
        ) : (
          <AdminTable<StylePresetVO>
            label="风格预设列表"
            rows={rows}
            rowKey={(r) => r.id}
            server={{ page: pageNum, pageSize, total, onPage: (p) => load(p) }}
            columns={[
              {
                header: "风格",
                className: "strong",
                cell: (r) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {r.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.coverUrl}
                        alt=""
                        width={36}
                        height={45}
                        style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        style={{ width: 36, height: 45, borderRadius: 6, background: "var(--adm-line, #eee)", flexShrink: 0 }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div>
                        {r.name}
                        {r.shortName && r.shortName !== r.name ? (
                          <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                            {r.shortName}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="muted"
                        style={{
                          fontWeight: 400,
                          fontSize: 12,
                          marginTop: 2,
                          maxWidth: 320,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={r.prompt}
                      >
                        {r.description || r.prompt || "—"}
                      </div>
                    </div>
                  </div>
                ),
              },
              { header: "分类", className: "muted", cell: (r) => r.category || "—" },
              {
                header: "属性",
                cell: (r) => (
                  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                    <StatusPill tone={r.official ? "blue" : "gray"}>{r.official ? "官方" : "用户"}</StatusPill>
                    {r.commercial ? <StatusPill tone="green">可商用</StatusPill> : null}
                    {!r.publicFlag ? <StatusPill tone="gray">未公开</StatusPill> : null}
                  </span>
                ),
              },
              {
                header: "状态",
                cell: (r) => (
                  <StatusPill tone={r.status === 1 ? "green" : "gray"}>
                    {r.status === 1 ? "已上架" : "已下架"}
                  </StatusPill>
                ),
              },
              { header: "使用", className: "muted mono", cell: (r) => r.usageCount ?? 0 },
              { header: "排序", className: "muted mono", cell: (r) => r.sortOrder ?? 0 },
              { header: "更新时间", className: "muted mono", cell: (r) => r.updateTime || "—" },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      { label: "编辑", onClick: () => openEdit(r) },
                      { label: "删除", onClick: () => remove(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      <AdminModal
        open={modalOpen}
        size="lg"
        title={editing ? "编辑风格" : "新建风格"}
        subtitle={editing ? `修改「${editing.name}」，保存后画布风格广场即时更新` : "创建官方风格预设，发布到画布风格广场"}
        footNote="提示词直接追加到用户生成请求，请使用英文效果词；封面建议 4:5 竖图"
        onClose={() => setModalOpen(false)}
        onSave={save}
        saveLabel={saving ? "保存中…" : "保存"}
      >
        <FormCard title="基本信息">
          <FormGrid>
            <Field label="风格名称" required span={2}>
              <input
                placeholder="如：吉卜力"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="短名称" span={2} hint="节点按钮上的回显，缺省用名称">
              <input
                placeholder="如：吉卜力"
                value={form.shortName}
                onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))}
              />
            </Field>
            <Field label="分类" span={2}>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORY_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field label="一句话描述" span={4}>
              <input
                placeholder="展示在风格卡片上的简介"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field label="风格提示词" required span={4} hint="生成时追加到用户提示词后">
              <textarea
                rows={4}
                placeholder="如：cinematic photography, dramatic lighting, shallow depth of field"
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              />
            </Field>
            <Field label="封面图 URL" span={4} hint="可选；建议 4:5 竖图">
              <input
                placeholder="https://…"
                value={form.coverUrl}
                onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
              />
            </Field>
            <Field label="作者署名" span={2}>
              <input
                placeholder="官方"
                value={form.authorName}
                onChange={(e) => setForm((f) => ({ ...f, authorName: e.target.value }))}
              />
            </Field>
          </FormGrid>
        </FormCard>
        <FormCard title="发布设置">
          <FormGrid>
            <Field label="上架状态" span={2}>
              <select
                value={String(form.status)}
                onChange={(e) => setForm((f) => ({ ...f, status: Number(e.target.value) }))}
              >
                <option value="1">已上架</option>
                <option value="0">已下架</option>
              </select>
            </Field>
            <Field label="公开到广场" span={2}>
              <select
                value={String(form.publicFlag)}
                onChange={(e) => setForm((f) => ({ ...f, publicFlag: Number(e.target.value) }))}
              >
                <option value="1">公开</option>
                <option value="0">不公开</option>
              </select>
            </Field>
            <Field label="官方标记" span={2}>
              <select
                value={String(form.official)}
                onChange={(e) => setForm((f) => ({ ...f, official: Number(e.target.value) }))}
              >
                <option value="1">官方</option>
                <option value="0">普通</option>
              </select>
            </Field>
            <Field label="可商用" span={2}>
              <select
                value={String(form.commercial)}
                onChange={(e) => setForm((f) => ({ ...f, commercial: Number(e.target.value) }))}
              >
                <option value="0">仅自用</option>
                <option value="1">可商用</option>
              </select>
            </Field>
            <Field label="排序值" span={2} hint="越小越靠前">
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}
