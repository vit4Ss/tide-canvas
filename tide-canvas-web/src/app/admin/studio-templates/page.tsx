"use client";
/* eslint-disable @next/next/no-img-element -- Operator-selected uploads use dynamic storage URLs and the existing direct-media fallback. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Clapperboard,
  Copy,
  ExternalLink,
  Edit3,
  ImageIcon,
  Layers3,
  Check,
  Minus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { AdminModal, Field, FormCard, FormGrid } from "@/components/admin";
import { TemplateCoverAI } from "@/components/admin/template-cover-ai";
import { TemplateCoverBatchDialog } from "@/components/admin/template-cover-batch";
import { TemplatePromptFillButton } from "@/components/admin/template-prompt-fill";
import { commitAcceptedAiGeneration } from "@/lib/ai-generation-idempotency";
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
  type TemplateCoverFilter,
} from "@/lib/studio-template-api";
import { TemplateMedia } from "@/components/studio/create-studio/template-media";
import { templateInputs } from "@/lib/studio-template";
import {
  copyTemplateDraft,
  templateCountRange,
  templateSpecChoices,
  templateParameterFields,
  templateOptionsForModel,
  templateOptionsForRequest,
  templateVideoPromptOptions,
  withTemplatePromptDefaults,
  templateModelChoiceKey,
} from "@/lib/template-operator";
import {
  templateOutputText,
  templateUploadSlots,
} from "@/lib/template-workshop";
import { resolutionRank } from "@/lib/model-generation-options.mjs";
import css from "./page.module.css";

const modeLabels = {
  t2i: "文生图",
  i2i: "图生图",
  t2v: "文生视频",
  i2v: "图生视频",
  flf: "首尾帧视频",
  ref: "多模态参考视频",
};
const PAGE_SIZE = 18;
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
  const [category, setCategory] = useState("");
  const [order, setOrder] = useState<"sort" | "newest">("newest");
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
  const [batchFilter, setBatchFilter] = useState<TemplateCoverFilter | null>(
    null,
  );
  const [coverStart, setCoverStart] = useState<{
    id: string;
    owner: string;
  } | null>(null);
  const [deleting, setDeleting] = useState("");
  const deleteLock = useRef(false);
  const canImport =
    user?.role === 9 || !!user?.adminPerms?.includes("admin.generations");
  const hasFilters = !!(query.trim() || status || category);
  const categories = [
    ...new Set([...(data?.categories || []), category].filter(Boolean)),
  ];
  const resetFilters = () => {
    setStatus("");
    setCategory("");
    setKeyword("");
    setQuery("");
    setPage(1);
  };
  useEffect(() => {
    const controller = new AbortController();
    let correctingPage = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    api
      .list(
        {
          kind,
          mediaType: media,
          status,
          category,
          order,
          keyword: query,
          pageNum: page,
          pageSize: PAGE_SIZE,
        },
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          const last = Math.max(1, res.data.pages);
          if (page > last) {
            correctingPage = true;
            setPage(last);
          } else setData(res.data);
        } else setError(res.message || "读取模板失败");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("读取失败，请重试");
      })
      .finally(() => {
        if (!controller.signal.aborted && !correctingPage) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, media, status, category, order, query, page, version]);
  const remove = async (row: StudioTemplate) => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    try {
      if (
        !(await confirmDialog({
          title: "删除创作模板",
          message: `确定删除「${row.title}」？已生成的作品不会受影响。`,
          confirmText: "删除",
        }))
      )
        return;
      setDeleting(row.id);
      const res = await api.remove(row.id);
      if (res.success) {
        toast.success("已删除");
        // Refresh the current filter. The list response corrects an out-of-range
        // page; a late delete response must never restore a captured old page.
        setVersion((v) => v + 1);
      } else toast.error(res.message || "删除失败");
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      deleteLock.current = false;
      setDeleting("");
    }
  };
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div>
          <h1>创作模板</h1>
          <p>管理创作配方与展示效果，准备好封面和生成配置后上架。</p>
        </div>
        <div className={css.actions}>
          {media === "video" && (
            <TemplatePromptFillButton
              key={String(user?.id || "")}
              filter={{ kind, mediaType: media, category, status, keyword: query }}
              disabled={loading || !!error}
              onUpdated={() => setVersion((v) => v + 1)}
            />
          )}
          <button
            type="button"
            className="adm-btn ghost"
            onClick={() =>
              setBatchFilter({
                kind,
                mediaType: media,
                category,
                status,
                keyword: query,
              })
            }
          >
            <ImageIcon size={15} />
            批量生成封面
          </button>
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
          aria-pressed={kind === "style"}
          onClick={() => {
            if (kind === "style") return;
            setKind("style");
            setCategory("");
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
          aria-pressed={kind === "inspiration"}
          onClick={() => {
            if (kind === "inspiration") return;
            setKind("inspiration");
            setCategory("");
            setPage(1);
          }}
        >
          <Copy size={22} />
          <span>
            <strong>灵感做同款</strong>
            <small>完整配方，用户上传素材即可生成</small>
          </span>
        </button>
      </div>
      <div className={css.toolbar}>
        <div className={css.mediaTabs} role="group" aria-label="媒体类型筛选">
          <button
            className={media === "image" ? css.active : ""}
            aria-pressed={media === "image"}
            onClick={() => {
              if (media === "image") return;
              setMedia("image");
              setCategory("");
              setPage(1);
            }}
          >
            <ImageIcon size={15} />
            图片
          </button>
          <button
            className={media === "video" ? css.active : ""}
            aria-pressed={media === "video"}
            onClick={() => {
              if (media === "video") return;
              setMedia("video");
              setCategory("");
              setPage(1);
            }}
          >
            <Clapperboard size={15} />
            视频
          </button>
        </div>
        <PopoverSelect
          className={css.filterSelect}
          menuClassName={"admin-body " + css.selectMenu}
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
        <PopoverSelect
          className={css.filterSelect}
          menuClassName={"admin-body " + css.selectMenu}
          label="模板分类"
          value={category}
          disabled={loading || !!error}
          options={[
            { value: "", label: "全部分类" },
            ...categories.map((value) => ({ value, label: value })),
          ]}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(keyword.trim());
            setPage(1);
            setVersion((v) => v + 1);
          }}
        >
          <Search size={15} />
          <input
            value={keyword}
            aria-label="搜索模板"
            placeholder="搜索编号、名称或描述"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button className="adm-btn ghost small">查询</button>
        </form>
      </div>
      <div className={css.resultSummary}>
        <div>
          <strong>{category || "全部分类"}</strong>
          <span>
            {loading
              ? "正在读取…"
              : error
                ? "暂未获取到结果"
                : data?.total
                  ? (page - 1) * PAGE_SIZE +
                    1 +
                    "–" +
                    Math.min(page * PAGE_SIZE, data.total) +
                    " / " +
                    data.total +
                    " 个模板"
                  : "0 个模板"}
          </span>
        </div>
        <div className={css.catalogActions}>
          {hasFilters && (
            <button
              type="button"
              className={css.resetFilters}
              onClick={resetFilters}
            >
              重置筛选
            </button>
          )}
          <PopoverSelect
            className={css.filterSelect + " " + css.sortSelect}
            menuClassName={"admin-body " + css.selectMenu}
            label="模板排序"
            value={order}
            options={[
              { value: "newest", label: "最近添加" },
              { value: "sort", label: "运营排序" },
            ]}
            onChange={(value) => {
              setOrder(value as "sort" | "newest");
              setPage(1);
            }}
          />
          <nav className={css.topPager} aria-label="顶部翻页">
            <TemplatePageControls
              page={page}
              pages={data?.pages || 1}
              disabled={loading || !!error}
              failed={!!error}
              onChange={setPage}
            />
          </nav>
        </div>
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
            {hasFilters
              ? "没有找到匹配的模板"
              : `还没有${media === "image" ? "图片" : "视频"}${kind === "style" ? "风格" : "灵感"}`}
          </h3>
          <p>
            {hasFilters
              ? "可以更换关键词或清除筛选。"
              : "上传预览、填写提示词和素材要求，检查配置后上架。"}
          </p>
          <button
            className="adm-btn"
            onClick={() => {
              if (hasFilters) {
                resetFilters();
              } else setDraft(empty(kind, media));
            }}
          >
            {hasFilters ? "清除筛选" : "创建第一个模板"}
          </button>
        </div>
      ) : (
        <div className={css.grid} data-count={data.records.length}>
          {data.records.map((row) => (
            <article className={css.card} key={row.id}>
              <div
                className={css.cardMedia}
                data-empty={!row.coverUrl || undefined}
              >
                {row.coverUrl ? (
                  <TemplateMedia
                    key={row.coverUrl + row.previewUrl}
                    row={row}
                  />
                ) : (
                  <button
                    type="button"
                    className={css.missingCover}
                    aria-label={"为" + row.title + "制作封面"}
                    onClick={() => {
                      setDraft(row);
                      setCoverStart({ id: row.id, owner: String(user?.id) });
                    }}
                  >
                    <span className={css.coverIcon}>
                      <ImageIcon size={22} />
                    </span>
                    <span>
                      <strong>添加封面</strong>
                      <small>
                        {row.previewUrl
                          ? "已添加视频预览，还需补充封面"
                          : "打开封面制作工具，保存后再上架"}
                      </small>
                    </span>
                    <Plus size={16} />
                  </button>
                )}
              </div>
              <div className={css.cardBody}>
                <div className={css.cardLabels}>
                  <span
                    className={css.categoryLabel}
                    title={row.category || "未分类"}
                  >
                    {row.category || "未分类"}
                  </span>
                  <span className={row.status === 1 ? css.live : css.draft}>
                    {row.status === 1 ? "已上架" : "未上架"}
                  </span>
                </div>
                <h3 title={row.title}>{row.title}</h3>
                {row.description && (
                  <p className={css.cardDescription}>{row.description}</p>
                )}
                <div className={css.specs}>
                  <span>{modeLabels[row.mode]}</span>
                  {!!row.options.duration && (
                    <span>{row.options.duration} 秒</span>
                  )}
                  {row.options.aspectRatio && (
                    <span>{row.options.aspectRatio}</span>
                  )}
                </div>
                <p className={css.materialSummary}>{templateInputs(row)}</p>
                <footer>
                  {row.status !== 1 && (
                    <p className={css.nextStep}>
                      {!row.coverUrl
                        ? "下一步：补充展示封面"
                        : !row.prompt.trim()
                          ? "下一步：完善生成配方"
                          : "下一步：检查配置并上架"}
                    </p>
                  )}
                  <small>
                    排序 {row.sortOrder} · 使用 {row.uses} 次
                  </small>
                  <div className={css.cardActions}>
                    <button
                      className={"adm-btn ghost small " + css.editAction}
                      aria-label={`编辑${row.title}`}
                      onClick={() => setDraft(row)}
                    >
                      <Edit3 size={14} />
                      编辑
                    </button>
                    <button
                      className="adm-btn ghost small"
                      aria-label={`复制${row.title}`}
                      onClick={() => setDraft(copyTemplateDraft(row))}
                    >
                      <Copy size={14} />
                      复制
                    </button>
                    {row.status === 1 && (
                      <a
                        className="adm-btn ghost small"
                        href={`/templates/${row.id}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看${row.title}用户页面`}
                      >
                        <ExternalLink size={14} />
                        用户页
                      </a>
                    )}
                    <button
                      className="adm-btn ghost small"
                      disabled={!!deleting}
                      aria-label={`删除${row.title}`}
                      onClick={() => void remove(row)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
      <nav className={css.pager} aria-label="模板分页">
        <span>
          {loading
            ? "正在加载…"
            : error
              ? "列表加载失败"
              : `共 ${data?.total ?? 0} 个模板`}
        </span>
        <TemplatePageControls
          page={page}
          pages={data?.pages || 1}
          disabled={loading || !!error}
          failed={!!error}
          onChange={setPage}
        />
      </nav>
      {batchFilter && (
        <TemplateCoverBatchDialog
          filter={batchFilter}
          onClose={() => setBatchFilter(null)}
          onUpdated={() => setVersion((v) => v + 1)}
        />
      )}
      {draft && (
        <TemplateEditor
          key={`${user?.id || "guest"}:${draft.id || "new"}`}
          initial={draft}
          initialCoverOpen={
            coverStart?.id === draft.id &&
            coverStart?.owner === String(user?.id)
          }
          onClose={() => {
            setDraft(null);
            setCoverStart(null);
          }}
          onDraftSaved={(row) => {
            setCoverStart({ id: row.id, owner: String(user?.id) });
            setDraft(row);
            setKind(row.kind);
            setMedia(row.mediaType);
            setStatus("");
            setCategory("");
            setKeyword("");
            setQuery("");
            setPage(1);
            setVersion((v) => v + 1);
          }}
          onSaved={(row) => {
            setDraft(null);
            setCoverStart(null);
            setKind(row.kind);
            setMedia(row.mediaType);
            setStatus("");
            setCategory("");
            setKeyword("");
            setQuery("");
            setPage(1);
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
            setCategory("");
            setMedia(row.mediaType);
            setPage(1);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function TemplatePageControls({
  page,
  pages,
  disabled,
  failed,
  onChange,
}: {
  page: number;
  pages: number;
  disabled: boolean;
  failed: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className={css.pageControls}>
      <button
        type="button"
        className="adm-btn ghost small"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </button>
      <span aria-label="当前页">
        {failed ? "—" : page + " / " + Math.max(1, pages)}
      </span>
      <button
        type="button"
        className="adm-btn ghost small"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}

function TemplateEditor({
  initial,
  initialCoverOpen,
  onClose,
  onSaved,
  onDraftSaved,
}: {
  initial: StudioTemplateSave & { id?: string };
  initialCoverOpen: boolean;
  onClose: () => void;
  onSaved: (row: StudioTemplate) => void;
  onDraftSaved: (row: StudioTemplate) => void;
}) {
  const [form, setForm] = useState(() => withTemplatePromptDefaults(initial));
  const [promptDefaultError, setPromptDefaultError] = useState("");
  const [fillingPromptModel, setFillingPromptModel] = useState(false);
  const autoModelKey = useRef("");
  const manualModelChoice = useRef(false);
  const manualPromptSpecs = useRef({
    duration: !!initial.options.duration,
    aspectRatio: !!initial.options.aspectRatio?.trim(),
  });
  const [models, setModels] = useState<StudioModelVO[]>([]);
  const [uploading, setUploading] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingPromptDefaults, setSavingPromptDefaults] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [coverOpen, setCoverOpen] = useState(initialCoverOpen);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverMessage, setCoverMessage] = useState("");
  const [filledCoverUrl, setFilledCoverUrl] = useState("");
  const coverBlocking = coverOpen && coverBusy;
  const coverNeedsSave =
    !!filledCoverUrl &&
    form.coverUrl === filledCoverUrl &&
    form.coverUrl !== initial.coverUrl;
  const coverTask = useRef<{ id: string; owner: string; url: string } | null>(
    null,
  );
  const coverScope = initial.id ? `admin:template-cover:${initial.id}` : "";
  const [checked, setChecked] = useState<{
    signature: string;
    data: TemplateSetup;
  }>();
  const [modelError, setModelError] = useState("");
  const [modelRetry, setModelRetry] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(true);
  const modelRequestPending = useRef(false);
  const busy = useRef(false);
  const onCoverBusy = useCallback((value: boolean) => {
    setCoverBusy(value);
  }, []);
  const closing = useRef(false);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const checkElement = useRef<HTMLDivElement>(null);
  const saved = useRef(false);
  const signature = JSON.stringify(form);
  const dirty = signature !== JSON.stringify(initial);
  const currentCheck =
    checked?.signature === signature ? checked.data : undefined;
  const selectedModel = models.find(
    (model) =>
      model.type === form.mediaType &&
      (model.modelKey === form.modelKey || model.id === form.modelKey),
  );
  const requirementKinds = (["images", "videos", "audio"] as const).filter(
    (kind) => templateCountRange(form.mode, kind).max > 0,
  );
  const parameterFields = selectedModel
    ? templateParameterFields(form.mediaType, selectedModel.config)
    : [];
  const requestForm = (resolveDefaults = true) => {
    if (!selectedModel) return form;
    const options = resolveDefaults ? templateOptionsForRequest(
      form.options,
      form.mediaType,
      selectedModel.config,
    ) : form.options;
    const modelKey = form.modelKey === selectedModel.id
      ? selectedModel.id : templateModelChoiceKey(selectedModel, models);
    return { ...form, modelKey, options };
  };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (error) {
      errorElement.current?.scrollIntoView({ block: "nearest" });
      errorElement.current?.focus({ preventScroll: true });
    }
  }, [error]);
  useEffect(() => {
    if (checked) checkElement.current?.scrollIntoView({ block: "nearest" });
  }, [checked]);
  useEffect(() => {
    let current = true;
    let sequence = 0;
    const loadModels = async () => {
      if (busy.current) return;
      const request = ++sequence;
      modelRequestPending.current = true;
      setModelsLoading(true);
      setModelError("");
      setChecked(undefined);
      try {
        const result = await marketApi.studioModels(form.mediaType);
        if (!current || request !== sequence) return;
        if (result.success && Array.isArray(result.data)) {
          setModels(
            result.data.filter((model) => model.type === form.mediaType),
          );
        } else setModelError(result.message || "模型列表读取失败，请重试");
      } catch {
        if (current && request === sequence)
          setModelError("模型列表读取失败，请重试");
      } finally {
        if (current && request === sequence) {
          modelRequestPending.current = false;
          setModelsLoading(false);
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadModels();
    };
    // Match Studio's live catalog refresh without rewriting the selected model key.
    void loadModels();
    window.addEventListener("focus", loadModels);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      current = false;
      modelRequestPending.current = false;
      window.removeEventListener("focus", loadModels);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [form.mediaType, modelRetry]);
  useEffect(() => {
    if (
      form.mediaType !== "video" || form.modelKey || manualModelChoice.current ||
      templateVideoPromptOptions(form.prompt).duration !== 30 ||
      form.options.duration !== 30 || modelsLoading || modelError || busy.current
    ) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setFillingPromptModel(true);
      setPromptDefaultError("");
      try {
        // Reuse the server's free validator, including reference/price checks,
        // rather than choosing a similarly named but incompatible model here.
        const result = await api.check({ ...form, title: form.title.trim() || "视频模板", status: 0 }, true);
        if (cancelled || !alive.current || busy.current) return;
        if (result.success && result.data) {
          const setup = result.data;
          autoModelKey.current = setup.modelId;
          setForm((old) => JSON.stringify(old) === signature
            ? { ...old, modelKey: setup.modelId, options: setup.options }
            : old);
        } else setPromptDefaultError(result.message || "未能匹配 Seedance 2.5，请检查模型配置或手动选择。");
      } catch {
        if (!cancelled) setPromptDefaultError("默认模型读取失败，可点击刷新模型列表重试。");
      } finally {
        if (!cancelled) setFillingPromptModel(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setFillingPromptModel(false);
    };
  }, [form, signature, models, modelsLoading, modelError]);
  const close = async () => {
    if (busy.current || coverBlocking || closing.current) return;
    closing.current = true;
    try {
      if (
        !saved.current &&
        dirty &&
        !(await confirmDialog({
          title: "放弃未保存的修改？",
          message: "关闭后，本次修改将丢失。可以先取消并保存草稿。",
          confirmText: "放弃修改",
        }))
      )
        return;
      onClose();
    } finally {
      closing.current = false;
    }
  };
  const check = async () => {
    if (
      busy.current ||
      coverBlocking ||
      modelsLoading ||
      modelRequestPending.current
    )
      return;
    if (form.modelKey && (modelError || !selectedModel)) {
      setError("请先重新读取模型列表，确认所选模型可用后再检查配置。");
      return;
    }
    busy.current = true;
    setChecking(true);
    setError("");
    setChecked(undefined);
    try {
      const res = await api.check(requestForm());
      if (!alive.current) return;
      if (res.success && res.data) {
        if (!form.modelKey) {
          const resolved = {
            ...form,
            modelKey: res.data.modelId,
            options: res.data.options,
          };
          setForm(resolved);
          setChecked({ signature: JSON.stringify(resolved), data: res.data });
        } else setChecked({ signature, data: res.data });
      } else setError(res.message || "配置检查失败，请重试");
    } catch {
      if (alive.current) setError("配置检查失败，请重试");
    } finally {
      busy.current = false;
      if (alive.current) setChecking(false);
    }
  };
  const change = <K extends keyof StudioTemplateSave>(
    key: K,
    value: StudioTemplateSave[K],
  ) => {
    setError("");
    setPromptDefaultError("");
    setForm((v) => {
      const next = { ...v, [key]: value };
      if (key !== "prompt" || next.mediaType !== "video") return next;
      const before = templateVideoPromptOptions(v.prompt);
      const after = templateVideoPromptOptions(next.prompt);
      const options = { ...v.options };
      if (!manualPromptSpecs.current.duration && before.duration && options.duration === before.duration) options.duration = after.duration;
      if (!manualPromptSpecs.current.aspectRatio && before.aspectRatio && options.aspectRatio === before.aspectRatio) options.aspectRatio = after.aspectRatio;
      if (v.modelKey === autoModelKey.current && before.duration !== after.duration) next.modelKey = "";
      return withTemplatePromptDefaults({ ...next, options });
    });
  };
  const applyCover = useCallback((url: string, id: string, owner: string) => {
    if (
      !alive.current ||
      String(useAuthStore.getState().user?.id || "") !== owner
    )
      return;
    coverTask.current = { id, owner, url };
    setForm((value) => ({ ...value, coverUrl: url }));
    setFilledCoverUrl(url);
    setError("");
  }, []);
  const upload = async (
    file: File | undefined,
    key: "coverUrl" | "previewUrl",
  ) => {
    if (!file || busy.current || coverBlocking) return;
    if (file.size > 50 * 1024 * 1024) {
      setError("预览文件不能超过 50 MB，请压缩后上传");
      return;
    }
    if (
      !(
        key === "coverUrl"
          ? /^image\/(png|jpeg|webp|gif)$/
          : /^video\/(mp4|webm|quicktime)$/
      ).test(file.type)
    ) {
      setError(
        key === "coverUrl"
          ? "封面请选择 PNG、JPG、WebP 或 GIF 图片"
          : "预览请选择 MP4、WebM 或 MOV 视频",
      );
      return;
    }
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
  const openCover = async () => {
    if (busy.current || modelsLoading || modelRequestPending.current) return;
    if (initial.id) {
      setCoverOpen(true);
      return;
    }
    // Give each new template a durable identity before starting a paid cover
    // task. Otherwise all unsaved templates share the same recovery journal.
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const res = await api.save({ ...requestForm(), status: 0 });
      if (!alive.current) return;
      if (res.success && res.data?.id) {
        saved.current = true;
        onDraftSaved(res.data);
      } else
        setError(
          res.message ||
            "草稿未能保存，尚未开始封面生成。请确认列表中的保存状态后重试。",
        );
    } catch {
      if (alive.current)
        setError(
          "暂时无法确认草稿保存状态，请先检查模板列表；封面任务尚未开始。",
        );
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const save = async (fillFromPrompt = false, publish = false) => {
    if (
      busy.current ||
      coverBlocking ||
      modelsLoading ||
      modelRequestPending.current
    )
      return false;
    if ((form.status === 1 || publish) && form.modelKey && (modelError || !selectedModel)) {
      setError("请先重新读取模型列表，确认所选模型可用后再上架。");
      return false;
    }
    busy.current = true;
    setSaving(true);
    setSavingPromptDefaults(fillFromPrompt);
    setError("");
    const appliedTask =
      coverTask.current?.url === form.coverUrl ? coverTask.current : null;
    try {
      const payload = requestForm(!fillFromPrompt);
      const res = await api.save(publish ? { ...payload, status: 1 } : payload, form.id, initial.coverUrl, fillFromPrompt, initial.status);
      if (!alive.current) return false;
      if (res.success && res.data) {
        saved.current = true;
        if (appliedTask && res.data.coverUrl === appliedTask.url)
          void commitAcceptedAiGeneration(
            coverScope,
            appliedTask.id,
            appliedTask.owner,
          ).catch(() => undefined);
        toast.success(fillFromPrompt ? res.data.status === 1 ? "模板已填充并上架" : "模板参数已填充并保存" : form.status ? "模板已上架" : "草稿已保存");
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
      if (alive.current) {
        setSaving(false);
        setSavingPromptDefaults(false);
      }
    }
  };
  const modes = (
    form.mediaType === "image" ? ["t2i", "i2i"] : ["t2v", "i2v", "flf", "ref"]
  ) as StudioTemplate["mode"][];
  const selectProps = {
    className: css.selectControl,
    menuClassName: `admin-body ${css.selectMenu}`,
  };
  return (
    <AdminModal
      open
      size="xl"
      title={initial.id ? "编辑创作模板" : "新建创作模板"}
      subtitle={
        form.kind === "style"
          ? "配置完整视觉配方，用户上传素材即可生成，提示词仅后台可见。"
          : "维护模板介绍、封面与生成配方，用户无需填写提示词。"
      }
      onClose={() => void close()}
      closeable={!saving && !uploading && !checking && !coverBlocking}
      showCancel={!saving && !uploading && !checking && !coverBlocking}
      onSave={save}
      saveDisabled={
        !!uploading ||
        saving ||
        checking ||
        coverBlocking ||
        modelsLoading ||
        (form.status === 1 &&
          !!form.modelKey &&
          (!!modelError || !selectedModel))
      }
      saveLabel={form.status === 1 ? "保存并上架" : "保存草稿"}
      footNote={
        coverNeedsSave
          ? "AI 封面已填入，尚未保存。请点击右侧保存按钮。"
          : "上架后展示在「灵感和模板」；用户只上传素材，提示词不会公开。"
      }
    >
      {error && (
        <p ref={errorElement} tabIndex={-1} className={css.error} role="alert">
          {error}
        </p>
      )}
      <fieldset
        className={css.editor}
        disabled={saving || checking || !!uploading || coverBlocking}
      >
        <div>
          <FormCard title="展示信息">
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
                  {...selectProps}
                  value={form.mediaType}
                  label="媒体类型"
                  options={[
                    { value: "image", label: "图片" },
                    { value: "video", label: "视频" },
                  ]}
                  onChange={(v) => {
                    setError("");
                    setPromptDefaultError("");
                    manualModelChoice.current = false;
                    autoModelKey.current = "";
                    manualPromptSpecs.current = { duration: false, aspectRatio: false };
                    setForm((old) => withTemplatePromptDefaults({
                      ...old,
                      mediaType: v as "image" | "video",
                      mode: v === "image" ? "i2i" : "i2v",
                      requirements: { images: 1, videos: 0, audio: 0 },
                      inputLabels: {},
                      modelKey: "",
                      options: {},
                    }));
                  }}
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
          <FormCard title="提示词与素材">
            <Field
              label="完整提示词"
              required={form.status === 1}
              hint={form.mediaType === "video"
                ? "仅管理员可见。开头如【生成视频：30秒｜9:16】会自动填入时长和画面比例；30秒默认匹配 Seedance 2.5。"
                : "仅管理员可见，生成时自动使用。"}
            >
              <textarea
                className={css.promptInput}
                rows={5}
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
            {form.mediaType === "video" && (
              <>
                <div className={css.actions}>
                  <button
                    type="button"
                    className="adm-btn ghost"
                    disabled={saving || checking || !!uploading || coverBlocking || modelsLoading}
                    onClick={() => void save(true, true)}
                  >
                    {savingPromptDefaults ? "正在填充并上架…" : "自动填充并上架"}
                  </button>
                </div>
                <p className={css.note}>补齐模型与参数后上架；清晰度未设置或为480p时更新为720p，其他已设清晰度保留。失败不修改原内容，不生成、不扣积分。</p>
              </>
            )}
            <Field label="用户需要上传什么">
              <textarea
                rows={2}
                maxLength={1024}
                value={form.inputHint}
                placeholder="例如：图片1上传人物，图片2上传衣服；无需上传示例成品。"
                onChange={(e) => change("inputHint", e.target.value)}
              />
            </Field>
            <Field label="创作模式">
              <PopoverSelect
                {...selectProps}
                label="创作模式"
                value={form.mode}
                options={modes.map((value) => ({
                  value,
                  label: modeLabels[value],
                }))}
                onChange={(v) => {
                  setError("");
                  setPromptDefaultError("");
                  setForm((old) => ({
                    ...old,
                    mode: v as StudioTemplate["mode"],
                    modelKey: old.modelKey === autoModelKey.current ? "" : old.modelKey,
                    inputLabels: {},
                    requirements: {
                      images:
                        v === "t2i" || v === "t2v" ? 0 : v === "flf" ? 2 : 1,
                      videos: 0,
                      audio: 0,
                    },
                  }));
                }}
              />
            </Field>
            {requirementKinds.length ? (
              <div
                className={css.requirements}
                data-count={requirementKinds.length}
                role="group"
                aria-label="参考素材数量"
              >
                {requirementKinds.map((key) => {
                  const range = templateCountRange(form.mode, key);
                  const label = {
                    images: "参考图片",
                    videos: "参考视频",
                    audio: "参考音频",
                  }[key];
                  const unit = key === "images" ? "张" : "段";
                  const update = (value: number) => {
                    const count = Math.min(
                      range.max,
                      Math.max(range.min, Math.trunc(value) || 0),
                    );
                    change("requirements", {
                      ...form.requirements,
                      [key]: count,
                      ...(key === "images"
                        ? {
                            optionalImages: (
                              form.requirements.optionalImages || []
                            )
                              .filter((position) => position <= count)
                              .slice(0, Math.max(0, count - 1)),
                          }
                        : {}),
                    });
                  };
                  return (
                    <div className={css.requirementRow} key={key}>
                      <div>
                        <strong>{label}</strong>
                        <small>
                          {range.min === range.max
                            ? `固定 ${range.min} ${unit}`
                            : `${range.min}–${range.max} ${unit}`}
                        </small>
                      </div>
                      {range.min === range.max ? (
                        <span className={css.fixedCount}>
                          {range.min} {unit}
                        </span>
                      ) : (
                        <div className={css.stepper}>
                          <button
                            type="button"
                            aria-label={`减少${label}`}
                            disabled={form.requirements[key] <= range.min}
                            onClick={() => update(form.requirements[key] - 1)}
                          >
                            <Minus size={14} />
                          </button>
                          <input
                            aria-label={`${label}数量`}
                            type="number"
                            min={range.min}
                            max={range.max}
                            step={1}
                            value={form.requirements[key]}
                            onChange={(event) =>
                              update(Number(event.target.value))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`增加${label}`}
                            disabled={form.requirements[key] >= range.max}
                            onClick={() => update(form.requirements[key] + 1)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={css.note}>此模式不需要上传参考素材。</p>
            )}
            {form.mode === "ref" &&
              !(
                form.requirements.images +
                form.requirements.videos +
                form.requirements.audio
              ) && (
                <p className={css.note}>
                  数量均为 0 时，用户可按需选择参考素材。
                </p>
              )}
          </FormCard>
          {requirementKinds.length > 0 && (
            <FormCard title="素材用途名称">
              <p>
                这些名称用于前台上传位置的标签，例如「人物照片」「服装图片」。留空时使用素材编号，具体创作要求请在完整提示词中说明。
              </p>
              <p className={css.note}>
                {form.requirements.optionalImages?.length
                  ? "本模板有可选图片。提示词请使用固定位置占位符，缺图时由系统自动调整真实图号，避免把产品图误当头像。"
                  : form.mode === "flf"
                    ? "图片1是首帧，图片2是尾帧。请在「完整提示词」中描述从首帧到尾帧的动作与画面过渡。"
                    : form.mode === "i2v"
                      ? "图片1会作为视频首帧。请在「完整提示词」中描述人物动作、镜头运动等，生成时使用用户上传的图片作为首帧。"
                      : form.mode === "i2i" && form.requirements.images === 1
                        ? "只有一张参考图时，可写「保留图片1中的人物，将背景改为……」，也可写「以上传的人物照片为参考……」，不强制使用编号。"
                        : "涉及多份素材时，建议在「完整提示词」中按下方顺序写清图片1、图片2（或视频1、音频1）分别做什么。例如：用图片2的服装替换图片1人物的服装，保持人物和背景不变。"}
                {form.mode === "ref" &&
                  " 图片、视频、音频各自从1开始编号；可选素材没有上传时，不要在提示词中要求使用它。"}
              </p>
              <p className={css.note}>
                普通「图片1」描述不会自动改写。有可选图片时，在提示词里用{" "}
                {"{{image:1}}"}、{"{{image:2}}"}{" "}
                等对应固定上传位置；系统会按实际上传顺序换成图号，缺图时明确标记未上传。用途名称、上传说明和提示词应保持一致。
              </p>
              <FormGrid>
                {(["images", "videos", "audio"] as const).flatMap(
                  (kind, kindIndex) =>
                    Array.from(
                      {
                        length: Math.min(
                          kind === "images" ? 16 : 3,
                          Math.max(
                            0,
                            form.requirements[kind] ||
                              (form.mode === "ref" &&
                              !(
                                form.requirements.images +
                                form.requirements.videos +
                                form.requirements.audio
                              )
                                ? 1
                                : 0),
                          ),
                        ),
                      },
                      (_, index) => (
                        <Field
                          key={`${kind}-${index}`}
                          label={`${["图片", "视频", "音频"][kindIndex]}${index + 1}用途`}
                          hint={
                            kind === "images" &&
                            !!form.requirements.optionalImages?.length
                              ? `固定图片位置${index + 1}；提示词使用 {{image:${index + 1}}}，系统按实际上传顺序绑定。`
                              : form.mode === "flf" && kind === "images"
                                ? `对应用户上传的${index === 0 ? "首帧" : "尾帧"}图片。`
                                : `对应用户上传的第${index + 1}${["张图片", "段视频", "段音频"][kindIndex]}，提示词可按「${["图片", "视频", "音频"][kindIndex]}${index + 1}」描述其用途。`
                          }
                        >
                          <input
                            maxLength={40}
                            value={form.inputLabels?.[kind]?.[index] || ""}
                            placeholder={
                              kind === "images"
                                ? "例如 人物照片、服装图片"
                                : "例如 动作参考、背景音频"
                            }
                            onChange={(e) => {
                              const labels = [
                                ...(form.inputLabels?.[kind] || []),
                              ];
                              labels[index] = e.target.value;
                              change("inputLabels", {
                                ...form.inputLabels,
                                [kind]: labels,
                              });
                            }}
                          />
                        </Field>
                      ),
                    ),
                )}
              </FormGrid>
              {(form.mode === "ref" || form.mode === "i2i") &&
                form.requirements.images > 1 && (
                  <div
                    className={css.optionalRoles}
                    role="group"
                    aria-label="可选图片位置"
                  >
                    <strong>允许用户不上传的图片</strong>
                    <p className={css.note}>
                      至少保留一个必填位置。可选图片的提示词应包含未上传时的处理方式。
                    </p>
                    {templateUploadSlots(form)
                      .filter((slot) => slot.kind === "image")
                      .map((slot, index) => {
                        const positions =
                          form.requirements.optionalImages || [];
                        const optional = positions.includes(index + 1);
                        return (
                          <label key={slot.key}>
                            <input
                              type="checkbox"
                              checked={optional}
                              disabled={
                                !optional &&
                                positions.length >= form.requirements.images - 1
                              }
                              onChange={(event) =>
                                change("requirements", {
                                  ...form.requirements,
                                  optionalImages: event.target.checked
                                    ? [...positions, index + 1].sort(
                                        (a, b) => a - b,
                                      )
                                    : positions.filter((n) => n !== index + 1),
                                })
                              }
                            />
                            允许不上传图片{index + 1} · {slot.label}
                          </label>
                        );
                      })}
                  </div>
                )}
            </FormCard>
          )}
          <FormCard title="输出规格与发布">
            <Field
              label="默认生成模型"
              hint={
                form.modelKey
                  ? "用户使用此模板时按所选模型生成，积分按该模型计费。切换模型后请重新检查输出规格。"
                  : "未指定时，上架会自动选择兼容模型并保存，用户之后使用该模型生成。"
              }
              error={
                form.modelKey && !modelsLoading && !modelError && !selectedModel
                  ? "原模型不在可用列表，请重新选择并检查配置。"
                  : undefined
              }
            >
              <PopoverSelect
                {...selectProps}
                label="默认生成模型"
                disabled={modelsLoading || !!modelError}
                value={selectedModel ? templateModelChoiceKey(selectedModel, models) : form.modelKey}
                options={[
                  { value: "", label: "自动选择兼容模型（上架时确定）" },
                  ...models.map((m) => ({
                    value: templateModelChoiceKey(m, models),
                    label: m.name,
                  })),
                  ...(form.modelKey && !selectedModel
                    ? [
                        {
                          value: form.modelKey,
                          label: `${form.modelKey}（不在当前可用列表）`,
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                onChange={(v) => {
                  setError("");
                  setPromptDefaultError("");
                  manualModelChoice.current = true;
                  autoModelKey.current = "";
                  const chosen = models.find((m) => templateModelChoiceKey(m, models) === v);
                  setForm((old) => ({
                    ...old,
                    modelKey: v,
                    options: chosen
                      ? templateOptionsForModel(
                          old.options,
                          old.mediaType,
                          chosen.config,
                        )
                      : old.options,
                  }));
                }}
              />
            </Field>
            {fillingPromptModel && <p className={css.note} role="status">正在匹配支持30秒的 Seedance 2.5…</p>}
            {promptDefaultError && !form.modelKey && <p className={css.error} role="alert">{promptDefaultError}</p>}
            <div className={css.actions}>
              <button
                type="button"
                className="adm-btn ghost small"
                disabled={modelsLoading}
                onClick={() => setModelRetry((v) => v + 1)}
              >
                {modelsLoading ? "正在读取模型…" : "刷新模型列表"}
              </button>
              <span className={css.note}>
                名称与创作台一致，使用模型管理中维护的名称。
              </span>
            </div>
            {modelError && (
              <p role="alert">
                {modelError}{" "}
                <button
                  type="button"
                  className="adm-btn ghost small"
                  onClick={() => setModelRetry((v) => v + 1)}
                >
                  重试读取模型
                </button>
              </p>
            )}
            {!selectedModel && !modelsLoading && !modelError && (
              <p className={css.note}>
                先选择默认生成模型，再配置对应参数；自动模式可点击「检查生成配置」确定模型。
              </p>
            )}
            {selectedModel && !parameterFields.length && (
              <p className={css.note}>此模型未提供可选的输出参数。</p>
            )}
            {selectedModel &&
              form.mediaType === "video" &&
              !!form.options.duration &&
              !parameterFields.some((field) => field.key === "duration") && (
                <p className={css.error} role="alert">
                  当前模板为 {form.options.duration}{" "}
                  秒，但所选模型未配置可选时长。请更换支持此时长的模型后再上架。
                </p>
              )}
            <FormGrid>
              {parameterFields.map(({ key, label, values, numeric }) => {
                const raw = form.options[key];
                const spec = templateSpecChoices(
                  raw ? String(raw) : "",
                  values,
                );
                const options = spec.options.map((option) => ({
                  ...option,
                  label:
                    !option.value || option.disabled
                      ? option.label
                      : key === "duration"
                        ? `${option.value} 秒`
                        : key === "batchCount"
                          ? `${option.value} 张`
                          : option.value === "auto"
                            ? "自适应"
                            : key === "resolution"
                              ? option.value.toUpperCase()
                              : key === "quality"
                                ? {
                                    low: "低画质",
                                    medium: "标准画质",
                                    high: "高画质",
                                  }[option.value] || option.value
                                : option.label,
                }));
                // Keep the default choice first, sort only explicit supported values like Studio.
                if (key === "resolution" || key === "duration")
                  options.sort((a, b) =>
                    !a.value
                      ? -1
                      : !b.value
                        ? 1
                        : key === "resolution"
                          ? resolutionRank(a.value) - resolutionRank(b.value)
                          : Number(a.value) - Number(b.value),
                  );
                return (
                  <Field
                    key={key}
                    label={label}
                    error={
                      spec.invalid
                        ? key === "duration"
                          ? `原模板为 ${raw} 秒，所选模型不支持。请更换模型；若主动改短时长，请同时调整提示词中的分镜。`
                          : `当前值 ${raw} 不在该模型的配置中，请重新选择。`
                        : undefined
                    }
                  >
                    <PopoverSelect
                      {...selectProps}
                      label={label}
                      value={spec.value}
                      options={options}
                      invalid={spec.invalid}
                      onChange={(value) => {
                        if (key === "duration" || key === "aspectRatio") manualPromptSpecs.current[key] = true;
                        change("options", {
                          ...form.options,
                          [key]: numeric ? Number(value) || undefined : value,
                        });
                      }}
                    />
                  </Field>
                );
              })}
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
                  {...selectProps}
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
            <button
              type="button"
              className="adm-btn ghost"
              disabled={
                modelsLoading ||
                (!!form.modelKey && (!!modelError || !selectedModel))
              }
              onClick={() => void check()}
            >
              {checking ? "正在检查…" : "检查生成配置"}
            </button>
            <p className={css.note}>
              检查不生成、不扣积分。上架时也会校验模型、素材要求和输出参数；实际效果请先在创作台试做。
            </p>
            {currentCheck && (
              <div ref={checkElement} className={css.checkResult} role="status">
                <strong>配置检查通过</strong>
                <p>
                  {currentCheck.modelName} ·{" "}
                  {templateOutputText(currentCheck.options)}
                </p>
                <p>
                  基础费用 {currentCheck.basePointCost} 积分
                  {currentCheck.referenceVideoBilling
                    ? "，参考视频附加费在上传后核算"
                    : ""}
                </p>
              </div>
            )}
          </FormCard>
        </div>
        <aside className={css.preview}>
          <h3>展示与发布</h3>
          <ul className={css.previewChecklist} aria-label="上架准备">
            {[
              {
                name: "展示封面",
                done: !!form.coverUrl.trim(),
                complete: "已填入",
                pending: "待添加",
              },
              {
                name: "生成配方",
                done: !!form.prompt.trim(),
                complete: "已填写",
                pending: "待填写",
              },
              {
                name: "配置检查",
                done: !!currentCheck,
                complete: "已通过",
                pending: "本次未检查",
              },
            ].map((item) => (
              <li key={item.name} data-done={item.done || undefined}>
                <span className={css.checkMark}>
                  {item.done && <Check size={12} />}
                </span>
                <span>{item.name}</span>
                <small>{item.done ? item.complete : item.pending}</small>
              </li>
            ))}
          </ul>
          <div
            className={css.previewArtwork}
            data-empty={!form.coverUrl || undefined}
          >
            <TemplateMedia
              key={form.coverUrl + form.previewUrl}
              row={form}
              controls={form.mediaType === "video"}
            />
          </div>
          <h4>{form.title || "你的模板名称"}</h4>
          <p>
            {form.description ||
              "上传封面或用 AI 生成示意图，让用户了解模板主题。"}
          </p>
          <p>{templateInputs(form)}</p>
          <ul className={css.slotPreview}>
            {templateUploadSlots(form).map((slot) => (
              <li key={slot.key}>
                {slot.label}
                {slot.optional
                  ? form.requirements.images +
                      form.requirements.videos +
                      form.requirements.audio ===
                    0
                    ? "（选填，至少一种）"
                    : "（选填）"
                  : "（必填）"}
              </li>
            ))}
          </ul>
          {(
            [
              "coverUrl",
              ...(form.mediaType === "video" ? ["previewUrl"] : []),
            ] as ("coverUrl" | "previewUrl")[]
          ).map((key) => (
            <div key={key} className={css.upload}>
              <label>
                {key === "coverUrl" ? "封面图片" : "视频成片预览（选填）"}
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
              {key === "coverUrl" && (
                <button
                  type="button"
                  className="adm-btn ghost small"
                  disabled={saving || checking || !!uploading || modelsLoading}
                  aria-expanded={coverOpen}
                  onClick={() => void openCover()}
                >
                  <Sparkles size={14} />
                  {initial.id ? "AI 生成封面" : "保存草稿并制作封面"}
                </button>
              )}
              {key === "coverUrl" && (coverMessage || coverNeedsSave) && (
                <p className={css.note} role="status">
                  {coverMessage || "AI 封面已填入，尚未保存。"}
                </p>
              )}
            </div>
          ))}
          <p className={css.note}>
            封面只用于展示，不会作为用户的参考素材。视频预览可不填；仅有封面时，用户端会标注「封面示意」。
          </p>
        </aside>
      </fieldset>
      {initial.id && (
        <TemplateCoverAI
          scope={coverScope}
          template={form}
          savedCoverUrl={initial.coverUrl}
          open={coverOpen}
          disabled={saving || checking || !!uploading}
          onBusyChange={onCoverBusy}
          onStatusChange={setCoverMessage}
          onClose={() => setCoverOpen(false)}
          onApply={applyCover}
        />
      )}
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
