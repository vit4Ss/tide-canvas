"use client";

/* ============================================================================
   工具中心 — /tools(侧栏「工具」页签)。

   上半部:后台「工具管理」启用且展示独立页的智能工具(GET /api/ai/tools,
   公开),卡片点击进 /tools/<key> 的全屏处理页。接口未应答或失败时用出厂
   兜底列表(lib/ai-tools-catalog,与 /tools/[op] 同源);接口成功但为空
   (管理员全部下线)则如实显示空态,绝不摆出点进去是死胡同的兜底卡。

   下半部:「工具作品」——当前账号用智能工具处理成功的结果图。数据走
   GET /api/ai/tasks?mediaType=tool(服务端按工具专属 handler 圈定:抠图/
   扩图/放大/物体移除/打光;局部重绘复用通用图生图,无法区分,不在其中),
   分页在服务端完成。未登录只展示工具卡与登录引导,不发列表请求。
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { aiApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { coverBg } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import { FALLBACK_TOOLS, PRESET_TOOL_LABELS } from "@/lib/ai-tools-catalog";
import { AiTaskStatus, type AiTaskVO, type AiToolVO } from "@/types/ai";
import styles from "./tools-hub.module.css";

const PAGE_SIZE = 18;

function fmtDay(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function ToolsHub() {
  const { user, initialized } = useAuth();

  // 工具入口卡:null = 接口未应答/失败(渲染出厂兜底);[] = 成功但全部下线。
  const [tools, setTools] = useState<AiToolVO[] | null>(null);
  useEffect(() => {
    let alive = true;
    aiApi.tools().then((res) => {
      if (alive && res.success && Array.isArray(res.data)) setTools(res.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const cards = useMemo(() => {
    if (tools === null) return FALLBACK_TOOLS;
    return [...tools].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [tools]);

  /** handler → 工具标题(优先后台配置,其次内建兜底,最后原样)。 */
  const handlerTitle = useCallback(
    (handler: string) => {
      const vo = tools?.find((t) => t.handler === handler);
      return vo?.title ?? PRESET_TOOL_LABELS[handler] ?? handler;
    },
    [tools],
  );

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

  return (
    <main className={`insp ${styles.fill}`}>
      <div className="insp-glow" aria-hidden="true" />
      <div className="insp-in">
        {/* .insp 骨架是居中 hero:副标题也居中,与标题同轴 */}
        <h1>工具</h1>
        <p className={styles.heroSub}>封装好的一键 AI 处理：上传图片即出结果，无需编写提示词。</p>

        {/* ── 工具入口 ── */}
        {cards.length === 0 ? (
          <div className={styles.state}>
            <p>工具暂时全部下线，敬请期待。</p>
          </div>
        ) : (
          <div className={styles.toolGrid}>
            {cards.map((t) => (
              <Link key={t.key} href={`/tools/${t.key}`} className={styles.toolCard}>
                <div
                  className={styles.toolCover}
                  style={{ background: coverBg(t.cover ?? [220, 200, 260]) }}
                >
                  {t.icon ? <span aria-hidden>{t.icon}</span> : null}
                </div>
                <div className={styles.toolBody}>
                  <h3>{t.title}</h3>
                  <p>{t.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ── 工具作品 ── */}
        <div className={styles.worksHead}>
          <h2>工具作品</h2>
          <p className={styles.sub}>用上面的工具处理成功的结果，也会同步进你的生成历史与资产。</p>
        </div>

        {!initialized ? (
          <div className={styles.state}>
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
          <div className={styles.state}>
            <Loader2 className={styles.spin} aria-hidden />
          </div>
        ) : works.length === 0 ? (
          <div className={styles.state}>
            <p>还没有工具作品，从上面挑一个工具开始吧。</p>
          </div>
        ) : (
          <>
            <div className={styles.workGrid}>
              {works.map((w) => (
                <a
                  key={w.id}
                  className={styles.workCard}
                  href={w.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="查看原图"
                >
                  <div className={styles.workStage}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={w.resultUrl} alt={handlerTitle(w.handler)} loading="lazy" />
                  </div>
                  <div className={styles.workMeta}>
                    <span className={styles.workTool}>{handlerTitle(w.handler)}</span>
                    <span className={styles.workDate}>{fmtDay(w.createTime)}</span>
                  </div>
                </a>
              ))}
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
