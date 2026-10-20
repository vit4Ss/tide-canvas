"use client";
/* eslint-disable @next/next/no-img-element -- Operator-selected uploads use dynamic storage URLs and the existing direct-media fallback. */

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Clapperboard,
  Copy,
  ExternalLink,
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
  type TemplateSetup,
} from "@/lib/studio-template-api";
import { TemplateMedia } from "@/components/studio/create-studio/template-media";
import { templateInputs } from "@/lib/studio-template";
import { copyTemplateDraft, templateCountRange } from "@/lib/template-operator";
import { templateOutputText, templateUploadSlots } from "@/lib/template-workshop";
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
    inputLabels: {},
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
        if (data?.records.length === 1 && page > 1) setPage(page - 1);
        setVersion((v) => v + 1);
      } else toast.error(res.message || "删除失败");
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setDeleting("");
    }
  };
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>创作模板</h1>
          <p>维护「灵感和模板」的成品效果与生成配方。已有模板可复制为草稿，再调整为新的同款。</p>
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
          <p>上传预览、填写提示词和素材要求，检查配置后上架。</p>
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
                  <button className="adm-btn ghost small" aria-label={`复制${row.title}`} onClick={() => setDraft(copyTemplateDraft(row))}>
                    <Copy size={14} />复制
                  </button>
                  {row.status === 1 && <a className="adm-btn ghost small" href={`/templates/${row.id}`} target="_blank" rel="noreferrer" aria-label={`查看${row.title}用户页面`}><ExternalLink size={14} />用户页</a>}
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
          onSaved={(row) => {
            setDraft(null);
            setKind(row.kind);
            setMedia(row.mediaType);
            setStatus(""); setKeyword(""); setQuery(""); setPage(1);
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
  onSaved: (row: StudioTemplate) => void;
}) {
  const [form, setForm] = useState(initial);
  const [models, setModels] = useState<StudioModelVO[]>([]);
  const [uploading, setUploading] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ signature: string; data: TemplateSetup }>();
  const [modelError, setModelError] = useState("");
  const [modelRetry, setModelRetry] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(true);
  const busy = useRef(false);
  const closing = useRef(false);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const checkElement = useRef<HTMLDivElement>(null);
  const saved = useRef(false);
  const signature = JSON.stringify(form);
  const dirty = signature !== JSON.stringify(initial);
  const currentCheck = checked?.signature === signature ? checked.data : undefined;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (error) { errorElement.current?.scrollIntoView({ block: "nearest" }); errorElement.current?.focus({ preventScroll: true }); }
  }, [error]);
  useEffect(() => { if (checked) checkElement.current?.scrollIntoView({ block: "nearest" }); }, [checked]);
  useEffect(() => {
    let current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelsLoading(true);
    setModelError("");
    marketApi.studioModels(form.mediaType).then((r) => {
      if (current) {
        setModels(
          r.success && r.data
            ? r.data.filter((m) => m.type === form.mediaType)
            : [],
        );
        if (!r.success) setModelError(r.message || "模型列表读取失败，请重试");
      }
    }).catch(() => {
      if (current) setModelError("模型列表读取失败，请重试");
    }).finally(() => {
      if (current) setModelsLoading(false);
    });
    return () => {
      current = false;
    };
  }, [form.mediaType, modelRetry]);
  const close = async () => {
    if (busy.current || closing.current) return;
    closing.current = true;
    try {
      if (!saved.current && dirty && !(await confirmDialog({ title: "放弃未保存的修改？", message: "关闭后，本次修改将丢失。可以先取消并保存草稿。", confirmText: "放弃修改" }))) return;
      onClose();
    } finally { closing.current = false; }
  };
  const check = async () => {
    if (busy.current) return;
    busy.current = true; setChecking(true); setError(""); setChecked(undefined);
    try {
      const res = await api.check(form);
      if (!alive.current) return;
      if (res.success && res.data) setChecked({ signature, data: res.data });
      else setError(res.message || "配置检查失败，请重试");
    } catch { if (alive.current) setError("配置检查失败，请重试"); }
    finally { busy.current = false; if (alive.current) setChecking(false); }
  };
  const change = <K extends keyof StudioTemplateSave>(
    key: K,
    value: StudioTemplateSave[K],
  ) => setForm((v) => ({ ...v, [key]: value }));
  const upload = async (
    file: File | undefined,
    key: "coverUrl" | "previewUrl",
  ) => {
    if (!file || busy.current) return;
    if (file.size > 50 * 1024 * 1024) { setError("预览文件不能超过 50 MB，请压缩后上传"); return; }
    if (!(key === "coverUrl" ? /^image\/(png|jpeg|webp|gif)$/ : /^video\/(mp4|webm|quicktime)$/).test(file.type)) { setError(key === "coverUrl" ? "封面请选择 PNG、JPG、WebP 或 GIF 图片" : "预览请选择 MP4、WebM 或 MOV 视频"); return; }
    busy.current = true;
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
      busy.current = false;
      if (alive.current) setUploading("");
    }
  };
  const save = async () => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const res = await api.save(form, form.id);
      if (res.success && res.data) {
        saved.current = true;
        toast.success(form.status ? "模板已上架" : "草稿已保存");
        onSaved(res.data);
        return true;
      }
      setError(res.message || "保存失败");
      return false;
    } catch {
      setError("保存失败，请重试");
      return false;
    } finally {
      busy.current = false;
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
          ? "配置完整视觉配方，用户上传素材即可生成，提示词仅后台可见。"
          : "提供真实成品与完整配方，用户无需填写提示词。"
      }
      onClose={() => void close()}
      closeable={!saving && !uploading && !checking}
      showCancel={!saving && !uploading && !checking}
      onSave={save}
      saveDisabled={!!uploading || saving || checking}
      saveLabel={form.status === 1 ? "保存并上架" : "保存草稿"}
      footNote="上架后展示在「灵感和模板」；用户只上传素材，提示词不会公开。"
    >
      {error && (
        <p ref={errorElement} tabIndex={-1} className={css.error} role="alert">
          {error}
        </p>
      )}
      <fieldset className={css.editor} disabled={saving || checking || !!uploading}>
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
                      inputLabels: {},
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
            <Field label="完整提示词" required={form.status === 1}>
              <textarea
                rows={7}
                maxLength={20000}
                value={form.prompt}
                placeholder={
                  form.kind === "style"
                    ? "填写可直接执行的完整配方，包括画面语言、材质、色彩、镜头与素材用途；用户不会补充描述。"
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
                      inputLabels: {},
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
              <Field label="生成模型">
                <PopoverSelect
                  label="生成模型"
                  value={form.modelKey}
                  options={[
                    { value: "", label: "上架时自动选定兼容模型" },
                    ...models.map((m) => ({
                      value: m.modelKey,
                      label: m.name,
                    })),
                    ...(form.modelKey &&
                    !models.some((m) => m.modelKey === form.modelKey)
                      ? [
                          {
                            value: form.modelKey,
                            label: `${form.modelKey}（不在当前可用列表）`,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(v) => change("modelKey", v)}
                />
              </Field>
            </FormGrid>
            {modelsLoading && <p role="status">正在读取可用模型…</p>}
            {modelError && <p role="alert">{modelError} <button type="button" className="adm-btn ghost small" onClick={() => setModelRetry(v => v + 1)}>重试读取模型</button></p>}
            <p className={css.note}>上架会固定选定的模型与输出规格。更新模型后请重新检查并试做，确认效果一致。</p>
            <div className={css.requirements}>
              {(["images", "videos", "audio"] as const).map((key, i) => (
                <label key={key}>
                  所需{["图片", "视频", "音频"][i]}数
                  <input
                    type="number"
                    min={templateCountRange(form.mode, key).min}
                    max={templateCountRange(form.mode, key).max}
                    step={1}
                    disabled={templateCountRange(form.mode, key).min === templateCountRange(form.mode, key).max}
                    value={form.requirements[key]}
                    onChange={(e) =>
                      change("requirements", {
                        ...form.requirements,
                        [key]: Math.min(templateCountRange(form.mode, key).max, Math.max(templateCountRange(form.mode, key).min, Math.trunc(Number(e.target.value) || 0))),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </FormCard>
          <FormCard
            title="素材用途名称"
          >
            <p>前台将直接显示这些名称，例如「人物照片」「服装图片」。留空时使用素材编号。</p>
            <FormGrid>
              {(["images", "videos", "audio"] as const).flatMap((kind, kindIndex) =>
                Array.from({ length: Math.min(kind === "images" ? 4 : 3, Math.max(0, form.requirements[kind] || (form.mode === "ref" && !Object.values(form.requirements).some(Boolean) ? 1 : 0))) }, (_, index) =>
                  <Field key={`${kind}-${index}`} label={`${["图片", "视频", "音频"][kindIndex]}${index + 1}用途`}>
                    <input maxLength={40} value={form.inputLabels?.[kind]?.[index] || ""} placeholder={kind === "images" ? "例如 人物照片、服装图片" : "例如 动作参考、背景音频"} onChange={e => {
                      const labels = [...(form.inputLabels?.[kind] || [])]; labels[index] = e.target.value;
                      change("inputLabels", { ...form.inputLabels, [kind]: labels });
                    }} />
                  </Field>,
                ),
              )}
            </FormGrid>
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
                          "如 16:9，留空使用模型默认值",
                          "如 1080p / 2K",
                          "如 high，留空使用模型默认值",
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
                <Field label="视频时长（秒，0 使用模型默认值）">
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
                    { value: "1", label: "上架到灵感和模板" },
                  ]}
                  onChange={(v) => change("status", Number(v))}
                />
              </Field>
            </FormGrid>
            <button type="button" className="adm-btn ghost" onClick={() => void check()}>{checking ? "正在检查…" : "检查生成配置"}</button>
            <p className={css.note}>检查不生成、不扣积分。上架时也会校验模型、素材要求和输出参数；实际效果请先在创作台试做。</p>
            {currentCheck && <div ref={checkElement} className={css.checkResult} role="status">
              <strong>配置检查通过</strong>
              <p>{currentCheck.modelName} · {templateOutputText(currentCheck.options)}</p>
              <p>基础费用 {currentCheck.basePointCost} 积分{currentCheck.referenceVideoBilling ? "，参考视频附加费在上传后核算" : ""}</p>
            </div>}
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
          <p>{templateInputs(form)}</p>
          <ul className={css.slotPreview}>{templateUploadSlots(form).map(slot => <li key={slot.key}>{slot.label}{slot.optional ? "（选填，至少一种）" : "（必填）"}</li>)}</ul>
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
      </fieldset>
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
              <p>{row.prompt || "此结果需要运营补充后台私有提示词"}</p>
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
