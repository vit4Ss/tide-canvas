"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Copy,
  LoaderCircle,
  Music2,
  Video,
  Search,
  X,
} from "lucide-react";
import {
  studioTemplateApi,
  type StudioTemplate,
  type StudioTemplatePage,
} from "@/lib/studio-template-api";
import { templateInputs } from "@/lib/studio-template";
import { TemplateMedia } from "./template-media";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/components/shared/toast";
import css from "./template-library.module.css";

export function TemplateLibrary({
  mediaType,
  kind,
  selectedId,
  onApply,
}: {
  mediaType: "image" | "video";
  kind: "style" | "inspiration";
  selectedId?: string;
  onApply: (row: StudioTemplate, rect: DOMRect) => Promise<boolean>;
}) {
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StudioTemplatePage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<StudioTemplate | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyingId, setApplyingId] = useState("");
  const [hovered, setHovered] = useState("");
  const seq = useRef(0);
  const alive = useRef(true);
  const applyingRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(keyword.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [keyword]);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    studioTemplateApi
      .list(
        {
          mediaType,
          kind,
          category,
          keyword: query,
          pageNum: page,
          pageSize: 24,
        },
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted || current !== seq.current) return;
        if (res.success && res.data) {
          const last = Math.max(1, res.data.pages);
          if (page > last) setPage(last);
          else setData(res.data);
        } else setError(res.message || "暂时无法读取模板");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("网络异常，请重试");
      })
      .finally(() => {
        if (!controller.signal.aborted && current === seq.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [mediaType, kind, category, query, page, retry]);
  const apply = async (row: StudioTemplate, el: HTMLElement) => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setApplyingId(row.id);
    try {
      const rect = el.getBoundingClientRect();
      if ((await onApply(row, rect)) && alive.current) setDetail(null);
    } finally {
      applyingRef.current = false;
      if (alive.current) {
        setApplying(false);
        setApplyingId("");
      }
    }
  };
  const isStyle = kind === "style";
  return (
    <div className={css.library}>
      <header className={css.heading}>
        <div>
          <span className={css.eyebrow}>
            {mediaType === "image" ? "IMAGE" : "MOTION"} /{" "}
            {isStyle ? "STYLE COLLECTION" : "REMIX COLLECTION"}
          </span>
          <h2>
            {isStyle ? "让想法，有自己的风格。" : "看见喜欢的，做成自己的。"}
          </h2>
          <p>
            {isStyle
              ? "选一个视觉方向，加入你的主体与素材。"
              : "从一张成品开始，沿用提示词，换上你自己的素材。"}
          </p>
        </div>
        <div className={css.collectionMeta} aria-live="polite">
          <strong>{loading || error ? "—" : (data?.total ?? 0)}</strong>
          <span>{isStyle ? "个可选风格" : "个创作灵感"}</span>
        </div>
      </header>
      <div className={css.workflow} aria-label="使用步骤">
        <span>
          <b>01</b>
          {isStyle ? "选一个方向" : "找到喜欢的成品"}
        </span>
        <i />
        <span>
          <b>02</b>完善输入
        </span>
        <i />
        <span>
          <b>03</b>确认后生成
        </span>
      </div>
      <div className={css.tools}>
        <div className={css.categories} role="group" aria-label="模板分类">
          {["", ...(data?.categories || [])].map((v) => (
            <button
              type="button"
              key={v}
              className={category === v ? css.on : ""}
              aria-pressed={category === v}
              onClick={() => {
                setCategory(v);
                setPage(1);
              }}
            >
              {v || "全部"}
            </button>
          ))}
        </div>
        <label className={css.search}>
          <Search size={15} />
          <input
            aria-label="搜索创作模板"
            placeholder={isStyle ? "寻找风格…" : "寻找灵感…"}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setKeyword("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      {error ? (
        <div className={css.empty} role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>重新加载</button>
        </div>
      ) : loading ? (
        <div
          className={isStyle ? css.styleGrid : css.inspirationGrid}
          aria-label="正在加载模板"
          aria-busy="true"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              className={`${css.skeleton} ${isStyle ? css.styleSkeleton : ""}`}
              key={i}
              aria-hidden="true"
            >
              <div />
              <span />
              <span />
              <footer />
            </div>
          ))}
        </div>
      ) : !data?.records.length ? (
        <div className={css.empty}>
          <ImageIcon size={30} />
          <h3>
            {keyword || category
              ? "没有找到匹配的模板"
              : `还没有上架的${mediaType === "image" ? "图片" : "视频"}${isStyle ? "风格" : "灵感"}`}
          </h3>
          <p>
            {keyword || category
              ? "换个关键词或分类试试。"
              : "你仍可以在左侧上传素材、填写提示词，自由创作。"}
          </p>
          {(keyword || category) && (
            <button
              type="button"
              onClick={() => {
                setKeyword("");
                setQuery("");
                setCategory("");
                setPage(1);
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      ) : (
        <div
          className={`${isStyle ? css.styleGrid : css.inspirationGrid} ${mediaType === "video" ? css.videoGrid : ""}`}
        >
          {data.records.map((row) => (
            <article
              key={row.id}
              className={`${css.card} ${selectedId === row.id ? css.selected : ""}`}
              onMouseEnter={() => setHovered(row.id)}
              onMouseLeave={() => setHovered("")}
            >
              {selectedId === row.id && (
                <span className={css.selectedMarker}>
                  <Check size={12} />
                  已选用
                </span>
              )}
              <button
                type="button"
                className={css.previewButton}
                onClick={() => setDetail(row)}
                aria-label={`查看${row.title}`}
              >
                <TemplateMedia
                  key={row.coverUrl + row.previewUrl}
                  row={row}
                  active={hovered === row.id}
                />
                <div className={css.cardText}>
                  <span>
                    {row.category || (isStyle ? "风格主题" : "创作灵感")}
                  </span>
                  <h3>{row.title}</h3>
                  <p>{row.description || templateInputs(row)}</p>
                </div>
              </button>
              <div className={css.cardFoot}>
                <small
                  title={
                    isStyle ? templateInputs(row) : row.authorName || "精选灵感"
                  }
                >
                  {isStyle ? (
                    <>
                      {row.mediaType === "video" ? (
                        <Video size={13} />
                      ) : (
                        <ImageIcon size={13} />
                      )}
                      <span>{templateInputs(row)}</span>
                    </>
                  ) : (
                    <>
                      <span className={css.authorMark} aria-hidden="true">
                        {(row.authorName || "精选").slice(0, 1)}
                      </span>
                      <span>{row.authorName || "精选灵感"}</span>
                    </>
                  )}
                </small>
                <button
                  type="button"
                  disabled={applying}
                  aria-pressed={selectedId === row.id}
                  title={`${isStyle ? "应用风格" : "做同款"}：${row.title}`}
                  onClick={(e) =>
                    void apply(row, e.currentTarget.closest("article")!)
                  }
                >
                  {applyingId === row.id ? (
                    <>
                      <LoaderCircle className={css.spinner} size={14} />
                      应用中
                    </>
                  ) : selectedId === row.id ? (
                    <>
                      <Check size={14} />
                      已选
                    </>
                  ) : (
                    <>
                      {isStyle ? "使用风格" : "做同款"}
                      <ArrowUpRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {(data?.pages ?? 0) > 1 && (
        <footer className={css.pagination}>
          <button
            disabled={loading || page <= 1}
            onClick={() => setPage((v) => v - 1)}
            aria-label="上一页"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {page} / {data?.pages}
          </span>
          <button
            disabled={loading || page >= (data?.pages || 0)}
            onClick={() => setPage((v) => v + 1)}
            aria-label="下一页"
          >
            <ChevronRight size={16} />
          </button>
        </footer>
      )}
      {detail &&
        createPortal(
          <TemplateDetail
            row={detail}
            busy={applying}
            onClose={() => {
              if (!applying) setDetail(null);
            }}
            onApply={(el) => void apply(detail, el)}
          />,
          document.body,
        )}
    </div>
  );
}

function TemplateDetail({
  row,
  busy,
  onClose,
  onApply,
}: {
  row: StudioTemplate;
  busy: boolean;
  onClose: () => void;
  onApply: (el: HTMLElement) => void;
}) {
  // Applying can open the global replacement confirmation. Let that dialog
  // own keyboard focus instead of two active traps fighting over Tab.
  const trap = useFocusTrap<HTMLDivElement>(!busy);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div
      className={css.mask}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={css.dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="template-title"
        ref={trap}
      >
        <button
          className={css.close}
          disabled={busy}
          onClick={onClose}
          aria-label="关闭模板详情"
        >
          <X size={20} />
        </button>
        <div className={css.detailMedia}>
          <TemplateMedia
            row={row}
            controls={row.mediaType === "video"}
            width={1280}
          />
          <span className={css.previewLabel}>
            {row.mediaType === "video" ? (
              <Video size={13} />
            ) : (
              <ImageIcon size={13} />
            )}
            效果预览
          </span>
        </div>
        <div className={css.detailBody}>
          <div className={css.detailScroll}>
            <span className={css.eyebrow}>
              {row.kind === "style" ? "风格主题" : "灵感做同款"} ·{" "}
              {row.mediaType === "image" ? "图片" : "视频"}
            </span>
            <h2 id="template-title" tabIndex={-1} data-autofocus>
              {row.title}
            </h2>
            <p>{row.description}</p>
            <div className={css.inputGuide}>
              <strong>你需要准备</strong>
              <div className={css.inputChips}>
                {row.requirements.images > 0 && (
                  <span>
                    <ImageIcon size={15} />
                    {row.requirements.images} 张图片
                  </span>
                )}
                {row.requirements.videos > 0 && (
                  <span>
                    <Video size={15} />
                    {row.requirements.videos} 段视频
                  </span>
                )}
                {row.requirements.audio > 0 && (
                  <span>
                    <Music2 size={15} />
                    {row.requirements.audio} 段音频
                  </span>
                )}
                {row.requirements.images +
                  row.requirements.videos +
                  row.requirements.audio ===
                  0 && <span>{templateInputs(row)}</span>}
              </div>
              <p>
                {row.inputHint ||
                  "替换成你自己的主体与素材，生成属于你的作品。"}
              </p>
            </div>
            <div className={css.promptLabel}>
              <div>
                <label htmlFor="template-prompt-preview">创作提示词</label>
                <button
                  type="button"
                  onClick={async () => {
                    if (await copyText(row.prompt)) {
                      setCopied(true);
                    } else toast.error("复制失败，请选择提示词后手动复制");
                  }}
                  aria-label="复制创作提示词"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span aria-live="polite">{copied ? "已复制" : "复制"}</span>
                </button>
              </div>
              <textarea
                id="template-prompt-preview"
                value={row.prompt}
                readOnly
                rows={5}
              />
            </div>
            <p className={css.disclaimer}>
              预览展示创作方向。应用后可调整提示词，实际效果由模型与参考素材决定。
            </p>
          </div>
          <div className={css.detailActions}>
            <button
              className={css.primary}
              disabled={busy}
              onClick={(e) => onApply(e.currentTarget)}
            >
              {busy ? (
                <>
                  <LoaderCircle size={16} className={css.spinner} />
                  正在应用…
                </>
              ) : row.kind === "style" ? (
                "使用这个风格"
              ) : (
                "用我的素材做同款"
              )}
              <ArrowUpRight size={16} />
            </button>
            <small className={css.disclaimer}>
              应用免费 · 点击「立即生成」后按所选模型计费
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
