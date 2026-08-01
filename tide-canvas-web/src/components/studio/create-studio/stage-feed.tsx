/* 中央舞台：空状态 + 结果 feed（在飞 run 的进度占位 + 已完成 run 的历史流）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   结果以真实宽高比竖向成流，最新 run 在顶；在飞 run 完成后并入下方历史。
   复制提示词 / 整 run 下载是本块的自足行为，一并内聚；编辑 / 重新生成 / 删除 /
   单图工具条经 props 回调组合层。 */

import { useEffect, useRef } from "react";
import { mesh } from "@/lib/mesh";
import { ossDisplayUrl } from "@/lib/oss-display";
import { copyText } from "@/lib/clipboard";
import { AudioPlayerCard, SongCard } from "@/components/studio/audio-player-card";
import { toast } from "@/components/shared/toast";
import { AmbientFrame } from "./ambient-frame";
import { CELL_TOOLS, SLOT_ICON } from "./icons";
import type { ArtworkType, HistRun, ResultCell, RunMeta, ToolKey } from "./types";
import { fmtTs, ratioLabel } from "./utils";

export function StageFeed({
  busy,
  runs,
  runMeta,
  cells,
  progs,
  onQuickStart,
  onEditRun,
  onRegenRun,
  onDeleteRun,
  onCellTool,
  onZoom,
  hasMore,
  loadingMore,
  onLoadMore,
  initialLoading,
  loadError,
  endReached,
}: {
  busy: boolean;
  runs: HistRun[];
  runMeta: RunMeta | null;
  cells: ResultCell[];
  progs: number[];
  onQuickStart: (type: ArtworkType, tool: ToolKey) => void;
  onEditRun: (r: HistRun) => void;
  onRegenRun: (r: HistRun) => void;
  onDeleteRun: (r: HistRun) => void;
  onCellTool: (act: string, cell: ResultCell) => void;
  onZoom: (url: string) => void;
  /** 历史懒加载:还有更早的页可拉。 */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** 首页加载中:压制空态闪屏(有历史的用户先进来看到「准备好创作了吗」)。 */
  initialLoading?: boolean;
  /** 续页失败:哨兵改为可点击的重试。 */
  loadError?: boolean;
  /** 拉满判定:翻过页才显示「已经到底了」(只有一页时不扰屏)。 */
  endReached?: boolean;
}) {
  // 底部哨兵:进入视口提前量(rootMargin)就触发续页;组合层有加载中去重守卫。
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || !onLoadMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: "320px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  // copy a run's prompt（共享 copyText：clipboard API + execCommand 回退）。
  const copyPrompt = async (text: string) => {
    if (await copyText(text)) toast.success("已复制提示词");
    else toast.error("复制失败");
  };

  // download every image of a run (cross-origin URLs fall back to opening a tab).
  const downloadRun = async (r: HistRun) => {
    const urls = r.items.map((it) => it.url).filter((u): u is string => !!u);
    if (!urls.length) {
      toast.info("该作品暂无可下载的图片");
      return;
    }
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = obj;
        a.download = `${(r.prompt || "creation").slice(0, 20)}-${i + 1}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(obj);
      } catch {
        window.open(url, "_blank", "noopener");
      }
    }
    toast.success(urls.length > 1 ? `已开始下载 ${urls.length} 张图片` : "已开始下载");
  };

  return (
    <main className="ws-stage" id="stage">
      <div className="ws-stage-main">
        <div className="ws-stage-top">
          <div className="ws-crumb">
            <span className="d" />
            创作台 · STUDIO
          </div>
          {/* 「清空画布」按钮已按用户要求移除（2026-07-08）：结果卡自带逐条删除 */}
        </div>

        {/* empty state — only when nothing is generating and there's no history
            (首页未返回前不亮,避免有历史的用户看到空态闪屏) */}
        {!busy && !initialLoading && runs.length === 0 && (
          <div className="ws-empty" id="empty">
            <div className="ws-empty-glyph">
              <span className="glyph" />
            </div>
            <h2>准备好开始创作了吗？</h2>
            <p>写下一句提示词，挑个模型与比例 —— 数秒之后，作品就在这里浮现。</p>
            <div className="ws-empty-tags">
              {(
                [
                  { type: "image", tool: "t2i", label: "✦ 文生图" },
                  { type: "image", tool: "i2i", label: "↻ 图生图" },
                  { type: "video", tool: "t2v", label: "▶ 文生视频" },
                  { type: "video", tool: "i2v", label: "⤢ 图生视频" },
                  { type: "audio", tool: "t2a", label: "♪ 音乐生成" },
                  { type: "audio", tool: "sfx", label: "≈ 音效生成" },
                ] as { type: ArtworkType; tool: ToolKey; label: string }[]
              ).map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  onClick={() => onQuickStart(t.type, t.tool)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* result feed — newest run on top; each run shows its images at their
            TRUE aspect ratio (no crop). The in-flight run renders first; once it
            finishes it joins the history feed below. Replaces the old cropped grid
            + separate 生成历史 strip. */}
        {(busy || runs.length > 0) && (
          <div className="ws-feed" id="feed">
            {/* in-flight run (placeholders with progress) */}
            {busy && runMeta && (
              <div className={`ws-run inflight${cells.length <= 1 ? " single" : ""}${runMeta.kind === "audio" ? " audio" : ""}`}>
                <div className="ws-run-head">
                  <span className="ws-run-kind">
                    {SLOT_ICON[runMeta.kind ?? (runMeta.isVid ? "video" : "image")]}
                    {runMeta.kind === "audio" ? "AI 音乐" : runMeta.isVid ? "AI 视频" : "AI 图片"}
                  </span>
                  <span className="ws-run-div" />
                  {runMeta.model && <span className="ws-run-chip">{runMeta.model}</span>}
                  {runMeta.ratio && (
                    <span className="ws-run-chip">{ratioLabel(runMeta.ratio)}</span>
                  )}
                  <span className="ws-run-time">生成中…</span>
                </div>
                {runMeta.prompt && (
                  <div className="ws-run-prompt">
                    <span className="tx" title={runMeta.prompt}>
                      {runMeta.prompt}
                    </span>
                  </div>
                )}
                <div className="ws-run-imgs">
                  {cells.map((cell) => {
                    const [rw, rh] = runMeta.ratio.split(":").map(Number);
                    const pct = Math.round(progs[cell.i] ?? 0);
                    return (
                      <div
                        key={cell.i}
                        className="ws-runimg loading"
                        style={{ aspectRatio: `${rw || 1}/${rh || 1}` }}
                      >
                        <div
                          className="done-cov on"
                          style={{ background: mesh(cell.hues[0], cell.hues[1], cell.hues[2]) }}
                        />
                        <div className="shimmer" />
                        <div className="ph">
                          生成中 · <span className="pct">{pct}%</span>
                        </div>
                        <div className="bar">
                          <i style={{ width: `${progs[cell.i] ?? 0}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* finished runs */}
            {runs.map((r) => (
              <div key={r.run} className={`ws-run${r.items.length <= 1 ? " single" : ""}`}>
                <div className="ws-run-head">
                  <span className="ws-run-kind">
                    {SLOT_ICON[r.type]}
                    {r.type === "video" ? "AI 视频" : r.type === "audio" ? "AI 音乐" : "AI 图片"}
                  </span>
                  <span className="ws-run-div" />
                  {r.model && <span className="ws-run-chip">{r.model}</span>}
                  {r.ratio && <span className="ws-run-chip">{ratioLabel(r.ratio)}</span>}
                  {r.ts && <span className="ws-run-time">{fmtTs(r.ts)}</span>}
                </div>
                {r.prompt && (
                  <div className="ws-run-prompt">
                    <span className="tx" title={r.prompt}>
                      {r.prompt}
                    </span>
                    <button
                      type="button"
                      className="cp"
                      title="复制提示词"
                      aria-label="复制提示词"
                      onClick={() => copyPrompt(r.prompt)}
                    >
                      <svg viewBox="0 0 24 24">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                    </button>
                  </div>
                )}
                <div className="ws-run-imgs">
                  {/* 音频：Suno/Udio 式歌曲行列表（封面+歌名+波形+时间），
                      两首纵向成列——不走通用的并排卡片。 */}
                  {r.type === "audio" ? (
                    <div className="ws-runimg audio songs">
                      {r.items.map((it) => (
                        <SongCard
                          key={it.id}
                          src={it.url || ""}
                          title={it.trackTitle || it.title}
                          subtitle={r.model || "AI 音乐"}
                          cover={it.trackCover}
                          duration={it.trackDur}
                        />
                      ))}
                    </div>
                  ) : (
                  r.items.map((it) => {
                    const cell: ResultCell = { i: -1, hues: it.hues, url: it.url };
                    return (
                      <AmbientFrame
                        key={it.id}
                        url={it.type === "image" ? it.url || undefined : undefined}
                        className={`ws-runimg done${it.type === "video" ? " video" : it.type === "audio" ? " audio" : ""}`}
                        onClick={() => {
                          // images zoom in the lightbox; video/audio play inline via controls.
                          if (it.url && it.type === "image") onZoom(it.url);
                        }}
                      >
                        {it.url ? (
                          it.type === "video" ? (
                            <video
                              className="done-img"
                              src={it.url}
                              controls
                              playsInline
                              preload="metadata"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : it.type === "audio" ? (
                            <AudioPlayerCard src={it.url} />
                          ) : (
                            // 展示用降采样(大图宽约 1100px,取 1280 兼顾高分屏);
                            // 灯箱/下载/参考图仍走原始 URL。
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="done-img"
                              src={ossDisplayUrl(it.url, 1280) ?? it.url}
                              alt={r.prompt}
                              loading="lazy"
                            />
                          )
                        ) : (
                          <div
                            className="done-cov on"
                            style={{ background: mesh(it.hues[0], it.hues[1], it.hues[2]) }}
                          />
                        )}
                        {/* the per-result edit toolbar is image-only (作为垫图/精修/扩图/高清…) */}
                        {it.type === "image" && (
                          <div
                            className="gen-acts"
                            onClick={(e) => {
                              e.stopPropagation();
                              const btn = (e.target as HTMLElement).closest("button");
                              if (btn) onCellTool(btn.dataset.act || "", cell);
                            }}
                          >
                            {CELL_TOOLS.map((t) => (
                              <button
                                key={t.act}
                                type="button"
                                data-act={t.act}
                                className={t.real ? undefined : "soon"}
                                title={t.label}
                                aria-label={t.label}
                              >
                                {t.icon}
                              </button>
                            ))}
                          </div>
                        )}
                      </AmbientFrame>
                    );
                  })
                  )}
                </div>
                <div className="ws-run-foot">
                  <button
                    type="button"
                    onClick={() => onEditRun(r)}
                    disabled={busy}
                    title="载入该次参数到面板修改"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" />
                      <path d="M13.5 6.5l3 3" />
                    </svg>
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegenRun(r)}
                    disabled={busy}
                    title="用相同参数重新生成"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
                      <path d="M21 3v6h-6" />
                    </svg>
                    重新生成
                  </button>
                  <button type="button" onClick={() => downloadRun(r)} title="下载">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 3v12" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M4 21h16" />
                    </svg>
                    下载
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDeleteRun(r)}
                    title="删除"
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M4 7h16" />
                      <path d="M9 7V4h6v3" />
                      <path d="M6 7l1 14h10l1-14" />
                    </svg>
                    删除
                  </button>
                </div>
              </div>
            ))}

            {/* 懒加载哨兵:到底提前触发续页;固定高度+三点脉冲,不跳版式;
                失败给可点重试;翻过页才给到底提示 */}
            {hasMore ? (
              loadError ? (
                <button type="button" className="ws-feed-more retry" onClick={onLoadMore}>
                  加载失败，点击重试
                </button>
              ) : (
                <div ref={sentinelRef} className="ws-feed-more" aria-hidden>
                  {loadingMore ? (
                    <span className="more-dots"><i /><i /><i /></span>
                  ) : (
                    "下拉加载更多"
                  )}
                </div>
              )
            ) : endReached ? (
              <div className="ws-feed-more end" aria-hidden>
                — 已经到底了 —
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
