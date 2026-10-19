"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Clapperboard,
  Edit3,
  ImageIcon,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { AdminModal, Field, FormCard, FormGrid } from "@/components/admin";
import { PopoverSelect } from "@/components/shared/popover-select";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import { useAuthStore } from "@/stores/use-auth-store";
import { uploadFileSmart } from "@/lib/api";
import { marketApi, type StudioModelVO } from "@/lib/market-api";
import {
  adminStudioTemplateApi as api,
  type StudioTemplate,
  type StudioTemplateSave,
  type StudioTemplatePage,
  type TemplateSource,
} from "@/lib/studio-template-api";
import { TemplateMedia } from "@/components/studio/create-studio/template-media";
import { templateInputs } from "@/lib/studio-template";
import css from "./page.module.css";

const modeLabels = {
  t2i: "文生图",
  i2i: "图生图",
  t2v: "文生视频",
  i2v: "图生视频",
  flf: "首尾帧视频",
  ref: "多模态参考视频",
};
function empty(
  kind: "style" | "inspiration",
  mediaType: "image" | "video",
): StudioTemplateSave {
  return {
    kind,
    mediaType,
    title: "",
    description: "",
    category: "",
    prompt: "",
    coverUrl: "",
    previewUrl: "",
    authorName: "",
    inputHint: "",
    mode: mediaType === "image" ? "i2i" : "i2v",
    modelKey: "",
    requirements: { images: 1, videos: 0, audio: 0 },
    options: {},
    status: 0,
    sortOrder: 0,
  };
}

export default function StudioTemplatesAdmin() {
  const user = useAuthStore((s) => s.user);
  const [kind, setKind] = useState<"style" | "inspiration">("style");
  const [media, setMedia] = useState<"image" | "video">("image");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StudioTemplatePage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<
    (StudioTemplateSave & { id?: string }) | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState("");
  const canImport =
    user?.role === 9 || !!user?.adminPerms?.includes("admin.generations");
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    api
      .list(
        {
          kind,
          mediaType: media,
          status,
          keyword: query,
          pageNum: page,
          pageSize: 18,
        },
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          const last = Math.max(1, res.data.pages);
          if (page > last) setPage(last);
          else setData(res.data);
        } else setError(res.message || "读取模板失败");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("读取失败，请重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, media, status, query, page, version]);
  const remove = async (row: StudioTemplate) => {
    if (
      deleting ||
      !(await confirmDialog({
        title: "删除创作模板",
        message: `确定删除「${row.title}」？已生成的作品不会受影响。`,
        confirmText: "删除",
      }))
    )
      return;
    setDeleting(row.id);
    try {
      const res = await api.remove(row.id);
      if (res.success) {
        toast.success("已删除");
        setVersion((v) => v + 1);
      } else toast.error(res.message || "删除失败");
    } finally {
      setDeleting("");
    }
  };
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <span className={css.eyebrow}>STUDIO / CURATION</span>
          <h1>创作模板</h1>
          <p>风格定义方向，灵感提供成品。让每一次创作都有一个好的起点。</p>
        </div>
        <div className={css.actions}>
          {canImport && (
            <button
              className="adm-btn ghost"
              onClick={() => setImporting(true)}
            >
              <ArrowDownToLine size={15} />
              从用户作品导入
            </button>
          )}
          <button
            className="adm-btn"
            onClick={() => setDraft(empty(kind, media))}
          >
            <Plus size={16} />
            新建{kind === "style" ? "风格" : "灵感"}
          </button>
        </div>
      </header>
      <div className={css.kinds} role="group" aria-label="模板类型">
        <button
          className={kind === "style" ? css.active : ""}
          onClick={() => {
            setKind("style");
            setPage(1);
          }}
        >
          <Layers3 size={22} />
          <span>
            <strong>风格主题</strong>
            <small>视觉语言、叙事方向、系列主题</small>
          </span>
        </button>
        <button
          className={kind === "inspiration" ? css.active : ""}
          onClick={() => {
            setKind("inspiration");
            setPage(1);
          }}
        >
          <Sparkles size={22} />
          <span>
            <strong>灵感做同款</strong>
            <small>成品预览 + 提示词 + 素材要求</small>
          </span>
        </button>
      </div>
      <div className={css.toolbar}>
        <div className={css.mediaTabs}>
          <button
            className={media === "image" ? css.active : ""}
            onClick={() => {
              setMedia("image");
              setPage(1);
            }}
          >
            <ImageIcon size={15} />
            图片
          </button>
          <button
            className={media === "video" ? css.active : ""}
            onClick={() => {
              setMedia("video");
              setPage(1);
            }}
          >
            <Clapperboard size={15} />
            视频
          </button>
        </div>
        <PopoverSelect
          label="上架状态"
          value={status}
          options={[
            { value: "", label: "全部状态" },
            { value: "1", label: "已上架" },
            { value: "0", label: "草稿 / 已下架" },
          ]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(keyword);
            setPage(1);
          }}
        >
          <Search size={15} />
          <input
            value={keyword}
            aria-label="搜索模板"
            placeholder="搜索名称、描述"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button className="adm-btn ghost small">查询</button>
        </form>
      </div>
      {error ? (
        <div className={css.empty} role="alert">
          <p>{error}</p>
          <button className="adm-btn" onClick={() => setVersion((v) => v + 1)}>
            重试
          </button>
        </div>
      ) : loading ? (
        <div className={css.empty} role="status">
          正在读取创作模板…
        </div>
      ) : !data?.records.length ? (
        <div className={css.empty}>
          <Layers3 size={32} />
          <h3>
            还没有{media === "image" ? "图片" : "视频"}
            {kind === "style" ? "风格" : "灵感"}
          </h3>
          <p>上传预览、填写提示词和素材要求，保存为草稿或直接上架。</p>
          <button
            className="adm-btn"
            onClick={() => setDraft(empty(kind, media))}
          >
            创建第一个模板
          </button>
        </div>
      ) : (
        <div className={css.grid}>
          {data.records.map((row) => (
            <article className={css.card} key={row.id}>
              <TemplateMedia key={row.coverUrl + row.previewUrl} row={row} />
              <div className={css.cardBody}>
                <span className={row.status === 1 ? css.live : css.draft}>
                  {row.status === 1 ? "已上架" : "草稿 / 已下架"}
                </span>
                <h3>{row.title}</h3>
                <p>
                  {row.category || "未分类"} · {templateInputs(row)}
                </p>
                <footer>
                  <small>
                    排序 {row.sortOrder} · 使用 {row.uses} 次
                  </small>
                  <button
                    className="adm-btn ghost small"
                    aria-label={`编辑${row.title}`}
                    onClick={() => setDraft(row)}
                  >
                    <Edit3 size={14} />
                    编辑
                  </button>
                  <button
                    className="adm-btn ghost small"
                    disabled={!!deleting}
                    aria-label={`删除${row.title}`}
                    onClick={() => void remove(row)}
                  >
                    <Trash2 size={14} />
                  </button>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
      <footer className={css.pager}>
        <span>共 {data?.total ?? 0} 个模板 · 保存后立即生效</span>
        <div>
          <button
            className="adm-btn ghost small"
            disabled={loading || page <= 1}
            onClick={() => setPage((v) => v - 1)}
          >
            上一页
          </button>
          <span>
            {page} / {Math.max(1, data?.pages || 1)}
          </span>
          <button
            className="adm-btn ghost small"
            disabled={loading || page >= (data?.pages || 1)}
            onClick={() => setPage((v) => v + 1)}
          >
            下一页
          </button>
        </div>
      </footer>
      {draft && (
        <TemplateEditor
          key={draft.id || "new"}
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {importing && (
        <SourcePicker
          onClose={() => setImporting(false)}
          onImported={(row) => {
            setImporting(false);
            setDraft(row);
            setKind("inspiration");
            setMedia(row.mediaType);
            setPage(1);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: StudioTemplateSave & { id?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [models, setModels] = useState<StudioModelVO[]>([]);
  const [uploading, setUploading] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    marketApi.studioModels(form.mediaType).then((r) => {
      if (current)
        setModels(
          r.success && r.data
            ? r.data.filter((m) => m.type === form.mediaType)
            : [],
        );
    });
    return () => {
      current = false;
    };
  }, [form.mediaType]);
  const change = <K extends keyof StudioTemplateSave>(
    key: K,
    value: StudioTemplateSave[K],
  ) => setForm((v) => ({ ...v, [key]: value }));
  const upload = async (
    file: File | undefined,
    key: "coverUrl" | "previewUrl",
  ) => {
    if (!file || uploading) return;
    setUploading(key);
    setError("");
    try {
      const res = await uploadFileSmart(file);
      if (!alive.current) return;
      if (res.success && res.data) change(key, res.data.fileUrl);
      else setError(res.message || "上传失败");
    } catch {
      if (alive.current) setError("上传失败，请重试");
    } finally {
      if (alive.current) setUploading("");
    }
  };
  const save = async () => {
    if (saving || uploading) return false;
    setSaving(true);
    setError("");
    try {
      const res = await api.save(form, form.id);
      if (res.success) {
        toast.success(form.status ? "模板已上架" : "草稿已保存");
        onSaved();
        return true;
      }
      setError(res.message || "保存失败");
      return false;
    } catch {
      setError("保存失败，请重试");
      return false;
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const modes = (
    form.mediaType === "image" ? ["t2i", "i2i"] : ["t2v", "i2v", "flf", "ref"]
  ) as StudioTemplate["mode"][];
  return (
    <AdminModal
      open
      size="xl"
      title={initial.id ? "编辑创作模板" : "新建创作模板"}
      subtitle={
        form.kind === "style"
          ? "定义视觉方向，让用户带着自己的主体创作。"
          : "提供真实成品与具体提示词，让用户换素材做同款。"
      }
      onClose={onClose}
      closeable={!saving && !uploading}
      showCancel={!saving && !uploading}
      onSave={save}
      saveDisabled={!!uploading || saving}
      saveLabel={form.status === 1 ? "保存并上架" : "保存草稿"}
      footNote="上架后会出现在创作台对应的图片 / 视频栏目。"
    >
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.editor}>
        <div>
          <FormCard
            title={
              <>
                <span className={css.sectionNumber}>01</span>展示信息
              </>
            }
          >
            <FormGrid>
              <Field label="名称" required>
                <input
                  maxLength={128}
                  value={form.title}
                  placeholder="例如：定格黏土动画 / 换装试衣"
                  onChange={(e) => change("title", e.target.value)}
                />
              </Field>
              <Field label="分类">
                <input
                  maxLength={64}
                  value={form.category}
                  placeholder="例如：人物写真 / 电商 / 电影叙事"
                  onChange={(e) => change("category", e.target.value)}
                />
              </Field>
              <Field label="媒体类型">
                <PopoverSelect
                  value={form.mediaType}
                  label="媒体类型"
                  options={[
                    { value: "image", label: "图片" },
                    { value: "video", label: "视频" },
                  ]}
                  onChange={(v) =>
                    setForm((old) => ({
                      ...old,
                      mediaType: v as "image" | "video",
                      mode: v === "image" ? "i2i" : "i2v",
                      requirements: { images: 1, videos: 0, audio: 0 },
                      modelKey: "",
                      options: {},
                    }))
                  }
                />
              </Field>
              <Field label="作者署名">
                <input
                  maxLength={64}
                  value={form.authorName}
                  placeholder="可选，填写获准展示的名称"
                  onChange={(e) => change("authorName", e.target.value)}
                />
              </Field>
            </FormGrid>
            <Field label="一句话介绍">
              <textarea
                rows={2}
                maxLength={512}
                value={form.description}
                placeholder="告诉用户，这个模板能做出什么。"
                onChange={(e) => change("description", e.target.value)}
              />
            </Field>
          </FormCard>
          <FormCard
            title={
              <>
                <span className={css.sectionNumber}>02</span>提示词与素材
              </>
            }
          >
            <Field label="完整提示词" required>
              <textarea
                rows={7}
                maxLength={20000}
                value={form.prompt}
                placeholder={
                  form.kind === "style"
                    ? "描述稳定的画面语言、材质、色彩、镜头与叙事方向。用户描述会接在后面。"
                    : "写好具体操作，例如：用图片2中的衣服替换图片1人物的服装，保持人物和背景不变。"
                }
                onChange={(e) => change("prompt", e.target.value)}
              />
            </Field>
            <Field label="用户需要上传什么">
              <textarea
                rows={2}
                maxLength={1024}
                value={form.inputHint}
                placeholder="例如：图片1上传人物，图片2上传衣服；无需上传示例成品。"
                onChange={(e) => change("inputHint", e.target.value)}
              />
            </Field>
            <FormGrid>
              <Field label="创作模式">
                <PopoverSelect
                  label="创作模式"
                  value={form.mode}
                  options={modes.map((value) => ({
                    value,
                    label: modeLabels[value],
                  }))}
                  onChange={(v) =>
                    setForm((old) => ({
                      ...old,
                      mode: v as StudioTemplate["mode"],
                      requirements: {
                        images:
                          v === "t2i" || v === "t2v" ? 0 : v === "flf" ? 2 : 1,
                        videos: 0,
                        audio: 0,
                      },
                    }))
                  }
                />
              </Field>
              <Field label="推荐模型">
                <PopoverSelect
                  label="推荐模型"
                  value={form.modelKey}
                  options={[
                    { value: "", label: "沿用用户当前模型" },
                    ...models.map((m) => ({
                      value: m.modelKey,
                      label: m.name,
                    })),
                    ...(form.modelKey &&
                    !models.some((m) => m.modelKey === form.modelKey)
                      ? [
                          {
                            value: form.modelKey,
                            label: `${form.modelKey}（未上架）`,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(v) => change("modelKey", v)}
                />
              </Field>
            </FormGrid>
            <div className={css.requirements}>
              {(["images", "videos", "audio"] as const).map((key, i) => (
                <label key={key}>
                  至少{["图片", "视频", "音频"][i]}数
                  <input
                    type="number"
                    min={0}
                    max={key === "images" ? 4 : 3}
                    disabled={key !== "images" && form.mode !== "ref"}
                    value={form.requirements[key]}
                    onChange={(e) =>
                      change("requirements", {
                        ...form.requirements,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </FormCard>
          <FormCard
            title={
              <>
                <span className={css.sectionNumber}>03</span>建议参数与发布
              </>
            }
          >
            <FormGrid>
              {(["aspectRatio", "resolution", "quality"] as const).map(
                (key, i) => (
                  <Field key={key} label={["画面比例", "分辨率", "质量"][i]}>
                    <input
                      maxLength={32}
                      value={form.options[key] || ""}
                      placeholder={
                        [
                          "如 16:9，留空沿用当前",
                          "如 1080p / 2K",
                          "如 high，留空沿用当前",
                        ][i]
                      }
                      onChange={(e) =>
                        change("options", {
                          ...form.options,
                          [key]: e.target.value,
                        })
                      }
                    />
                  </Field>
                ),
              )}
              {form.mediaType === "video" && (
                <Field label="视频时长（秒）">
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={form.options.duration || 0}
                    onChange={(e) =>
                      change("options", {
                        ...form.options,
                        duration: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
              <Field label="排序（越小越靠前）">
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={form.sortOrder}
                  onChange={(e) => change("sortOrder", Number(e.target.value))}
                />
              </Field>
              <Field label="展示状态">
                <PopoverSelect
                  label="展示状态"
                  value={String(form.status)}
                  options={[
                    { value: "0", label: "草稿 / 已下架" },
                    { value: "1", label: "上架到创作台" },
                  ]}
                  onChange={(v) => change("status", Number(v))}
                />
              </Field>
            </FormGrid>
          </FormCard>
        </div>
        <aside className={css.preview}>
          <h3>用户看到的预览</h3>
          <div className={css.previewArtwork}>
            <TemplateMedia
              key={form.coverUrl + form.previewUrl}
              row={form}
              controls={form.mediaType === "video"}
            />
          </div>
          <h4>{form.title || "你的模板名称"}</h4>
          <p>
            {form.description || "上传真实成品预览，让用户一眼看懂创作效果。"}
          </p>
          {(
            [
              "coverUrl",
              ...(form.mediaType === "video" ? ["previewUrl"] : []),
            ] as ("coverUrl" | "previewUrl")[]
          ).map((key) => (
            <div key={key} className={css.upload}>
              <label>
                {key === "coverUrl" ? "封面图片" : "视频成片预览"}
                <input
                  type="text"
                  inputMode="url"
                  className={css.mediaUrl}
                  spellCheck={false}
                  value={form[key]}
                  placeholder="上传文件，或粘贴媒体地址"
                  onChange={(e) => change(key, e.target.value)}
                />
              </label>
              <label className="adm-btn ghost small">
                <Upload size={14} />
                {uploading === key ? "正在上传…" : "上传文件"}
                <input
                  type="file"
                  hidden
                  disabled={!!uploading || saving}
                  accept={
                    key === "coverUrl"
                      ? "image/png,image/jpeg,image/webp,image/gif"
                      : "video/mp4,video/webm,video/quicktime"
                  }
                  onChange={(e) => {
                    void upload(e.target.files?.[0], key);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ))}
          <p className={css.note}>
            成品只用于展示，不会自动作为用户的参考素材发送。视频上架需要封面和可播放的成片地址。
          </p>
        </aside>
      </div>
    </AdminModal>
  );
}

function SourcePicker({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (row: StudioTemplate) => void;
}) {
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [filter, setFilter] = useState({ userId: "", taskId: "" });
  const [rows, setRows] = useState<TemplateSource[]>([]);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    api
      .sources({ ...filter, pageNum: page }, c.signal)
      .then((r) => {
        if (c.signal.aborted) return;
        if (r.success && r.data) {
          setRows(r.data.records);
          setPages(r.data.pages || 1);
        } else setError(r.message || "读取生成记录失败");
      })
      .catch(() => {
        if (!c.signal.aborted) setError("读取失败，请重试");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [filter, page, retry]);
  const pick = async (row: TemplateSource) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(row.id);
    try {
      const res = await api.fromTask(row.id);
      if (res.success && res.data) {
        toast.success("已导入，请核对提示词和素材要求后上架");
        onImported(res.data);
      } else setError(res.message || "导入失败");
    } catch {
      setError("导入失败，请重试");
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  return (
    <AdminModal
      open
      size="xl"
      title="从用户作品创建灵感"
      subtitle="只导入已完成的图片 / 视频直接生成结果。新灵感保存为草稿，用户原始上传素材不会公开。"
      onClose={onClose}
      closeable={!busy}
      showCancel={!busy}
      saveDisabled={!!busy}
      saveLabel="完成"
      footNote="导入后请确认作品可公开使用，并编辑展示名称、提示词及素材要求。"
    >
      <form
        className={css.sourceSearch}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ userId: userId.trim(), taskId: taskId.trim() });
          setPage(1);
        }}
      >
        <input
          value={userId}
          inputMode="numeric"
          aria-label="筛选用户 ID"
          placeholder="用户 ID（可选）"
          onChange={(e) => setUserId(e.target.value)}
        />
        <input
          value={taskId}
          inputMode="numeric"
          aria-label="筛选生成任务 ID"
          placeholder="生成任务 ID（可选）"
          onChange={(e) => setTaskId(e.target.value)}
        />
        <button className="adm-btn">查询</button>
      </form>
      {error ? (
        <div className={css.empty} role="alert">
          <p>{error}</p>
          <button className="adm-btn" onClick={() => setRetry((v) => v + 1)}>
            重试
          </button>
        </div>
      ) : loading ? (
        <div className={css.empty}>正在读取…</div>
      ) : !rows.length ? (
        <div className={css.empty}>没有可导入的成功生成作品</div>
      ) : (
        <div className={css.sources}>
          {rows.map((row) => (
            <article key={row.id}>
              {row.mediaType === "image" ? (
                <img src={row.resultUrl} alt="用户生成图片" loading="lazy" />
              ) : (
                <video
                  src={row.resultUrl}
                  controls
                  preload="none"
                  playsInline
                />
              )}
              <p>{row.prompt || "此结果需要运营填写公开提示词"}</p>
              <small>
                用户 {row.userId} · {row.createTime}
              </small>
              <button
                className="adm-btn ghost small"
                disabled={!!busy}
                onClick={() => void pick(row)}
              >
                {busy === row.id ? "正在导入…" : "导入为灵感草稿"}
              </button>
            </article>
          ))}
        </div>
      )}
      <div className={css.pager}>
        <button
          className="adm-btn ghost small"
          disabled={loading || page <= 1}
          onClick={() => setPage((v) => v - 1)}
        >
          上一页
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="adm-btn ghost small"
          disabled={loading || page >= pages}
          onClick={() => setPage((v) => v + 1)}
        >
          下一页
        </button>
      </div>
    </AdminModal>
  );
}
