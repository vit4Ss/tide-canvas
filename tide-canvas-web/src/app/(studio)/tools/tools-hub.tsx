"use client";

/* ============================================================================
   工具中心 — /tools(侧栏「工具」页签)。

   上半部:后台「工具管理」启用且展示独立页的智能工具(GET /api/ai/tools,
   公开),卡片点击进 /tools/<key> 的全屏处理页。接口明确失败时用出厂
   兜底列表(lib/ai-tools-catalog,与 /tools/[op] 同源);接口成功但为空
   (管理员全部下线)则如实显示空态,绝不摆出点进去是死胡同的兜底卡。

   下半部:「工具作品」——当前账号用智能工具处理成功的结果图。数据走
   GET /api/ai/tasks?mediaType=tool(服务端仅按 canonical handler + toolKey
   精确归因；未打标的旧数据不猜测),
   分页在服务端完成。未登录只展示工具卡与登录引导,不发列表请求。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Eraser,
  ExternalLink,
  Loader2,
  Maximize2,
  Paintbrush,
  Play,
  ScanLine,
  Scissors,
  SunMedium,
  Video,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { aiApi } from "@/lib/api";
import { loadToolCoverPool } from "@/lib/tool-cover-pool";
import { useAuth } from "@/hooks/use-auth";
import { coverBg } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import {
  ASSET_LIBRARY_CHANGED_EVENT,
  assetLibraryChangesSince,
  assetLibraryRevision,
} from "@/lib/asset-library-events";
import { fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";
import CapturableVideo from "@/components/studio/create-studio/video-result";
import {
  FALLBACK_TOOLS,
  resolveToolCoverUrl,
  smartToolOriginLabel,
  TOOL_TYPE_LABEL,
  VIDEO_TOOL_HANDLERS,
} from "@/lib/ai-tools-catalog";
import { AiTaskStatus, type AiTaskVO, type AiToolVO } from "@/types/ai";
import styles from "./tools-hub.module.css";

const PAGE_SIZE = 18;

const TOOL_ICONS: Record<string, LucideIcon> = {
  expand: Maximize2,
  inpaint: Paintbrush,
  rmbg: Scissors,
  upscale: ScanLine,
  rmobj: Eraser,
  relight: SunMedium,
  vupscale: Video,
};

function fmtDay(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const day = fmtDay(iso);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function toolResultUrl(task: AiTaskVO): string {
  const direct = task.resultUrl?.trim();
  if (direct) return direct;
  let meta: unknown = task.resultMeta;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta) as unknown;
    } catch {
      return "";
    }
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const urls = (meta as Record<string, unknown>).urls;
  return Array.isArray(urls) && typeof urls[0] === "string" ? urls[0].trim() : "";
}

function LazyToolVideo({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={visible && !failed ? src : undefined}
      preload="metadata"
      muted
      playsInline
      aria-label={label}
      onError={() => setFailed(true)}
    />
  );
}

interface ToolWorkPreviewData {
  url: string;
  isVideo: boolean;
  title: string;
  date: string;
}

function ToolWorkPreview({
  preview,
  onClose,
}: {
  preview: ToolWorkPreviewData | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!preview) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, [preview]);

  if (!preview) return null;
  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="tool-work-preview-title"
      aria-describedby="tool-work-preview-description"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div className={styles.previewShell}>
        <header className={styles.previewHeader}>
          <div className={styles.previewHeading}>
            <span className={styles.previewEyebrow}>工具作品</span>
            <div>
              <h2 id="tool-work-preview-title">{preview.title}</h2>
              <p id="tool-work-preview-description">
                {preview.isVideo ? "视频作品" : "图片作品"}
                {preview.date ? ` · ${preview.date}` : ""}
              </p>
            </div>
          </div>
          <div className={styles.previewHeaderActions}>
            <a href={preview.url} target="_blank" rel="noreferrer">
              原文件
              <ExternalLink aria-hidden />
            </a>
            <button
              type="button"
              className={styles.previewClose}
              aria-label="关闭作品预览"
              autoFocus
              onClick={onClose}
            >
              <X aria-hidden />
            </button>
          </div>
        </header>

        <div className={styles.previewMedia} aria-label="作品内容">
          <div className={styles.previewViewport}>
            {preview.isVideo ? (
              <CapturableVideo key={preview.url} src={preview.url} controls playsInline preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.url}
                src={preview.url}
                alt={preview.title}
                draggable={false}
                onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
                onError={(event) => fallbackOssDisplayImage(event.currentTarget, preview.url)}
              />
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

export default function ToolsHub() {
  const { user, initialized } = useAuth();

  // 等待接口时不渲染兜底，避免慢网下短暂露出管理员已下线的工具。
  const [tools, setTools] = useState<AiToolVO[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "fallback">("loading");
  const [coverPool, setCoverPool] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    aiApi.tools()
      .then((res) => {
        if (!alive) return;
        if (res.success && Array.isArray(res.data)) {
          setTools(res.data);
          setCatalogState("ready");
        } else {
          setCatalogState("fallback");
        }
      })
      .catch(() => {
        if (alive) setCatalogState("fallback");
      });
    loadToolCoverPool().then((covers) => {
      if (alive) setCoverPool(covers);
    });
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(() => {
    const source = catalogState === "loading"
      ? []
      : catalogState === "fallback"
        ? FALLBACK_TOOLS
        : [...tools].sort((a, b) => a.sortOrder - b.sortOrder);
    return source.map((tool) => ({
      ...tool,
      resolvedCoverUrl: resolveToolCoverUrl(tool.key, tool.coverUrl, coverPool),
    }));
  }, [catalogState, tools, coverPool]);

  // 工具作品:works=null 表示尚未加载完;worksError 区分「拉取失败」与「确实没有」。
  const [works, setWorks] = useState<AiTaskVO[] | null>(null);
  const [total, setTotal] = useState(0);
  const [worksError, setWorksError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [workPreview, setWorkPreview] = useState<ToolWorkPreviewData | null>(null);
  const userId = user?.id ?? "";
  // reqId 守卫:切换账号/重试时作废在途请求——否则 A 账号迟到的响应会把
  // 作品列表渲染给刚登录的 B。
  const reqIdRef = useRef(0);
  // 已加载到的页码。不由 works.length 反推:两次请求之间新生成的作品会把
  // DESC 列表整体前移,反推会重复请求同一页。
  const pageRef = useRef(0);
  const worksRevisionRef = useRef(assetLibraryRevision());

  const loadWorks = useCallback(async (pageNum: number) => {
    const id = ++reqIdRef.current;
    const res = await aiApi.listTasks({
      mediaType: "tool",
      assetOnly: true,
      status: AiTaskStatus.SUCCESS,
      pageNum,
      pageSize: PAGE_SIZE,
    });
    if (id !== reqIdRef.current) return; // 过期响应丢弃
    if (res.success && res.data) {
      const records = res.data.records ?? [];
      setTotal(res.data.total ?? records.length);
      setWorksError(false);
      pageRef.current = pageNum;
      setWorks((prev) => {
        if (pageNum === 1 || !prev) return records;
        // 列表前移时下一页开头可能与上一页结尾重叠,按 id 去重再追加,
        // 避免重复卡片与重复 React key。
        const seen = new Set(prev.map((w) => w.id));
        return [...prev, ...records.filter((r) => !seen.has(r.id))];
      });
    } else if (pageNum === 1) {
      // 失败 ≠ 没有作品:空态文案会让用户以为作品被删了,给错误态 + 重试。
      setWorks(null);
      setWorksError(true);
    } else {
      toast.error(res.message || "加载失败，请重试");
    }
  }, []);

  // 账号变化(含首屏水合完成/退出登录)时重置并重拉第一页。作废在途请求要
  // 立即生效;状态重置按仓库惯例推迟到 setTimeout(0),避免 effect 内同步
  // setState 触发级联渲染(react-hooks/set-state-in-effect)。
  useEffect(() => {
    if (!initialized) return;
    reqIdRef.current++;
    pageRef.current = 0;
    const timer = window.setTimeout(() => {
      setWorks(null);
      setWorksError(false);
      setTotal(0);
      setWorkPreview(null);
      if (userId) void loadWorks(1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialized, userId, loadWorks]);

  // 工具处理在独立页面完成时，若本页仍被路由缓存保留，立即刷新工具作品；
  // 若本页重新挂载，账号初始化 effect 会正常拉取第一页。
  useEffect(() => {
    if (!initialized || !userId) return;
    const refreshAfterGeneration = () => {
      const nextRevision = assetLibraryRevision();
      if (nextRevision === worksRevisionRef.current) return;
      const changes = assetLibraryChangesSince(worksRevisionRef.current);
      worksRevisionRef.current = nextRevision;
      if (!changes.some((change) => change.collection === "all" || change.origin === "tool")) return;
      pageRef.current = 0;
      void loadWorks(1);
    };
    refreshAfterGeneration();
    window.addEventListener(ASSET_LIBRARY_CHANGED_EVENT, refreshAfterGeneration);
    return () => window.removeEventListener(ASSET_LIBRARY_CHANGED_EVENT, refreshAfterGeneration);
  }, [initialized, userId, loadWorks]);

  const retry = useCallback(() => {
    setWorksError(false);
    void loadWorks(1);
  }, [loadWorks]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      await loadWorks(pageRef.current + 1);
    } finally {
      setLoadingMore(false);
    }
  }, [loadWorks]);

  const loggedIn = initialized && !!userId;
  const displayWorks = useMemo(
    () => (works ?? [])
      .map((task) => ({ task, resultUrl: toolResultUrl(task) }))
      .filter((item) => item.resultUrl),
    [works],
  );

  return (
    <main className={`insp ${styles.fill}`}>
      <div className={`insp-in ${styles.page}`}>
        <header className={styles.pageHeader}>
          <span className={styles.eyebrow}>AI 工具箱</span>
          <h1>工具</h1>
          <p>上传一份素材，完成扩图、抠图、修复与画质增强。</p>
        </header>

        {/* ── 工具入口 ── */}
        <section className={styles.section} aria-labelledby="tools-directory-title">
          <div className={styles.sectionHead}>
            <div>
              <h2 id="tools-directory-title">选择处理方式</h2>
              <p>每个工具都保留清晰的输入、消耗与结果预览。</p>
            </div>
            {catalogState !== "loading" && cards.length > 0 && (
              <span className={styles.count}>{cards.length} 个工具</span>
            )}
          </div>

          {catalogState === "loading" ? (
            <div className={styles.toolSkeletonGrid} role="status" aria-label="正在加载智能工具">
              {[0, 1, 2].map((item) => <div key={item} className={styles.toolSkeleton} aria-hidden />)}
            </div>
          ) : cards.length === 0 ? (
            <div className={styles.state}>
              <p>工具暂时全部下线，敬请期待。</p>
            </div>
          ) : (
            <div className={styles.toolGrid}>
              {cards.map((t) => {
                const ToolIcon = TOOL_ICONS[t.key] ?? WandSparkles;
                return (
                <Link key={t.key} href={`/tools/${t.key}`} className={styles.toolCard}>
                  <div
                    className={styles.toolCover}
                    style={{ background: coverBg(t.cover ?? [220, 200, 260]) }}
                  >
                    {t.resolvedCoverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={t.resolvedCoverUrl}
                        className={styles.toolCoverImage}
                        src={t.resolvedCoverUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    ) : null}
                    <span className={styles.toolCoverIcon} aria-hidden>
                      <ToolIcon />
                    </span>
                    <span className={styles.toolOpen} aria-hidden>
                      <ArrowUpRight />
                    </span>
                  </div>
                  <div className={styles.toolBody}>
                    <div className={styles.toolTitleRow}>
                      <h3>{t.title}</h3>
                      <span className={styles.toolType}>
                        {TOOL_TYPE_LABEL[t.type === "video" ? "video" : "image"]}
                      </span>
                    </div>
                    <p>{t.desc}</p>
                  </div>
                </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 工具作品 ── */}
        <section className={`${styles.section} ${styles.worksSection}`} aria-labelledby="tool-works-title">
          <div className={styles.sectionHead}>
            <div>
              <h2 id="tool-works-title">工具作品</h2>
              <p>已完成的处理结果，同时保存在你的资产中。</p>
            </div>
            {loggedIn && works !== null && !worksError && (
              <span className={styles.count}>{total} 件作品</span>
            )}
          </div>

          {!initialized ? (
            <div className={styles.state} role="status" aria-label="正在初始化账号">
              <Loader2 className={styles.spin} aria-hidden />
            </div>
          ) : !loggedIn ? (
            <div className={styles.state}>
              <p>登录后可查看你的工具作品。</p>
              <Link className={styles.stateBtn} href="/login?redirect=/tools">
                去登录
              </Link>
            </div>
          ) : worksError ? (
            <div className={styles.state}>
              <p>作品加载失败，请稍后重试。</p>
              <button type="button" className={styles.stateBtn} onClick={retry}>
                重试
              </button>
            </div>
          ) : works === null ? (
            <div className={styles.state} role="status" aria-label="正在加载工具作品">
              <Loader2 className={styles.spin} aria-hidden />
            </div>
          ) : displayWorks.length === 0 ? (
            <div className={styles.state}>
              <p>还没有工具作品，从上面挑一个工具开始吧。</p>
            </div>
          ) : (
            <>
              <div className={styles.workGrid}>
                {displayWorks.map(({ task: w, resultUrl }) => {
                  const isVideo = VIDEO_TOOL_HANDLERS.has(w.handler);
                  const toolTitle = smartToolOriginLabel(w.handler, w.input) ?? "智能工具作品";
                  return (
                  <button
                    key={w.id}
                    type="button"
                    className={styles.workCard}
                    title={isVideo ? "播放视频" : "预览图片"}
                    aria-label={`${isVideo ? "播放" : "预览"}${toolTitle}`}
                    onClick={() => setWorkPreview({
                      url: resultUrl,
                      isVideo,
                      title: toolTitle,
                      date: fmtDate(w.createTime),
                    })}
                  >
                    <div className={styles.workStage}>
                      {isVideo ? (
                        // 进入视口前不挂 src，避免作品列表一次性拉取全部视频元数据。
                        <LazyToolVideo
                          src={resultUrl}
                          label={toolTitle}
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ossDisplayUrl(resultUrl, 640) ?? resultUrl}
                          alt={toolTitle}
                          loading="lazy"
                          decoding="async"
                          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
                          onError={(event) => fallbackOssDisplayImage(event.currentTarget, resultUrl)}
                        />
                      )}
                      {isVideo && (
                        <span className={styles.workPlay} aria-hidden>
                          <Play />
                        </span>
                      )}
                      <span className={styles.workOpen} aria-hidden>
                        查看作品 <ArrowUpRight />
                      </span>
                    </div>
                    <div className={styles.workMeta}>
                      <span className={styles.workTool}>{toolTitle}</span>
                      <span className={styles.workDate}>{fmtDay(w.createTime)}</span>
                    </div>
                  </button>
                  );
                })}
              </div>
              {works.length < total && (
                <div className={styles.more}>
                  <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <ToolWorkPreview preview={workPreview} onClose={() => setWorkPreview(null)} />
    </main>
  );
}
