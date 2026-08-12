"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aiApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { AiTaskStatus, type AiTaskVO, type UserGenerationHistoryVO } from "@/types/ai";
import { PRESET_TOOL_LABELS } from "@/lib/ai-tools-catalog";
import { X, RefreshCw, Loader2, CheckCircle2, XCircle, Inbox, ExternalLink } from "lucide-react";
import "./canvas-history-panel.css";

const HANDLER_LABEL: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  start_end_to_video: "首尾帧视频",
  text_to_audio: "音频生成",
  creative_desc: "创意描述",
  // 服务端预设图像编辑能力（画布「高清」入口产生 upscale,其余来自创作台/工具页），
  // 标签与工具中心/工具页共用一份
  ...PRESET_TOOL_LABELS,
};
const MEDIA_LABEL: Record<UserGenerationHistoryVO["mediaType"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  "3d": "3D",
  text: "文本",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

function CanvasHistoryPreview({ record }: { record: UserGenerationHistoryVO }) {
  if (record.success !== 1) {
    return <p className="canvas-history-failure">生成未完成，本次积分已退回</p>;
  }
  if (!record.resultUrl) return null;

  if (record.mediaType === "video") {
    return <video className="canvas-history-preview" controls preload="metadata" src={record.resultUrl} />;
  }
  if (record.mediaType === "audio") {
    return <audio className="canvas-history-audio" aria-label="生成音频" controls preload="metadata" src={record.resultUrl} />;
  }
  if (record.mediaType === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="canvas-history-preview" src={record.resultUrl} alt="生成结果" loading="lazy" />;
  }

  return (
    <a className="canvas-history-result-link" href={record.resultUrl} target="_blank" rel="noreferrer">
      打开生成结果
      <ExternalLink aria-hidden size={13} />
    </a>
  );
}

/** 画布历史面板：当前画布的进行中任务与安全生成记录摘要。 */
export function CanvasHistoryPanel({ open, onClose }: Props) {
  const projectId = useCanvasStore((s) => s.currentProjectId);
  const [tasks, setTasks] = useState<AiTaskVO[]>([]);
  const [logs, setLogs] = useState<UserGenerationHistoryVO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const aliveRef = useRef(true);
  // 挂载时必须重新置 true:StrictMode 会 mount→unmount→remount,只在 cleanup
  // 置 false 的话重挂载后 ref 永远为 false,面板卡在 loading。
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    // projectId 未就绪时不带过滤条件查询会拉到全部项目的记录,与「本画布」标题矛盾
    if (!projectId) return;
    try {
      const [tRes, lRes] = await Promise.all([
        aiApi.listTasks({ pageNum: 1, pageSize: 50, status: AiTaskStatus.PROCESSING, ...(projectId ? { projectId } : {}) }),
        aiApi.myHistory({ pageNum: 1, pageSize: 50, ...(projectId ? { projectId } : {}) }),
      ]);
      if (!aliveRef.current) return; // 卸载后不 setState
      if (tRes.success && tRes.data) setTasks(tRes.data.records);
      if (lRes.success && lRes.data) setLogs(lRes.data.records);
    } catch {
      // 拉取失败(被 4s 轮询反复触发):忽略,不抛未处理 rejection
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, [projectId]);

  // 打开时拉取，并每 4s 刷新（进行中任务进度）
  useEffect(() => {
    if (!open) return;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const pollTimer = window.setInterval(() => void load(), 4000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(pollTimer);
    };
  }, [open, load]);

  // Esc 关闭：仅在没有更上层浮层（模态/下拉/菜单）打开时响应，
  // 避免与 SkillPicker 等弹层的 Esc 处理共存时互相误关。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [role="listbox"], [role="menu"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="canvas-history-panel">
      <div className="canvas-history-head">
        <span>历史 · 本画布</span>
        <div>
          <button onClick={() => void load()} title="刷新" aria-label="刷新历史记录">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} title="关闭" aria-label="关闭历史记录">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="canvas-history-scroll">
        {!loaded ? (
          <div className="canvas-history-skeleton" role="status" aria-label="正在加载历史">
            {[92, 100, 84, 96, 70].map((w, i) => (
              <div key={i} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <>
            {/* 进行中任务 */}
            <section className="canvas-history-section">
              <h3>进行中 <span>{tasks.length}</span></h3>
              {tasks.length === 0 ? (
                <p className="canvas-history-empty-copy">暂无进行中的任务</p>
              ) : (
                <div className="canvas-history-task-list">
                  {tasks.map((t) => (
                    <div key={t.id} className="canvas-history-task">
                      <div>
                        <Loader2 className="canvas-history-spinner h-3.5 w-3.5 animate-spin" />
                        <strong>{HANDLER_LABEL[t.handler] ?? "生成任务"}</strong>
                        <time>{t.createTime?.replace("T", " ").slice(5, 19)}</time>
                      </div>
                      <div className="canvas-history-progress">
                        <i style={{ width: `${t.progress || 5}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="canvas-history-section canvas-history-records">
              <h3>生成记录 <span>{logs.length}</span></h3>
              {logs.length === 0 ? (
                <div className="canvas-history-empty">
                  <Inbox aria-hidden size={22} />
                  <p>本画布还没有生成记录</p>
                </div>
              ) : (
                <div className="canvas-history-record-list">
                  {logs.map((l) => (
                    <article key={l.id} className="canvas-history-record">
                      <button
                        onClick={() => setExpandedId((id) => (id === l.id ? null : l.id))}
                        aria-expanded={expandedId === l.id}
                      >
                        {l.success === 1 ? <CheckCircle2 className="is-success" /> : <XCircle className="is-failed" />}
                        <strong>{MEDIA_LABEL[l.mediaType]}</strong>
                        <span>{l.model}</span>
                        <time>{l.durationMs != null ? `${(l.durationMs / 1000).toFixed(0)}s` : ""}</time>
                      </button>
                      {expandedId === l.id && (
                        <div className="canvas-history-record-detail">
                          <time>{l.createTime?.replace("T", " ").slice(0, 19)}</time>
                          {l.prompt ? <p>{l.prompt}</p> : null}
                          <CanvasHistoryPreview record={l} />
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
