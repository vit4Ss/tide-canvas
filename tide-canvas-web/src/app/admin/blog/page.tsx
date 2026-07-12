"use client";

/* ============================================================================
   /admin/blog — 博客管理 (REAL data)。

   与前台 /blog 同表同源（LINKAGE）：
   - 文章列表 : GET    /api/admin/blog/posts（分页 + 来源/状态/关键词筛选）
   - 新建文章 : POST   /api/admin/blog/posts（自建 self 来源，Markdown 正文）
   - 编辑     : PUT    /api/admin/blog/posts/:id（两种来源通用，可上下架）
   - 删除     : DELETE /api/admin/blog/posts/:id
   - 频道源   : GET/POST/PUT/DELETE /api/admin/blog/channels
   - 立即同步 : POST   /api/admin/blog/channels/:id/sync
     （抓 t.me/s/<username> 公开预览，图片转存本站存储，按消息 id 幂等去重）

   复用共享后台组件（Panel/AdminTable/StatusPill/RowActions/AdminModal/
   FormCard/FormGrid/Field/FilterChips/SwitchToggle）。
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
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
  SwitchToggle,
  TableSkeleton,
} from "@/components/admin";
import { useAuthStore } from "@/stores/use-auth-store";
import { adminBlogApi } from "@/lib/blog-api";
import { uploadFileSmart } from "@/lib/api";
import type { AdminBlogPostVO, BlogAdminQuery, BlogChannelVO } from "@/types/blog";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";

const PAGE_SIZE = 20;

function fmtTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("zh-CN", { hour12: false });
}

const FILTERS = ["全部", "自建", "频道同步", "草稿箱"] as const;
type Filter = (typeof FILTERS)[number];

function queryForFilter(filter: Filter, page: number): BlogAdminQuery {
  const q: BlogAdminQuery = { pageNum: page, pageSize: PAGE_SIZE };
  if (filter === "自建") q.type = "self";
  if (filter === "频道同步") q.type = "telegram";
  if (filter === "草稿箱") q.status = "0";
  return q;
}

interface PostForm {
  title: string;
  summary: string;
  coverUrl: string;
  content: string;
  status: number;
}
const emptyPostForm = (): PostForm => ({
  title: "",
  summary: "",
  coverUrl: "",
  content: "",
  status: 1,
});

export default function AdminBlogPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);

  // ---- 文章 ----
  const [posts, setPosts] = useState<AdminBlogPostVO[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [filter, setFilter] = useState<Filter>("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 编辑/新建弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PostForm>(emptyPostForm());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ---- 频道 ----
  const [channels, setChannels] = useState<BlogChannelVO[]>([]);
  const [chLoading, setChLoading] = useState(true);
  const [chModalOpen, setChModalOpen] = useState(false);
  const [chForm, setChForm] = useState({ username: "", title: "" });
  const [chSaving, setChSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // 频道编辑（仅备注名；username 是数据源标识，填错请删除重加）
  const [chEditing, setChEditing] = useState<BlogChannelVO | null>(null);
  const [chEditTitle, setChEditTitle] = useState("");

  const loadPosts = useCallback(
    async (page = 1, f: Filter = filter, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        await ensureSession();
        const res = await adminBlogApi.posts(queryForFilter(f, page));
        if (res.success && res.data) {
          setPosts(res.data.records ?? []);
          setTotal(res.data.total ?? 0);
          setPageNum(page);
        } else {
          setError(res.message || "加载文章失败");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [ensureSession, filter],
  );

  const loadChannels = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setChLoading(true);
      try {
        await ensureSession();
        const res = await adminBlogApi.channels();
        if (res.success && res.data) setChannels(res.data);
        else if (!opts?.silent) toast.error(res.message || "加载频道失败");
      } finally {
        if (!opts?.silent) setChLoading(false);
      }
    },
    [ensureSession],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadPosts(1);
      void loadChannels();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 文章操作 ----

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyPostForm());
    setModalOpen(true);
  };

  const openEdit = (p: AdminBlogPostVO) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      summary: p.summary,
      coverUrl: p.coverUrl,
      content: p.content,
      status: p.status,
    });
    setModalOpen(true);
  };

  const savePost = async () => {
    const title = form.title.trim();
    if (!title) {
      toast.error("请填写标题");
      return false;
    }
    setSaving(true);
    try {
      const body = {
        title,
        summary: form.summary.trim(),
        coverUrl: form.coverUrl.trim(),
        content: form.content,
        status: form.status,
      };
      const res = editingId
        ? await adminBlogApi.updatePost(editingId, body)
        : await adminBlogApi.createPost(body);
      if (res.success) {
        toast.success(editingId ? "文章已保存" : "文章已创建");
        setModalOpen(false);
        loadPosts(editingId ? pageNum : 1, filter, { silent: true });
        return true;
      }
      toast.error(res.message || "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (p: AdminBlogPostVO) => {
    const next = p.status === 1 ? 0 : 1;
    const res = await adminBlogApi.updatePost(p.id, { status: next });
    if (res.success) {
      toast.success(next === 1 ? "已发布" : "已下架为草稿");
      loadPosts(pageNum, filter, { silent: true });
    } else {
      toast.error(res.message || "操作失败");
    }
  };

  const removePost = async (p: AdminBlogPostVO) => {
    if (
      !(await confirmDialog({
        title: "删除文章",
        message: `确认删除「${p.title}」？前台博客将同步移除。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminBlogApi.removePost(p.id);
    if (res.success) {
      toast.success("文章已删除");
      loadPosts(pageNum, filter, { silent: true });
      loadChannels({ silent: true });
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  const onPickCover = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadFileSmart(file);
      if (res.success && res.data?.fileUrl) {
        setForm((f) => ({ ...f, coverUrl: res.data!.fileUrl }));
        toast.success("封面已上传");
      } else {
        toast.error(res.message || "上传失败");
      }
    } finally {
      setUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  // ---- 频道操作 ----

  const addChannel = async () => {
    const username = chForm.username.trim();
    if (!username) {
      toast.error("请填写频道用户名或 t.me 链接");
      return false;
    }
    setChSaving(true);
    try {
      const res = await adminBlogApi.createChannel({
        username,
        title: chForm.title.trim(),
      });
      if (res.success) {
        toast.success("频道已添加，点击「同步」开始导入");
        setChModalOpen(false);
        setChForm({ username: "", title: "" });
        loadChannels({ silent: true });
        return true;
      }
      toast.error(res.message || "添加失败");
      return false;
    } finally {
      setChSaving(false);
    }
  };

  const openChannelEdit = (ch: BlogChannelVO) => {
    setChEditing(ch);
    setChEditTitle(ch.title);
  };

  const saveChannelEdit = async () => {
    if (!chEditing) return false;
    setChSaving(true);
    try {
      const res = await adminBlogApi.updateChannel(chEditing.id, {
        title: chEditTitle.trim(),
      });
      if (res.success) {
        toast.success("频道备注已保存");
        setChEditing(null);
        loadChannels({ silent: true });
        return true;
      }
      toast.error(res.message || "保存失败");
      return false;
    } finally {
      setChSaving(false);
    }
  };

  const toggleChannel = async (ch: BlogChannelVO, enabled: boolean) => {
    const res = await adminBlogApi.updateChannel(ch.id, { enabled });
    if (res.success) loadChannels({ silent: true });
    else toast.error(res.message || "操作失败");
  };

  const syncChannel = async (ch: BlogChannelVO) => {
    setSyncingId(ch.id);
    try {
      const res = await adminBlogApi.syncChannel(ch.id);
      if (res.success && res.data) {
        const r = res.data;
        const parts = [`新增 ${r.created} 篇`];
        if (r.skippedEmpty > 0) parts.push(`跳过无文字消息 ${r.skippedEmpty} 条`);
        if (r.imageFailed > 0) parts.push(`${r.imageFailed} 张图转存失败`);
        toast.success(`「${r.channelTitle || ch.username}」同步完成：${parts.join("，")}`);
        loadChannels({ silent: true });
        loadPosts(1, filter, { silent: true });
      } else {
        toast.error(res.message || "同步失败");
      }
    } finally {
      setSyncingId(null);
    }
  };

  const removeChannel = async (ch: BlogChannelVO) => {
    if (
      !(await confirmDialog({
        title: "删除频道",
        message: `确认删除频道「${ch.title || ch.username}」？已导入的 ${ch.postCount} 篇文章会保留，可在文章列表中单独管理。`,
        confirmText: "删除",
      }))
    )
      return;
    const res = await adminBlogApi.removeChannel(ch.id);
    if (res.success) {
      toast.success("频道已删除");
      loadChannels({ silent: true });
    } else {
      toast.error(res.message || "删除失败");
    }
  };

  return (
    <div className="adm-page">
      {error ? (
        <AdminAlert
          tone="error"
          title="博客数据加载失败"
          action={
            <button type="button" className="adm-btn ghost" onClick={() => loadPosts(pageNum)}>
              <RefreshCw aria-hidden size={14} />
              重新加载
            </button>
          }
        >
          {error}
        </AdminAlert>
      ) : null}

      {/* ── 文章 ─────────────────────────────────────────────── */}
      <Panel
        title="文章"
        sub={`共 ${total} 篇 · 前台 /blog 实时同源`}
        tools={
          <>
            <FilterChips
              options={[...FILTERS]}
              value={filter}
              onChange={(v) => {
                setFilter(v as Filter);
                void loadPosts(1, v as Filter);
              }}
            />
            <button type="button" className="adm-btn" onClick={openCreate}>
              <Plus aria-hidden size={15} />
              新建文章
            </button>
          </>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : posts.length === 0 ? (
          <AdminEmptyState
            title="当前筛选下没有文章"
            description="手写一篇，或在下方添加 Telegram 频道后点击「同步」导入内容。"
            action={
              <button type="button" className="adm-btn" onClick={openCreate}>
                <Plus aria-hidden size={15} />
                新建文章
              </button>
            }
          />
        ) : (
          <AdminTable<AdminBlogPostVO>
            label="博客文章列表"
            rows={posts}
            rowKey={(r) => r.id}
            server={{ page: pageNum, pageSize: PAGE_SIZE, total, onPage: (p) => loadPosts(p) }}
            columns={[
              {
                header: "文章",
                width: "34%",
                className: "strong",
                cell: (r) => (
                  <div className="cellflex">
                    <span
                      className="sw"
                      style={
                        r.coverUrl
                          ? { background: `center / cover no-repeat url("${r.coverUrl}")` }
                          : undefined
                      }
                    />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 360,
                        }}
                      >
                        {r.title}
                      </div>
                      {r.summary ? (
                        <div
                          className="muted"
                          style={{
                            fontWeight: 400,
                            fontSize: 12,
                            marginTop: 2,
                            maxWidth: 360,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.summary}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              },
              {
                header: "来源",
                cell: (r) =>
                  r.source === "telegram" ? (
                    <StatusPill tone="blue">频道同步</StatusPill>
                  ) : (
                    <StatusPill tone="gray">自建</StatusPill>
                  ),
              },
              {
                header: "状态",
                cell: (r) =>
                  r.status === 1 ? (
                    <StatusPill tone="green">已发布</StatusPill>
                  ) : (
                    <StatusPill tone="gray">草稿</StatusPill>
                  ),
              },
              {
                header: "发布时间",
                className: "muted mono",
                cell: (r) => fmtTime(r.publishedAt),
              },
              {
                header: "阅读",
                className: "muted",
                cell: (r) => (r.viewCount > 0 ? r.viewCount : "—"),
              },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      { label: "编辑", onClick: () => openEdit(r) },
                      {
                        label: r.status === 1 ? "下架" : "发布",
                        onClick: () => toggleStatus(r),
                      },
                      { label: "删除", onClick: () => removePost(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* ── Telegram 频道源 ──────────────────────────────────── */}
      <Panel
        title="Telegram 频道源"
        sub="抓取公开频道网页预览（t.me/s），只导入含文字的消息，图片自动转存本站存储；重复同步不会产生重复文章"
        tools={
          <button type="button" className="adm-btn" onClick={() => setChModalOpen(true)}>
            <Plus aria-hidden size={15} />
            添加频道
          </button>
        }
      >
        {chLoading ? (
          <TableSkeleton rows={3} />
        ) : channels.length === 0 ? (
          <AdminEmptyState
            title="还没有频道源"
            description="粘贴公开频道链接（如 https://t.me/HotSora）即可添加；私有频道无网页预览，无法抓取。"
            action={
              <button type="button" className="adm-btn" onClick={() => setChModalOpen(true)}>
                <Plus aria-hidden size={15} />
                添加频道
              </button>
            }
          />
        ) : (
          <AdminTable<BlogChannelVO>
            label="Telegram 频道列表"
            rows={channels}
            rowKey={(r) => r.id}
            columns={[
              {
                header: "频道",
                width: "30%",
                className: "strong",
                cell: (r) => (
                  <div style={{ minWidth: 0 }}>
                    <div>{r.title || r.username}</div>
                    <div className="muted" style={{ fontWeight: 400, fontSize: 12, marginTop: 2 }}>
                      @{r.username}
                    </div>
                  </div>
                ),
              },
              {
                header: "启用",
                cell: (r) => (
                  <SwitchToggle
                    checked={r.enabled}
                    onChange={(v) => void toggleChannel(r, v)}
                    aria-label={`启用频道 ${r.username}`}
                  />
                ),
              },
              {
                header: "已导入",
                className: "muted",
                cell: (r) => (r.postCount > 0 ? `${r.postCount} 篇` : "—"),
              },
              {
                header: "最近同步",
                className: "muted mono",
                cell: (r) => fmtTime(r.lastSyncAt),
              },
              {
                header: "操作",
                align: "right",
                cell: (r) => (
                  <RowActions
                    actions={[
                      {
                        label: syncingId === r.id ? "同步中…" : "同步",
                        onClick: () => {
                          if (!syncingId) void syncChannel(r);
                        },
                      },
                      { label: "编辑", onClick: () => openChannelEdit(r) },
                      { label: "删除", onClick: () => removeChannel(r) },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>

      {/* ── 文章编辑弹窗 ─────────────────────────────────────── */}
      <AdminModal
        open={modalOpen}
        size="lg"
        title={editingId ? "编辑文章" : "新建文章"}
        subtitle={
          editingId
            ? "两种来源的文章均可编辑；保存后前台立即生效"
            : "自建文章，正文支持 Markdown"
        }
        onClose={() => setModalOpen(false)}
        onSave={savePost}
        saveLabel={saving ? "保存中…" : editingId ? "保存修改" : "创建文章"}
      >
        <FormCard title="文章内容">
          <FormGrid>
            <Field label="标题" required span={4}>
              <input
                placeholder="如：8 个适合独立站的 AI 配图思路"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field
              label="封面"
              span={4}
              hint="图片 URL；也可以直接上传，会转存到本站存储"
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="https://…"
                  value={form.coverUrl}
                  onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
                />
                <button
                  type="button"
                  className="adm-btn ghost"
                  disabled={uploading}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {uploading ? "上传中…" : "上传图片"}
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void onPickCover(e.target.files?.[0] ?? null)}
                />
              </div>
            </Field>
            <Field label="摘要" span={4} hint="列表卡片上的一句话简介；留空自动从正文提取">
              <textarea
                rows={2}
                placeholder="一篇实用指南，覆盖…"
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              />
            </Field>
            <Field label="正文（Markdown）" span={4}>
              <textarea
                rows={14}
                placeholder={"## 小标题\n\n正文支持 **加粗**、[链接](https://…) 与图片 ![](url)…"}
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                style={{ fontFamily: "var(--mono)", fontSize: 13 }}
              />
            </Field>
            <Field label="状态" span={2}>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: Number(e.target.value) }))}
              >
                <option value={1}>已发布</option>
                <option value={0}>草稿</option>
              </select>
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      {/* ── 频道编辑弹窗 ─────────────────────────────────────── */}
      <AdminModal
        open={chEditing != null}
        title="编辑频道"
        subtitle={chEditing ? `@${chEditing.username}` : undefined}
        footNote="频道用户名是数据源标识，不支持修改；如添加错了频道，请删除后重新添加"
        onClose={() => setChEditing(null)}
        onSave={saveChannelEdit}
        saveLabel={chSaving ? "保存中…" : "保存"}
      >
        <FormCard title="频道信息">
          <FormGrid>
            <Field label="频道用户名" span={4}>
              <input value={chEditing ? `@${chEditing.username}` : ""} disabled />
            </Field>
            <Field label="备注名" span={4} hint="后台展示用；留空则下次同步自动取频道名称">
              <input
                placeholder="如：Sora 精选"
                value={chEditTitle}
                onChange={(e) => setChEditTitle(e.target.value)}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>

      {/* ── 添加频道弹窗 ─────────────────────────────────────── */}
      <AdminModal
        open={chModalOpen}
        title="添加 Telegram 频道"
        subtitle="仅支持公开频道（有 t.me/s 网页预览）"
        footNote="添加后点击「同步」导入最近约 100 条消息；之后每次同步只增量导入新消息"
        onClose={() => setChModalOpen(false)}
        onSave={addChannel}
        saveLabel={chSaving ? "添加中…" : "添加频道"}
      >
        <FormCard title="频道信息">
          <FormGrid>
            <Field label="频道链接或用户名" required span={4}>
              <input
                placeholder="如：https://t.me/HotSora 或 @HotSora"
                value={chForm.username}
                onChange={(e) => setChForm((f) => ({ ...f, username: e.target.value }))}
              />
            </Field>
            <Field label="备注名" span={4} hint="后台展示用；留空则同步时自动取频道名称">
              <input
                placeholder="如：Sora 精选"
                value={chForm.title}
                onChange={(e) => setChForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
          </FormGrid>
        </FormCard>
      </AdminModal>
    </div>
  );
}
