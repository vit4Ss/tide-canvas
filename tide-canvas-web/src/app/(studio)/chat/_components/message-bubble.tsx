"use client";

/* ── message bubbles (extracted verbatim from page.tsx) ───────────────────────
   Bubble renders a user / plain-assistant message; AssistantResult renders a
   生成台 result bubble from its linked task (single source of truth). */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiTaskStatus } from "@/types/ai";
import type { MessageVO, MessageTaskVO } from "@/types/chat";
import { mesh } from "@/lib/mesh";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/components/shared/toast";
import { SongCard } from "@/components/studio/audio-player-card";
import {
  SkillRunPanel,
  type SkillRunPanelActionPayload,
} from "@/components/skill/skill-run-panel";
import { tracksFromMeta } from "@/lib/music-modes";
import { skillRunApi } from "@/lib/skill-run-api";
import type { SkillRunAction, SkillRunArtifactVO, SkillRunVO } from "@/types/skill-run";
import { fileNameFromUrl, type LightboxItem, type LightboxKind } from "./chat-utils";

/** Deterministic mesh-gradient fallback for an image-type message whose content
 *  URL is empty, seeded from the message id. */
function fallbackImage(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** parsed resultMeta of a task (JSON string or object → object). */
function taskMetaOf(t: MessageTaskVO): Record<string, unknown> {
  if (typeof t.resultMeta === "string") {
    try {
      return JSON.parse(t.resultMeta) || {};
    } catch {
      return {};
    }
  }
  return t.resultMeta && typeof t.resultMeta === "object"
    ? (t.resultMeta as Record<string, unknown>)
    : {};
}

/** all valid result URLs from a task (resultMeta.urls[], falling back to
 *  resultUrl). Multi-URL tasks (MJ 4-up / Suno 两首) return every entry. */
function taskResultUrls(t: MessageTaskVO): string[] {
  const meta = taskMetaOf(t);
  const arr = Array.isArray(meta.urls) ? (meta.urls as unknown[]) : [];
  const urls = arr.filter((u): u is string => typeof u === "string" && /^(https?:|data:)/.test(u));
  if (urls.length) return urls;
  return /^(https?:|data:)/.test(t.resultUrl || "") ? [t.resultUrl] : [];
}

/** Download a media URL as a file. Tries a blob fetch (forces save even for a
 *  cross-origin OSS URL); falls back to opening in a new tab on CORS failure. */
async function downloadMedia(url: string, name: string): Promise<void> {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("fetch failed");
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 4000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** A hover copy button (✓ feedback) used on prompt + text bubbles. */
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      title="复制"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } else {
          toast.error("复制失败");
        }
      }}
    >
      {done ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h8" />
        </svg>
      )}
    </button>
  );
}

/** markdown 代码块：右上角悬浮复制按钮。文案取渲染后 pre 的实际文本
    （innerText），流式中途点击也能复制到当前已输出的内容。 */
function MdPre({ node, ...props }: React.HTMLAttributes<HTMLPreElement> & { node?: unknown }) {
  void node; // react-markdown 附带的 AST 节点，剥离掉不透传给 DOM
  const ref = useRef<HTMLPreElement>(null);
  const [done, setDone] = useState(false);
  return (
    <div className="md-prewrap">
      <pre {...props} ref={ref} />
      <button
        type="button"
        className="copy-btn md-precopy"
        title="复制"
        onClick={async () => {
          if (await copyText(ref.current?.innerText ?? "")) {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          } else {
            toast.error("复制失败");
          }
        }}
      >
        {done ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
        )}
      </button>
    </div>
  );
}

/** 两处 ReactMarkdown 共用的组件覆写（模块级常量,避免每次渲染重建）。 */
export const MD_COMPONENTS = { pre: MdPre };

/** Read the composer attachments snapshotted on a user message's params
 *  ({attachments:[{url,kind}]}), filtering to entries with a usable URL. */
function messageAttachments(msg: MessageVO): { url: string; kind: string }[] {
  const raw = (msg.params as { attachments?: unknown } | undefined)?.attachments;
  if (!Array.isArray(raw)) return [];
  const out: { url: string; kind: string }[] = [];
  for (const x of raw) {
    if (x && typeof x === "object") {
      const url = (x as { url?: unknown }).url;
      const kind = (x as { kind?: unknown }).kind;
      if (typeof url === "string" && url) {
        // normalize empty/unknown kind to "image" (mirrors the backend, which
        // treats ""/"image" alike) so it renders as a thumbnail, not a file chip.
        out.push({ url, kind: typeof kind === "string" && kind ? kind : "image" });
      }
    }
  }
  return out;
}

export function Bubble({
  msg,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
  onSkillRunAction,
  swatchFor,
  fallbackModel,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
  onSkillRunAction: (
    runId: string,
    action: SkillRunAction,
    payload?: SkillRunPanelActionPayload,
    expectedRevision?: number,
  ) => void | Promise<unknown>;
  /** 模型名 → 图标 swatch（生成结果的 AI 头像显示生成所用模型）。 */
  swatchFor: (name: string) => { style: React.CSSProperties; glyph: string };
  /** 任务没存 modelName 时的兜底模型名（该轮 params.model，再退当前所选）。 */
  fallbackModel?: string;
}) {
  if (msg.role !== "user" && (msg.skillRunId || msg.skillRun)) {
    return (
      <AssistantSkillRun
        message={msg}
        onAction={onSkillRunAction}
        onOpenLightbox={onOpenLightbox}
      />
    );
  }

  // 生成台 assistant result: rendered from its linked task (single source of truth).
  if (msg.role !== "user" && msg.taskId) {
    return (
      <AssistantResult
        msg={msg}
        onReEdit={onReEdit}
        onRegenerate={onRegenerate}
        onOpenLightbox={onOpenLightbox}
        swatchFor={swatchFor}
        fallbackModel={fallbackModel}
      />
    );
  }

  const isMe = msg.role === "user";
  // backward-compat: older append-based media messages carry the URL in content.
  const isImage = msg.contentType === "image";
  const isVideo = msg.contentType === "video";
  // composer attachments snapshotted on the user message (text-model 文件上传).
  const atts = messageAttachments(msg);
  const attImages = atts.filter((a) => a.kind === "image");
  const aiSw = !isMe && fallbackModel ? swatchFor(fallbackModel) : null;
  return (
    <div className={`msg ${isMe ? "me" : "ai"}`}>
      {aiSw ? (
        <span className="av av-model" style={aiSw.style} title={fallbackModel}>
          {aiSw.glyph}
        </span>
      ) : (
        <span className="av" />
      )}
      <div className="msg-col">
        {isMe && atts.length > 0 && (
          <div className="chat-msg-atts">
            {atts.map((a, i) => {
              const lbKind: LightboxKind =
                a.kind === "video" || a.kind === "audio" || a.kind === "doc" ? a.kind : a.kind === "file" ? "doc" : "image";
              // 图片:整组一起进灯箱可左右翻;其余:单条进灯箱按类型预览
              const open =
                a.kind === "image"
                  ? () =>
                      onOpenLightbox(
                        attImages.map((x) => ({ url: x.url, kind: "image" as const })),
                        attImages.findIndex((x) => x.url === a.url),
                      )
                  : () => onOpenLightbox([{ url: a.url, kind: lbKind, name: fileNameFromUrl(a.url) }], 0);
              return a.kind === "image" ? (
                <button
                  key={i}
                  type="button"
                  className="chat-msg-att"
                  title="点击查看大图"
                  style={{ background: `center / cover no-repeat url("${a.url}")` }}
                  onClick={open}
                />
              ) : (
                <button key={i} type="button" className="chat-msg-file" title="点击预览" onClick={open}>
                  {a.kind === "video" ? "🎬" : a.kind === "audio" ? "🎵" : "📎"}{" "}
                  {a.kind === "video" ? "视频" : a.kind === "audio" ? "音频" : "文件"}
                </button>
              );
            })}
          </div>
        )}
        <div className="bubble">
          {isImage ? (
            <div
              className="chat-gen-media"
              title="点击查看大图"
              style={{
                cursor: msg.content ? "zoom-in" : undefined,
                background: msg.content
                  ? `center / cover no-repeat url("${msg.content}")`
                  : fallbackImage(msg.id),
              }}
              onClick={() => msg.content && onOpenLightbox([{ url: msg.content, kind: "image" as const }], 0)}
            />
          ) : isVideo && msg.content ? (
            <video className="chat-gen-media" src={msg.content} controls />
          ) : isMe ? (
            <span>{msg.content}</span>
          ) : (
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {/* copy action sits BELOW the bubble (outside it), not inside the colored pill */}
        {!isImage && !isVideo && msg.content ? (
          <div className="bubble-acts">
            <CopyBtn text={msg.content} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** AssistantResult renders a 生成台 result bubble from its task's live state:
 *  processing / failed / cancelled / expired(no task) / success(image|video).
 *  Multi-URL results (MJ 4-up) render a grid; clicking any opens the lightbox. */
function runArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const rows = [...(run.artifacts ?? []), ...(run.steps ?? []).flatMap((step) => step.artifacts ?? [])];
  const seen = new Set<string>();
  return rows.filter((artifact) => {
    const key = artifact.id || `${artifact.type}:${artifact.url || artifact.text || artifact.content || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function AssistantSkillRun({
  message,
  onAction,
  onOpenLightbox,
}: {
  message: MessageVO;
  onAction: (
    runId: string,
    action: SkillRunAction,
    payload?: SkillRunPanelActionPayload,
    expectedRevision?: number,
  ) => void | Promise<unknown>;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
}) {
  const [fetchedRun, setFetchedRun] = useState<SkillRunVO | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const latestRunRef = useRef<SkillRunVO | null>(null);
  const runId = message.skillRunId || message.skillRun?.id || "";
  const run = fetchedRun;
  const fetchedStatus = fetchedRun?.status;
  const summaryStatus = message.skillRun?.status;

  const acceptRun = useCallback((next: SkillRunVO): SkillRunVO => {
    const previous = latestRunRef.current;
    if (previous?.id === next.id) {
      const previousRevision = previous.revision ?? 0;
      const nextRevision = next.revision ?? 0;
      if (nextRevision < previousRevision) return previous;
      if (
        nextRevision === previousRevision &&
        (next.updateTime ?? "") < (previous.updateTime ?? "")
      ) return previous;
    }
    latestRunRef.current = next;
    setFetchedRun(next);
    return next;
  }, []);

  useEffect(() => {
    if (!runId) return;
    if (latestRunRef.current?.id !== runId) latestRunRef.current = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const result = await skillRunApi.detail(runId);
      if (!alive) return;
      if (result.success && result.data) {
        const accepted = acceptRun(result.data);
        setLoadFailed(false);
        if (accepted.status === "queued" || accepted.status === "running") {
          timer = setTimeout(() => void load(), 1500);
        } else if (
          accepted.status === "waiting_input" ||
          accepted.status === "waiting_confirmation"
        ) {
          // Slow polling keeps a second tab's confirm/cancel visible without
          // hammering the API while this tab is waiting for a decision.
          timer = setTimeout(() => void load(), 5000);
        }
      } else {
        setLoadFailed(true);
        if (!result.code || result.code === 408 || result.code === 429 || result.code >= 500) {
          timer = setTimeout(() => void load(), 2500);
        }
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [acceptRun, runId, summaryStatus, fetchedStatus]);

  const openArtifact = async (artifact: SkillRunArtifactVO) => {
    if (artifact.type === "text") {
      const text = artifact.text?.trim() || artifact.content?.trim() || "";
      if (text && (await copyText(text))) toast.success("已复制文本产物");
      return;
    }
    if (!artifact.url) return;
    if (artifact.type === "image") {
      const images = run
        ? runArtifacts(run).filter(
            (row): row is SkillRunArtifactVO & { url: string } =>
              row.type === "image" && !!row.url,
          )
        : [artifact as SkillRunArtifactVO & { url: string }];
      const index = Math.max(0, images.findIndex((row) => row.id === artifact.id));
      onOpenLightbox(
        images.map((row) => ({ url: row.url, kind: "image" as const, name: row.title })),
        index,
      );
      return;
    }
    const kind: LightboxKind =
      artifact.type === "video" ? "video" : artifact.type === "audio" ? "audio" : "doc";
    onOpenLightbox([{ url: artifact.url, kind, name: artifact.title }], 0);
  };

  return (
    <div className="msg ai">
      <span className="av" />
      <div className="bubble">
        {run ? (
          <SkillRunPanel
            run={run}
            compact
            onAction={async (action, payload) => {
              await onAction(run.id, action, payload, run.revision);
              const result = await skillRunApi.detail(run.id);
              if (result.success && result.data) acceptRun(result.data);
            }}
            onArtifact={(artifact) => void openArtifact(artifact)}
            artifactActionLabel={(artifact) => (artifact.type === "text" ? "复制" : "查看")}
          />
        ) : (
          <div className={`chat-gen-state${loadFailed ? " err" : ""}`}>
            {loadFailed ? "技能运行记录暂时无法加载" : "正在加载技能运行记录…"}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantResult({
  msg,
  onReEdit,
  onRegenerate,
  onOpenLightbox,
  swatchFor,
  fallbackModel,
}: {
  msg: MessageVO;
  onReEdit: (m: MessageVO) => void;
  onRegenerate: (m: MessageVO) => void;
  onOpenLightbox: (items: LightboxItem[], index: number) => void;
  swatchFor: (name: string) => { style: React.CSSProperties; glyph: string };
  fallbackModel?: string;
}) {
  const t = msg.task;
  const isVideo = msg.contentType === "video";
  const isAudio = msg.contentType === "audio";
  // 生成结果的头像 = 生成该结果所用的模型图标：任务 modelName 优先，旧任务
  // 没存时回退该轮 params.model / 当前所选模型（fallbackModel），仍无则 ✦。
  const modelName = t?.modelName || fallbackModel || "";
  const sw = modelName ? swatchFor(modelName) : null;

  let body: ReactNode;
  let done = false;
  let primaryUrl = "";
  if (!t) {
    body = <div className="chat-gen-state warn">⚠ 该生成已过期，请重新生成</div>;
  } else if (t.status === AiTaskStatus.PROCESSING) {
    // a preview placeholder sized like the final media, so the result reveals in
    // place instead of the layout jumping from a thin progress line to a full image.
    body = (
      <div className={`chat-gen-loading${isVideo ? " video" : isAudio ? " audio" : ""}`}>
        <span className="spin" />
        <span className="lbl">生成中 · {Math.round(t.progress || 0)}%</span>
        <span className="bar">
          {/* 进度用 transform（CSS 侧 width:100% + scaleX），避免布局动画 */}
          <i style={{ transform: `scaleX(${Math.max(0.04, (t.progress || 0) / 100)})` }} />
        </span>
      </div>
    );
  } else if (t.status === AiTaskStatus.FAILED) {
    body = <div className="chat-gen-state err">⚠ 生成失败{t.errorMsg ? `：${t.errorMsg}` : ""}</div>;
  } else if (t.status === AiTaskStatus.CANCELLED) {
    body = <div className="chat-gen-state">已取消生成</div>;
  } else {
    const urls = taskResultUrls(t);
    done = urls.length > 0;
    primaryUrl = urls[0] || "";
    if (!urls.length) {
      body = <div className="chat-gen-state err">⚠ 生成结果无效</div>;
    } else if (isAudio) {
      // Suno 一次两首：歌曲行列表（封面+歌名+波形+时间），封面/歌名来自 tracks。
      const tracks = tracksFromMeta(taskMetaOf(t));
      body = (
        <div className="chat-gen-audio">
          {urls.map((u, i) => (
            <SongCard
              key={u}
              src={u}
              title={tracks[i]?.title || (urls.length > 1 ? `曲目 ${i + 1}` : "AI 音乐")}
              subtitle={modelName || "AI 音乐"}
              cover={tracks[i]?.coverUrl}
              duration={tracks[i]?.duration}
            />
          ))}
        </div>
      );
    } else if (isVideo) {
      body = <video className="chat-gen-media" src={primaryUrl} controls />;
    } else if (urls.length > 1) {
      const items: LightboxItem[] = urls.map((u) => ({ url: u, kind: "image" as const }));
      body = (
        <div className="chat-gen-grid">
          {urls.map((u, i) => (
            <div
              key={u}
              className="chat-gen-cell"
              title="点击查看"
              style={{ background: `center / cover no-repeat url("${u}")` }}
              onClick={() => onOpenLightbox(items, i)}
            />
          ))}
        </div>
      );
    } else {
      body = (
        <div
          className="chat-gen-media"
          title="点击查看大图"
          style={{ cursor: "zoom-in", background: `center / cover no-repeat url("${primaryUrl}")` }}
          onClick={() => onOpenLightbox([{ url: primaryUrl, kind: "image" as const }], 0)}
        />
      );
    }
  }

  const retryable = !t || t.status === AiTaskStatus.FAILED;
  return (
    <div className="msg ai">
      {sw ? (
        <span className="av av-model" style={sw.style} title={modelName}>
          {sw.glyph}
        </span>
      ) : (
        <span className="av" />
      )}
      <div className="bubble">
        {body}
        {(done || retryable) && (
          <div className="chat-gen-acts">
            <button type="button" onClick={() => onReEdit(msg)}>
              ✎ 重新编辑
            </button>
            <button type="button" onClick={() => onRegenerate(msg)}>
              ↻ {retryable ? "重试" : "再次生成"}
            </button>
            {done && primaryUrl && (
              <button
                type="button"
                onClick={() =>
                  downloadMedia(
                    primaryUrl,
                    isVideo ? `gen-${msg.id}.mp4` : isAudio ? `gen-${msg.id}.mp3` : `gen-${msg.id}.png`,
                  )
                }
              >
                ⤓ 下载
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
