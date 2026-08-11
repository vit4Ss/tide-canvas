/* 中央舞台：空状态 + 结果 feed（在飞 run 的进度占位 + 已完成 run 的历史流）—
   从 create-studio.tsx 抽出（纯移动，无逻辑改动）。
   结果以真实宽高比竖向成流，生成中与已完成 run 按创建时间统一倒序排列。
   复制提示词 / 整 run 下载是本块的自足行为，一并内聚；编辑 / 重新生成 / 删除 /
   单图工具条经 props 回调组合层。 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mesh } from "@/lib/mesh";
import { fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";
import { copyText } from "@/lib/clipboard";
import { AudioPlayerCard, SongCard } from "@/components/studio/audio-player-card";
import { toast } from "@/components/shared/toast";
import { AmbientFrame } from "./ambient-frame";
import VideoResult from "./video-result";
import { CELL_TOOLS, SLOT_ICON } from "./icons";
import type { ArtworkType, HistRun, InflightRun, ResultCell, RunParams, ToolKey } from "./types";
import { fmtTs, ratioLabel } from "./utils";
import {
  runPromptReferences,
  splitRunPrompt,
  type RunPromptReference,
} from "./run-prompt-mentions";
import { orderStudioFeedRuns } from "./inflight-run-order";

const PROMPT_REFERENCE_GLYPH = { image: "图", video: "▶", audio: "♪" } as const;

function RunPromptMention({
  reference,
  onZoom,
}: {
  reference: RunPromptReference;
  /** 图片引用可点击放大（复用结果图同一个灯箱）；视频/音频引用无预览不接。 */
  onZoom?: (url: string) => void;
}) {
  const [failedSource, setFailedSource] = useState("");
  const showImage = reference.kind === "image" && failedSource !== reference.source;
  const inner = (
    <>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ossDisplayUrl(reference.source, 64) ?? reference.source}
          alt=""
          loading="lazy"
          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
          onError={(event) => {
            if (!fallbackOssDisplayImage(event.currentTarget, reference.source)) {
              setFailedSource(reference.source);
            }
          }}
        />
      ) : (
        <span className="mp-ic">{PROMPT_REFERENCE_GLYPH[reference.kind]}</span>
      )}
      <span className="mp-label">{reference.label}</span>
    </>
  );
  if (showImage && onZoom) {
    return (
      <button
        type="button"
        className="mention-pill ws-run-mention zoomable"
        title={`${reference.label} · 点击放大`}
        onClick={() => onZoom(reference.source)}
      >
        {inner}
      </button>
    );
  }
  return (
    <span className="mention-pill ws-run-mention" title={reference.label}>
      {inner}
    </span>
  );
}

function RunPromptText({
  prompt,
  params,
  onZoom,
}: {
  prompt: string;
  params?: RunParams;
  onZoom?: (url: string) => void;
}) {
  const parts = splitRunPrompt(prompt, runPromptReferences(params));
  return (
    <span className="tx" title={prompt}>
      {parts.map((part, index) => part.kind === "reference" ? (
        <RunPromptMention key={`${part.value.key}-${index}`} reference={part.value} onZoom={onZoom} />
      ) : (
        <span key={`text-${index}`}>{part.value}</span>
      ))}
    </span>
  );
}

function ThreeDResultCard({ item }: { item: HistRun["items"][number] }) {
  const fallbackType = (() => {
    try {
      const ext = new URL(item.url || "").pathname.split(".").pop();
      return ext && ext.length <= 5 ? ext.toLowerCase() : "model";
    } catch {
      return "model";
    }
  })();
  const assets = item.assets?.length
    ? item.assets
    : item.url
      ? [{ type: fallbackType, url: item.url }]
      : [];
  return (
    <div className="ws-runimg done three-d">
      <div className="ws-3d-preview">
        {item.previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ossDisplayUrl(item.previewImageUrl, 1280) ?? item.previewImageUrl}
            alt="3D 模型预览"
            loading="lazy"
            onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
            onError={(event) => fallbackOssDisplayImage(event.currentTarget, item.previewImageUrl!)}
          />
        ) : (
          <span className="ws-3d-cube" aria-hidden>{SLOT_ICON["3d"]}</span>
        )}
        <span className="ws-3d-ready">3D ASSET READY</span>
      </div>
      <div className="ws-3d-assets">
        <div>
          <strong>{item.title || "3D 模型"}</strong>
          <span>{assets.length ? `${assets.length} 种可下载格式` : "模型文件正在整理"}</span>
        </div>
        <div className="ws-3d-asset-links">
          {assets.map((asset) => (
            <a
              key={`${asset.type}-${asset.url}`}
              href={asset.url}
              target="_blank"
              rel="noreferrer"
              title={`下载 ${asset.type.toUpperCase()}`}
            >
              {asset.type.toUpperCase()} <span>↓</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StageFeed({
  busy,
  runs,
  inflightRuns,
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
  skillRunPanel,
}: {
  busy: boolean;
  runs: HistRun[];
  inflightRuns: InflightRun[];
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
  /** Agent/workflow run timeline. It remains separate from one-task media history. */
  skillRunPanel?: ReactNode;
}) {
  // 底部哨兵:进入视口提前量(rootMargin)就触发续页;组合层有加载中去重守卫。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const orderedFeedRuns = useMemo(
    () => orderStudioFeedRuns(inflightRuns, runs),
    [inflightRuns, runs],
  );
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
    const rawFiles = r.type === "3d"
      ? r.items.flatMap((item) => item.assets?.map((asset) => ({ url: asset.url, ext: asset.type })) ?? (item.url ? [{ url: item.url, ext: "glb" }] : []))
      : r.items.flatMap((item) => item.url ? [{ url: item.url, ext: "" }] : []);
    const seen = new Set<string>();
    const files = rawFiles.filter((file) => {
      if (seen.has(file.url)) return false;
      seen.add(file.url);
      return true;
    });
    if (!files.length) {
      toast.info(r.type === "3d" ? "该作品暂无可下载的模型文件" : "该作品暂无可下载的图片");
      return;
    }
    for (let i = 0; i < files.length; i++) {
      const { url, ext } = files[i];
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const obj = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = obj;
        const baseName = (r.prompt || r.model || "creation").slice(0, 20);
        a.download = `${baseName}-${i + 1}${ext ? `.${ext.toLowerCase()}` : ""}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(obj);
      } catch {
        window.open(url, "_blank", "noopener");
      }
    }
    toast.success(
      files.length > 1
        ? `已开始下载 ${files.length} 个${r.type === "3d" ? "模型文件" : "作品"}`
        : "已开始下载",
    );
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
        {!busy && !initialLoading && runs.length === 0 && !skillRunPanel && (
          <div className="ws-empty" id="empty">
            <div className="ws-empty-glyph">
              <span className="glyph" />
            </div>
            <h2>准备好开始创作了吗？</h2>
            <p>写下一句提示词或上传参考素材，挑选模型与参数，作品会在这里浮现。</p>
            <div className="ws-empty-tags">
              {(
                [
                  { type: "image", tool: "t2i", label: "✦ 文生图" },
                  { type: "image", tool: "i2i", label: "↻ 图生图" },
                  { type: "video", tool: "t2v", label: "▶ 文生视频" },
                  { type: "video", tool: "i2v", label: "⤢ 图生视频" },
                  { type: "audio", tool: "t2a", label: "♪ 音乐生成" },
                  { type: "audio", tool: "sfx", label: "≈ 音效生成" },
                  { type: "3d", tool: "t2_3d", label: "◇ 文生 3D" },
                  { type: "3d", tool: "i2_3d", label: "▱ 图生 3D" },
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
            TRUE aspect ratio (no crop). Live and completed tasks share one
            creation-time order, so a status transition never moves a run down. */}
        {(busy || runs.length > 0 || skillRunPanel) && (
          <div className="ws-feed" id="feed">
            {skillRunPanel}
            {/* Live placeholders and completed results are interleaved by start time. */}
            {orderedFeedRuns.map((entry) => {
              if (entry.state === "inflight") {
                const inflight = entry.run;
                const { meta, cells: runCells, progs: runProgs } = inflight;
                return (
                  <div key={entry.key} className={`ws-run inflight${runCells.length <= 1 ? " single" : ""}${meta.kind === "audio" ? " audio" : ""}${meta.kind === "3d" ? " three-d" : ""}`}>
                    <div className="ws-run-head">
                      <span className="ws-run-kind">
                        {SLOT_ICON[meta.kind ?? (meta.isVid ? "video" : "image")]}
                        {meta.kind === "audio" ? "AI 音乐" : meta.kind === "3d" ? "AI 3D" : meta.isVid ? "AI 视频" : "AI 图片"}
                      </span>
                      <span className="ws-run-div" />
                      {meta.model && <span className="ws-run-chip">{meta.model}</span>}
                      {meta.ratio && (
                        <span className="ws-run-chip">{ratioLabel(meta.ratio)}</span>
                      )}
                      <span className="ws-run-time">生成中…</span>
                    </div>
                    {meta.prompt && (
                      <div className="ws-run-prompt">
                        <RunPromptText prompt={meta.prompt} params={meta.params} onZoom={onZoom} />
                      </div>
                    )}
                    <div className="ws-run-imgs">
                      {runCells.map((cell) => {
                        const [rw, rh] = meta.ratio.split(":").map(Number);
                        const pct = Math.round(runProgs[cell.i] ?? 0);
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
                              <i style={{ width: `${runProgs[cell.i] ?? 0}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              const r = entry.run;
              return (
                <div key={entry.key} className={`ws-run${r.items.length <= 1 ? " single" : ""}`}>
                <div className="ws-run-head">
                  <span className="ws-run-kind">
                    {SLOT_ICON[r.type]}
                    {r.type === "video" ? "AI 视频" : r.type === "audio" ? "AI 音乐" : r.type === "3d" ? "AI 3D" : "AI 图片"}
                  </span>
                  <span className="ws-run-div" />
                  {r.model && <span className="ws-run-chip">{r.model}</span>}
                  {r.ratio && <span className="ws-run-chip">{ratioLabel(r.ratio)}</span>}
                  {r.ts && <span className="ws-run-time">{fmtTs(r.ts)}</span>}
                </div>
                {r.prompt && (
                  <div className="ws-run-prompt">
                    <RunPromptText prompt={r.prompt} params={r.params} onZoom={onZoom} />
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
                  {r.type === "3d" ? (
                    r.items.map((item) => <ThreeDResultCard key={item.id} item={item} />)
                  ) : r.type === "audio" ? (
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
                            // 自带「截取当前帧」:按原始分辨率导出 PNG 并入资产库
                            <VideoResult className="done-img" src={it.url} />
                          ) : it.type === "audio" ? (
                            <AudioPlayerCard src={it.url} />
                          ) : (
                            // 展示用降采样(大图宽约 1100px,取 1280 兼顾高分屏);
                            // 灯箱/下载/参考图仍走原始 URL。
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="done-img"
                              src={ossDisplayUrl(it.url, 1280) ?? it.url}
                              alt=""
                              loading="lazy"
                              onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
                              onError={(event) => fallbackOssDisplayImage(event.currentTarget, it.url)}
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
              );
            })}

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
