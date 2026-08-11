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
  Eraser,
  Loader2,
  Maximize2,
  Paintbrush,
  ScanLine,
  Scissors,
  SunMedium,
  Video,
  WandSparkles,
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
      <div className="insp-glow" aria-hidden="true" />
      <div className="insp-in">
        {/* .insp 骨架是居中 hero:副标题也居中,与标题同轴 */}
        <h1>工具</h1>
        <p className={styles.heroSub}>封装好的一键 AI 处理：上传素材，确认模型与积分后即可开始。</p>

        {/* ── 工具入口 ── */}
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
                </div>
                <div className={styles.toolBody}>
                  <h3>
                    {t.title}
                    {/* 素材形态差异会直接影响用户要准备什么文件,标在标题旁 */}
                    <span className={styles.toolType}>
                      {TOOL_TYPE_LABEL[t.type === "video" ? "video" : "image"]}
                    </span>
                  </h3>
                  <p>{t.desc}</p>
                </div>
              </Link>
              );
            })}
          </div>
        )}

        {/* ── 工具作品 ── */}
        <div className={styles.worksHead}>
          <h2>工具作品</h2>
          <p className={styles.sub}>用上面的工具处理成功的结果，会保留在工具作品与资产中，不混入创作台。</p>
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
                <a
                  key={w.id}
                  className={styles.workCard}
                  href={resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={isVideo ? "查看原片" : "查看原图"}
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
                  </div>
                  <div className={styles.workMeta}>
                    <span className={styles.workTool}>{toolTitle}</span>
                    <span className={styles.workDate}>{fmtDay(w.createTime)}</span>
                  </div>
                </a>
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
      </div>
    </main>
  );
}
