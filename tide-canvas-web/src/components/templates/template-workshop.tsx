"use client";
/* eslint-disable @next/next/no-img-element -- User-owned uploads and signed generation URLs must remain direct media requests. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Download, ImagePlus, Loader2, Maximize2, Music2, RefreshCw, Video, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { commitAcceptedAiGeneration, recoverableAiGenerations, isAmbiguousAiCreateCode } from "@/lib/ai-generation-idempotency";
import { studioTemplateApi, type PublicStudioTemplate, type TemplateQuote, type TemplateSetup, type TemplateUploads } from "@/lib/studio-template-api";
import { templateInputs } from "@/lib/studio-template";
import { TemplateMedia } from "@/components/studio/create-studio/template-media";
import type { FileVO } from "@/types/file";
import { AiTaskStatus, type AiTaskVO } from "@/types/ai";
import { templateUploadSlots, templateUploadInput, templateUploadsReady, templateOutputText, templateResultURLs } from "@/lib/template-workshop";
import css from "./templates.module.css";
import { readTemplateDraft, saveTemplateDraft, templateDraftSignature } from "@/lib/template-draft";
import { downloadTemplateResult } from "@/lib/template-download";

type UploadState = { file?: FileVO; progress?: number; busy?: boolean; error?: string; unverified?: boolean; canRetry?: boolean };
const safeURL = (value: string) => /^(https?:\/\/|\/[^/])/i.test(value) ? value : "";

export default function TemplateWorkshop({ templateId, returnTo = "/templates" }: { templateId: string; returnTo?: string }) {
  const { user, initialized } = useAuth();
  return <Workshop key={`${templateId}:${user?.id || "guest"}`} templateId={templateId} returnTo={returnTo} owner={user ? String(user.id) : ""} authReady={initialized} />;
}

function Workshop({ templateId, returnTo, owner, authReady }: { templateId: string; returnTo: string; owner: string; authReady: boolean }) {
  const scope = `template:${templateId}`;
  const [row, setRow] = useState<PublicStudioTemplate | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [quote, setQuote] = useState<(TemplateQuote & { inputKey: string }) | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [setup, setSetup] = useState<TemplateSetup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [hydratedSignature, setHydratedSignature] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [draftSaved, setDraftSaved] = useState(true);
  const [draftRetry, setDraftRetry] = useState(0);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [task, setTask] = useState<AiTaskVO | null>(null);
  const [selectedResult, setSelectedResult] = useState("");
  const resultURLs = templateResultURLs(task);
  const resultURL = resultURLs.includes(selectedResult) ? selectedResult : resultURLs[0] || "";
  const [sending, setSending] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [unresolved, setUnresolved] = useState(false);
  const [deletedTaskId, setDeletedTaskId] = useState("");
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const alive = useRef(true);
  const submitLock = useRef(false);
  const uploadLocks = useRef(new Set<string>());
  const retryUploads = useRef(new Map<string, File>());
  const downloadLock = useRef(false);
  const current = useCallback(() => alive.current && (!owner || String(useAuthStore.getState().user?.id || "") === owner), [owner]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    void studioTemplateApi.get(templateId).then(res => {
      if (cancelled) return;
      if (res.success && res.data) { setRow(res.data); setLoadError(""); }
      else setLoadError(res.message || "模板暂时无法打开");
    }).catch(() => { if (!cancelled) setLoadError("网络连接中断，请重试"); });
    return () => { cancelled = true; };
  }, [templateId, reload]);

  useEffect(() => {
    let stopped = false;
    void studioTemplateApi.setup(templateId, AbortSignal.timeout(15000)).then(res => {
      if (stopped) return;
      if (res.success && res.data?.modelId && res.data.options) { setSetup(res.data); setSetupError(""); }
      else setSetupError(res.message || "暂时无法读取模板规格和基础积分");
    }).catch(() => { if (!stopped) setSetupError("模板规格暂时无法读取，请重试"); });
    return () => { stopped = true; };
  }, [templateId, reload]);

  const recover = useCallback(async () => {
    if (!owner || !current()) { setRecovering(false); return; }
    if (submitLock.current) return;
    submitLock.current = true; setRecovering(true); setError("");
    try {
      const pending = recoverableAiGenerations(scope, owner).at(-1);
      if (!pending) { setUnresolved(false); return; }
      const saved = pending.recovery as { uploads?: Record<string, UploadState> } | undefined;
      if (saved?.uploads) setUploads(saved.uploads);
      const result = pending.taskId ? await aiApi.getTask(pending.taskId) : pending.payload ? await aiApi.generateIdempotent({ ...pending.payload, clientRequestId: pending.clientRequestId }, scope, { requireDurableJournal: true, retainAccepted: true, ownerUserId: owner, dedupeActivePayload: true, recovery: pending.recovery }) : null;
      if (!current()) return;
      if (result?.success && result.data?.id) { setTask(result.data); setUnresolved(false); setDeletedTaskId(""); }
      else if (pending.taskId && result?.code === 404) {
        setTask(null); setDeletedTaskId(pending.taskId); setUnresolved(true);
        setError("上次任务已从生成记录移除。你可以开始新的模板操作，不会自动生成或扣费。");
      }
      else {
        // Missing accepted tasks are reconciled explicitly; never guess a new paid intent.
        setUnresolved(recoverableAiGenerations(scope, owner).length > 0);
        setError(result?.message || "暂时无法确认上次任务，请点击检查任务状态");
      }
    } catch { if (current()) { setUnresolved(true); setError("暂时无法确认上次任务，请检查网络后重试，不会重复提交新任务。"); } }
    finally { submitLock.current = false; if (current()) setRecovering(false); }
  }, [owner, scope, current]);
  useEffect(() => { void Promise.resolve().then(recover); }, [recover]);

  const slots = useMemo(() => row ? templateUploadSlots(row) : [], [row]);
  const recipeSignature = row ? templateDraftSignature(row) : "";
  const draftReady = !!row && hydratedSignature === recipeSignature;
  useEffect(() => {
    if (!row) return;
    let stopped = false;
    const restore = async () => {
      const accepted = owner ? recoverableAiGenerations(scope, owner).at(-1) : undefined;
      if (!owner || accepted) {
        if (!stopped) {
          const oldRecipe = (accepted?.recovery as { recipeSignature?: string } | undefined)?.recipeSignature;
          if (accepted && oldRecipe !== recipeSignature) { setUploads({}); setDraftNotice("模板素材要求已更新，再次使用时请重新选择素材。"); }
          setHydratedSignature(recipeSignature);
        }
        return;
      }
      await Promise.resolve(); if (stopped) return; setHydratedSignature("");
      const saved = readTemplateDraft(owner, templateId, recipeSignature);
      const results = await Promise.all(Object.entries(saved.files).filter(([key]) => slots.some(slot => slot.key === key)).map(async ([key, file]) => {
        try {
          const res = await fileApi.get(file.id, AbortSignal.timeout(12000));
          if (res.success && res.data?.id === file.id && (!res.data.ownerId || String(res.data.ownerId) === owner)) return [key, { file: res.data }] as const;
          if (res.code === 403 || res.code === 404) return [key, { error: "此素材已不可用，请重新上传" }] as const;
        } catch { /* Preserve the reference through a transient validation failure. */ }
        return [key, { file, unverified: true, error: "暂时无法核验素材，请重试" }] as const;
      }));
      if (stopped || !current()) return;
      setUploads(Object.fromEntries(results));
      setDraftNotice(saved.changed ? "模板素材要求已更新，请按新要求重新选择素材。" : results.length ? "已恢复本机草稿，生成前会重新确认积分。" : "");
      setHydratedSignature(recipeSignature);
    };
    void restore();
    return () => { stopped = true; };
  }, [row, owner, scope, templateId, recipeSignature, slots, draftRetry, current]);
  const draftFileJSON = JSON.stringify(Object.fromEntries(slots.filter(slot => uploads[slot.key]?.file).map(slot => [slot.key, uploads[slot.key].file!])));
  useEffect(() => {
    if (!owner || !draftReady || !row || !current()) return;
    const saved = JSON.parse(draftFileJSON) as Record<string, FileVO>;
    // Persist only successful uploads, retaining the original file during replacements.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftSaved(saveTemplateDraft(owner, templateId, recipeSignature, saved));
  }, [owner, templateId, recipeSignature, draftFileJSON, draftReady, row, current]);
  const files = useMemo(() => Object.fromEntries(Object.entries(uploads).filter(([, value]) => value.file && !value.busy && !value.unverified).map(([key, value]) => [key, value.file!])), [uploads]);
  const input = useMemo(() => templateUploadInput(slots, files), [slots, files]);
  const inputKey = JSON.stringify(input);
  const anyUploading = Object.values(uploads).some(value => value.busy);
  const ready = !!row && !anyUploading && templateUploadsReady(row, slots, files);
  const uploadedCount = slots.filter(slot => !!files[slot.key]).length;
  const processing = task?.status === AiTaskStatus.PROCESSING;
  const locked = sending || recovering || !draftReady || !setup || !!setupError || unresolved || !!task;

  useEffect(() => {
    if (!owner || !ready || locked || !row) return;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout>;
    const timer = setTimeout(async () => {
      setQuoteLoading(true); setQuoteError(""); setQuote(null);
      deadline = setTimeout(() => { controller.abort(); if (current()) { setQuoteLoading(false); setQuoteError("确认积分超时，请检查网络后重试"); } }, 30000);
      try {
        const res = await studioTemplateApi.quote(templateId, JSON.parse(inputKey) as TemplateUploads, controller.signal);
        if (controller.signal.aborted || !current()) return;
        if (res.success && res.data) setQuote({ ...res.data, inputKey });
        else setQuoteError(res.message || "暂时无法确认积分，请重试");
      } catch { if (!controller.signal.aborted && current()) setQuoteError("网络连接中断，未能确认本次积分"); }
      finally { clearTimeout(deadline); if (!controller.signal.aborted && current()) setQuoteLoading(false); }
    }, 120);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [owner, ready, locked, row, templateId, inputKey, quoteRetry, current]);

  useEffect(() => {
    if (!task?.id || task.status !== AiTaskStatus.PROCESSING) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await aiApi.getTask(task.id, controller.signal);
        if (controller.signal.aborted || !current()) return;
        if (res.success && res.data) {
          setTask(res.data); setPollError("");
          if (res.data.status !== AiTaskStatus.PROCESSING) { void useAuthStore.getState().fetchUser(true); return; }
        } else if (res.code === 404) {
          setDeletedTaskId(task.id); setTask(null); setUnresolved(true);
          setError("任务已从生成记录移除。你可以开始新的模板操作，不会自动生成或扣费。");
          return;
        } else setPollError("暂时无法获取进度，正在重新连接。任务会继续处理。");
      } catch { if (!controller.signal.aborted && current()) setPollError("网络暂时中断，正在重新连接。任务会继续处理。"); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 1800);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [task?.id, task?.status, current]);

  const upload = async (key: string, kind: "image" | "video" | "audio", file?: File) => {
    if (!file || locked || !owner || !current() || submitLock.current || uploadLocks.current.has(key)) return;
    if (!file.type.startsWith(`${kind}/`)) { setUploads(prev => ({ ...prev, [key]: { ...prev[key], error: `请选择${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}文件` } })); return; }
    uploadLocks.current.add(key); setQuote(null); setQuoteError("");
    retryUploads.current.set(key, file);
    const original = uploads[key]?.file;
    setUploads(prev => ({ ...prev, [key]: { file: original, busy: true, progress: 0 } }));
    try {
      const res = await uploadFileSmart(file, progress => { if (current()) setUploads(prev => ({ ...prev, [key]: { file: original, busy: true, progress } })); }, { maxBytes: setup?.maxUploadBytes?.[kind] || 50 * 1024 * 1024, label: kind === "image" ? "图片" : kind === "video" ? "视频" : "音频" });
      if (!current()) return;
      if (res.success && res.data?.id) retryUploads.current.delete(key);
      setUploads(prev => ({ ...prev, [key]: res.success && res.data?.id ? { file: res.data } : { file: original, canRetry: true, error: `${res.message || "上传失败，请重试"}${original ? "，已保留原素材" : ""}` } }));
    } catch { if (current()) setUploads(prev => ({ ...prev, [key]: { file: original, canRetry: true, error: original ? "替换失败，已保留原素材，请重试" : "上传失败，请检查网络后重试" } })); }
    finally { uploadLocks.current.delete(key); }
  };

  const generate = async () => {
    if (!owner || !current() || !quote || quote.inputKey !== inputKey || !ready || locked || submitLock.current || uploadLocks.current.size) return;
    submitLock.current = true; setSending(true); setError("");
    try {
      const res = await aiApi.generateIdempotent({ templateId, templateQuote: quote.quoteToken, handler: quote.handler, modelId: quote.modelId, input: { ...input } }, scope, {
        requireDurableJournal: true, retainAccepted: true, ownerUserId: owner, dedupeActivePayload: true, recovery: { uploads, recipeSignature },
      });
      if (!current()) return;
      if (res.success && res.data?.id) { setTask(res.data); void useAuthStore.getState().fetchUser(true); }
      else { setError(res.message || "生成未能提交，请重试"); setUnresolved(isAmbiguousAiCreateCode(res.code)); setQuote(null); setQuoteRetry(v => v + 1); }
    } catch { if (current()) { setUnresolved(true); setError("提交结果暂时无法确认。请检查任务状态，避免重复扣费。"); } }
    finally { submitLock.current = false; if (current()) setSending(false); }
  };
  const reset = async () => {
    if (!task || processing || !current() || submitLock.current) return;
    submitLock.current = true;
    try {
      await commitAcceptedAiGeneration(scope, task.id, owner);
      if (current()) { setTask(null); setSelectedResult(""); setDownloadError(""); setQuote(null); setError(""); setPollError(""); setMediaError(false); setShowExample(false); setQuoteRetry(v => v + 1); }
    } finally { submitLock.current = false; }
  };
  const clearDeletedTask = async () => {
    if (!deletedTaskId || submitLock.current || !current()) return;
    submitLock.current = true;
    try {
      await commitAcceptedAiGeneration(scope, deletedTaskId, owner);
      if (current()) { setDeletedTaskId(""); setUnresolved(false); setTask(null); setQuote(null); setError(""); setPollError(""); setQuoteRetry(v => v + 1); }
    } finally { submitLock.current = false; }
  };

  const download = async () => {
    if (!task || !resultURL || downloadLock.current || !current()) return;
    downloadLock.current = true; setDownloading(true); setDownloadError("");
    try { await downloadTemplateResult(resultURL, (row?.title || `FlowLight-${task.id}`) + (resultURLs.length > 1 ? `-${resultURLs.indexOf(resultURL) + 1}` : ""), current); }
    catch { if (current()) setDownloadError("下载未能开始，请重试；也可以打开原文件查看。"); }
    finally { downloadLock.current = false; if (current()) setDownloading(false); }
  };

  const hasResult = task?.status === AiTaskStatus.SUCCESS && !!resultURL;
  const resultMedia = task && (row?.mediaType === "video" || task.handler.includes("video")
    ? <video className={css.output} src={resultURL} controls playsInline preload="metadata" onError={() => setMediaError(true)} />
    : <img className={css.output} src={resultURL} alt="生成的同款作品" onError={() => setMediaError(true)} />);
  const resultView = task && <div className={css.result} aria-live="polite">
    <h2 id="task-result-title">{processing ? "你的作品正在生成" : task.status === AiTaskStatus.SUCCESS ? "你的同款，完成了" : "本次生成未完成"}</h2>
    <p className={css.cost}>本次任务 <strong>{task.pointCost} 积分</strong></p>
    {processing ? <><progress aria-label="生成进度" max={100} value={Math.max(0, Math.min(100, task.progress || 0))} /><p className={css.note}>{task.progress || 0}% · 可以离开页面，稍后从生成记录查看。</p></> : hasResult ? <>
      {(!row || loadError) && resultMedia}
      {resultURLs.length > 1 && <div className={css.resultChoices} role="group" aria-label="选择生成结果">{resultURLs.map((url, i) => <button key={url} aria-pressed={url === resultURL} onClick={() => { setSelectedResult(url); setMediaError(false); setDownloadError(""); setShowExample(false); }}>第 {i + 1} 张</button>)}</div>}
      {mediaError && <p className={css.note}>预览暂时无法加载，可以打开原文件查看。</p>}
      <button className={css.primary} disabled={downloading} onClick={() => void download()}>{downloading ? <Loader2 className={css.spin} size={16} /> : <Download size={16} />}{downloading ? "准备下载…" : "下载作品"}</button>
      <a className={css.textLink} href={resultURL} target="_blank" rel="noopener noreferrer">查看原文件 <ArrowUpRight size={16} /></a>
      {downloadError && <p role="alert" className={css.error}>{downloadError}</p>}
    </> : <p role="alert" className={css.error}>{task.errorMsg || "请在生成记录中查看任务详情。"}</p>}
    {pollError && <p className={css.note} role="status">{pollError}</p>}
    {!processing && !loadError && <button className={css.secondary} onClick={() => void reset()}>再次使用这个模板</button>}
  </div>;

  const validQuote = quote?.inputKey === inputKey && ready ? quote : null;
  const outputText = templateOutputText(validQuote?.options || setup?.options);
  const expanded = previewExpanded || !!hasResult;
  return <main className={`${css.page} ${css.workshopPage}`}>
    <div className={css.breadcrumb}><Link href={returnTo}><ArrowLeft size={16} />灵感和模板</Link><Link href="/generation-history">生成记录 <ArrowUpRight size={15} /></Link></div>
    {loadError ? <><div className={css.empty} role="alert"><h1>暂时无法打开模板</h1><p>{loadError}。已提交的任务仍可继续查看。</p><button className={css.secondary} onClick={() => setReload(v => v + 1)}>重试</button><Link className={css.textLink} href="/generation-history">查看生成记录 <ArrowUpRight size={16} /></Link></div>{recovering && <p className={css.note} role="status">正在恢复上次任务…</p>}{error && <p className={css.error} role="alert">{error}</p>}{unresolved && !deletedTaskId && <button className={css.secondary} disabled={recovering} onClick={() => void recover()}>检查任务状态</button>}{deletedTaskId && <button className={css.secondary} onClick={() => void clearDeletedTask()}>清理已移除的任务记录</button>}{resultView}</> : !row ? <div className={css.loading} role="status"><Loader2 className={css.spin} />正在打开模板…</div> : <>
      <header className={css.workshopHeading}><div><h1>{row.title}</h1><p>{row.description}</p></div><span>{row.mediaType === "video" ? "视频" : "图片"}{row.category ? ` / ${row.category}` : ""}</span></header>
      <div className={css.workspace}>
        <section className={css.previewPane} data-expanded={expanded} aria-label={hasResult && !showExample ? "生成结果预览" : "效果预览"}>
          <div className={css.previewToolbar}>{hasResult ? <div className={css.previewSwitch} role="group" aria-label="预览内容"><button aria-pressed={!showExample} onClick={() => setShowExample(false)}>我的作品</button><button aria-pressed={showExample} onClick={() => setShowExample(true)}>模板效果</button></div> : <><span className={css.desktopPreviewLabel}>效果预览</span><button className={css.previewExpand} aria-expanded={expanded} aria-controls="template-preview-content" onClick={() => setPreviewExpanded(v => !v)}>{safeURL(row.coverUrl) && <img src={safeURL(row.coverUrl)} alt="" />}<span>{expanded ? "收起示例，继续选素材" : "查看效果示例"}</span><ChevronDown size={18} /></button></>}<span className={css.previewType}>{row.mediaType === "video" ? <Video size={15} /> : <ImagePlus size={15} />}{row.mediaType === "video" ? "视频模板" : "图片模板"}</span></div>
          <div id="template-preview-content" className={css.preview}>{hasResult && !showExample ? resultMedia : <TemplateMedia key={row.id} row={row} controls width={1200} />}</div>
          <div className={css.previewCaption}><div><strong>{hasResult && !showExample ? "我的同款作品" : row.title}</strong><span>{hasResult && !showExample ? task?.modelName : row.authorName || row.category}</span></div>{safeURL(hasResult && !showExample ? resultURL : row.previewUrl || row.coverUrl) && <a href={safeURL(hasResult && !showExample ? resultURL : row.previewUrl || row.coverUrl)} target="_blank" rel="noopener noreferrer" aria-label={hasResult && !showExample ? "打开完整生成结果" : "打开完整效果预览"}><Maximize2 size={16} /></a>}</div>
          <p className={css.previewNote}>{hasResult && !showExample ? "可打开原文件查看或下载，也可以切换查看模板效果。" : "预览用于展示效果，实际结果会随你的素材变化。"}</p>
        </section>
        <section className={css.uploadPane} aria-labelledby={task ? "task-result-title" : "materials-title"}>
          {task ? resultView : <>
          <div className={css.sectionHeading}><h2 id="materials-title">换上你的素材</h2>{owner && slots.length > 0 && <span className={ready ? css.uploadComplete : ""}>{ready && <Check size={14} />}已上传 {uploadedCount}{slots.every(slot => slot.optional) ? " 个素材" : ` / ${slots.length}`}</span>}</div>
          <p className={css.instructions}>{row.inputHint || "按下方要求上传你自己的素材，其他设置已为你准备好。"}</p>
          <div className={css.recipeSummary}><span>{templateInputs(row)}</span><ArrowUpRight size={15} /><span>生成{row.mediaType === "video" ? "视频" : "图片"}</span></div>
          <p className={css.preflightInfo}>{validQuote ? `成品规格：${templateOutputText(validQuote.options)}` : setup ? `${setup.referenceVideoBilling ? "基础 " : "预计 "}${setup.basePointCost} 积分 · ${templateOutputText(setup.options)}` : setupError || "正在读取成品规格与基础积分…"}</p>
          {setup?.referenceVideoBilling && <p className={css.note}>如使用参考视频，其时长费用会在上传后一起核算。</p>}
          {setupError && <button className={css.textButton} onClick={() => setReload(v => v + 1)}>重新读取规格</button>}
          {!owner ? <div className={css.signIn}><p>{authReady ? "登录后即可上传素材、确认积分并生成。" : "正在确认登录状态…"}</p>{authReady && <Link className={css.primary} href={`/login?redirect=${encodeURIComponent(`/templates/${templateId}?returnTo=${encodeURIComponent(returnTo)}`)}`}>登录并做同款 <ArrowUpRight size={17} /></Link>}</div> : <>
            <div className={`${css.uploads} ${slots.length === 1 ? css.singleUpload : ""}`}>
              {slots.map(slot => { const state = uploads[slot.key]; const file = state?.file; const Icon = slot.kind === "image" ? ImagePlus : slot.kind === "video" ? Video : Music2;
                return <div key={slot.key} className={`${css.uploadItem} ${slot.kind !== "image" ? css.mediaUpload : ""}`}>
                  <div className={css.slotLabel}><span>{slot.label}{slot.optional && <small>（选填）</small>}</span>{file && !locked && <button aria-label={`移除${slot.label}`} disabled={state?.busy} onClick={() => { if (uploadLocks.current.has(slot.key)) return; setUploads(prev => ({ ...prev, [slot.key]: {} })); setQuote(null); }}><X size={16} /></button>}</div>
                  <label className={`${css.dropzone} ${file ? css.filled : ""} ${file && slot.kind === "image" ? css.imageFilled : ""}`} aria-disabled={locked || state?.busy}>
                    <input type="file" aria-label={`上传${slot.label}`} accept={`${slot.kind}/*`} disabled={locked || state?.busy} onChange={e => { void upload(slot.key, slot.kind, e.target.files?.[0]); e.target.value = ""; }} />
                    {state?.busy ? <><Loader2 className={css.spin} size={24} /><span>上传中 {state.progress || 0}%</span></> : file ? <>{slot.kind === "image" && safeURL(file.fileUrl) ? <img src={safeURL(file.fileUrl)} alt={slot.label} /> : <Icon size={24} />}<span className={css.fileCopy}><strong title={file.originalName}>{file.originalName}</strong><small><Check size={12} /> {state?.unverified ? "待核验" : "已上传"}{!locked && " · 点击替换"}</small></span></> : <><span className={css.uploadIcon}><Icon size={24} /></span><span>点击上传{slot.label}<small>使用你有权使用的素材</small></span></>}
                  </label>
                  {file && slot.kind !== "image" && safeURL(file.fileUrl) && (slot.kind === "video" ? <video className={css.referencePlayer} controls preload="metadata" playsInline src={safeURL(file.fileUrl)} /> : <audio className={css.referencePlayer} controls preload="metadata" src={safeURL(file.fileUrl)} />)}
                  <p className={css.fileRule}>{slot.kind === "image" ? "JPG / PNG / WebP 等，不支持 SVG" : slot.kind === "video" ? "MP4 / MOV / WebM 等视频" : "MP3 / WAV / M4A 等音频"} · 单个 ≤ {Math.round((setup?.maxUploadBytes?.[slot.kind] || 50*1024*1024)/1024/1024*10)/10} MB</p>
                  {state?.error && <div role="alert" className={css.error}>{state.error}{state.canRetry && !locked && <button className={css.textButton} onClick={() => void upload(slot.key, slot.kind, retryUploads.current.get(slot.key))}>重试上传</button>}</div>}
                </div>;
              })}
            </div>
            {(draftNotice || (uploadedCount > 0 && draftSaved)) && <p className={css.note} role="status">{draftNotice || "素材草稿已保存在本机，返回时可继续使用。"}</p>}
            {Object.values(uploads).some(value => value.unverified) && <button className={css.secondary} onClick={() => setDraftRetry(v => v + 1)}>重新核验素材</button>}
            {!draftSaved && <p className={css.error} role="status">浏览器未能保存草稿，离开页面前请完成本次操作。</p>}
            {!slots.length && <p className={css.note}>这个模板无需上传，确认积分后即可生成。</p>}
            <div className={css.checkout}>
                <div className={css.cost}><span>本次生成</span><strong>{validQuote ? `${validQuote.pointCost} 积分` : quoteError ? "积分暂不可用" : ready && quoteLoading ? "确认积分中…" : ready ? "准备确认积分…" : "请先补齐素材"}</strong></div>
                <div className={css.quoteDetail}><p>{outputText}</p><p>{validQuote || setup ? `${validQuote?.modelName || setup?.modelName} · 生成 1 ${row.mediaType === "video" ? "段视频" : "张图片"}` : "上传不会扣积分"}</p></div>
                <button className={css.primary} disabled={!validQuote || locked || anyUploading} onClick={() => void generate()}>{sending || recovering ? <Loader2 className={css.spin} size={18} /> : <ArrowUpRight size={18} />}{sending ? "正在提交…" : recovering ? "正在恢复任务…" : "生成同款"}</button>
                <p className={css.note}>上传不会扣积分，点击生成后才提交任务。</p>
                {!!validQuote?.referencePointCost && <p className={css.note}>本次积分已包含参考视频费用 {validQuote.referencePointCost} 积分。</p>}
                {quoteError && <div role="alert" className={css.error}>{quoteError}<button className={css.textButton} onClick={() => setQuoteRetry(v => v + 1)}>重新确认积分</button></div>}
              {error && <p className={css.error} role="alert">{error}</p>}
              {deletedTaskId ? <button className={css.secondary} onClick={() => void clearDeletedTask()}>开始新的模板操作</button> : unresolved && <button className={css.secondary} disabled={recovering} onClick={() => void recover()}><RefreshCw size={16} />检查任务状态</button>}
            </div>
          </>}
          </>}
        </section>
      </div>
    </>}
  </main>;
}
