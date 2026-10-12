"use client";
import { Select } from "./select";
import { ModelIcon } from "./model-icon";
import { AssetThumbnail } from "./asset-thumbnail";
import { TaskMedia } from "./media-preview";
import { isMediaModel } from "@/lib/model-visibility";
import { taskMedia } from "@/lib/media";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, Image as ImageIcon, Video, AudioLines, Box, ScanLine, Plus, X, Wand2, Download, Maximize2, RefreshCw, Loader2, Settings2, Sparkles, ChevronDown } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, Modal, PageHeading } from "./ui";
import { aiApi, uploadFile, type StudioModel } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { englishError } from "@/lib/english";
import { INSPIRATION, modelName, number, date } from "@/lib/brand";
import { buildGenerationInput, estimatedCost, mediaForHandler, modesFor, validateReferences, type MediaType, type Reference, type StudioSettings } from "@/lib/studio";
import { commitAcceptedAiGeneration, isAmbiguousAiCreateCode, recoverableAiGenerations } from "@/lib/ai-generation-idempotency";
import type { AiTaskVO, UpscaleQuoteVO, ReferenceVideoQuoteVO } from "@/types/ai";
import type { PageData } from "@/types/api";
import type { KeyboardEvent } from "react";


const mediaTabs = [{ value: "image", label: "Image", icon: ImageIcon }, { value: "video", label: "Video", icon: Video }, { value: "audio", label: "Audio", icon: AudioLines }, { value: "3d", label: "3D", icon: Box }, { value: "upscale", label: "Enhance", icon: ScanLine }] as const;
const scope = "framelyn:studio";
const emptyReferences: Reference[] = [];
const fpsValues = ["1x", "2x", "3x", "4x", "23.976", "24", "25", "29.97", "30", "48", "50", "59.94", "60", "72", "90", "96", "120", "144"];
const validMedia = (value: string | null): MediaType => mediaTabs.some((tab) => tab.value === value) ? value as MediaType : "image";

function navigateMediaTabs(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
}

export default function Studio() {
  const query = useSearchParams(); const router = useRouter(); const { user, loading: authLoading, refresh: refreshUser } = useAuth();
  const [media, setMedia] = useState<MediaType>(validMedia(query.get("type")));
  const [prompt, setPromptValue] = useState(query.get("prompt") || ""); const [modelId, setModelId] = useState(query.get("model") || "");
  const promptRevision = useRef(0);
  const setPrompt = (value: string) => { promptRevision.current += 1; setPromptValue(value); };
  const [optimizedDraft, setOptimizedDraft] = useState<string | null>(null);
  const optimizationPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [mode, setMode] = useState(query.get("mode") || ""); const [resolution, setResolution] = useState(""); const [ratio, setRatio] = useState(""); const [quality, setQuality] = useState(""); const [duration, setDuration] = useState(""); const [count, setCount] = useState(1);
  const [referenceState, setReferenceState] = useState<{ owner: string; refs: Reference[] }>({ owner: "", refs: [] });
  const refs = referenceState.owner === (user?.id || "") ? referenceState.refs : emptyReferences;
  const setRefs = (next: Reference[] | ((current: Reference[]) => Reference[])) => setReferenceState((previous) => { const owner = user?.id || ""; return { owner, refs: typeof next === "function" ? next(previous.owner === owner ? previous.refs : []) : next }; });
  const [outputFps, setOutputFps] = useState(""); const [upscaleModel, setUpscaleModel] = useState("max");
  const [voice, setVoice] = useState(""); const [lyrics, setLyrics] = useState(""); const [instrumental, setInstrumental] = useState(false); const [enablePbr, setEnablePbr] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [submitting, setSubmitting] = useState(false); const [uploading, setUploading] = useState(false); const [optimizing, setOptimizing] = useState(false);
  const [local, setLocal] = useState<{ owner: string; tasks: AiTaskVO[] }>({ owner: "", tasks: [] }); const [preview, setPreview] = useState<AiTaskVO | null>(null);
  const models = useResource<StudioModel[]>(`/api/market/studio-models?type=${media}`);
  const optimizeCost = useResource<{ cost: number }>("/api/ai/optimize-cost", !!user, user?.id);
  const history = useResource<PageData<AiTaskVO>>(`/api/ai/tasks?pageNum=1&pageSize=24&mediaType=${media === "upscale" ? "video" : media}`, !!user, user?.id || "");
  const availableModels = (models.data || []).filter(isMediaModel);
  const model = availableModels.find((item) => item.id === modelId || item.modelKey === modelId) || availableModels[0] || null;
  const config = model?.config; const availableModes = modesFor(media, model); const activeMode = availableModes.find((item) => item.value === mode)?.value || availableModes[0].value;
  const resolutions = media === "upscale" ? (config?.resolutions?.length ? config.resolutions : ["720p", "1080p", "2k", "4k"]).map((value) => value.trim().toLowerCase()).filter((value) => ["720p", "1080p", "2k", "4k"].includes(value) && !(model?.modelKey === "bytedance/video-upscaler" && value === "720p")) : config?.resolutions || [];
  const choose = (requested: string, choices: string[]) => choices.includes(requested) ? requested : choices[0] || "";
  const selectedResolution = choose(resolution, resolutions); const selectedRatio = choose(ratio, config?.ratios || []); const selectedQuality = choose(quality, config?.qualities || []); const selectedDuration = choose(duration, config?.durations || []);
  const batchOptions = (config?.batchOptions || []).filter((value) => Number.isInteger(value) && value >= 1 && value <= 4);
  const selectedCount = batchOptions.includes(count) ? count : batchOptions[0] || 1;
  const settings: StudioSettings = { media, mode: activeMode, prompt, resolution: selectedResolution, ratio: selectedRatio, quality: selectedQuality, duration: selectedDuration, count: selectedCount, refs, outputFps, upscaleModel, voice, lyrics, instrumental, enablePbr };
  const tasks = useMemo(() => {
    const map = new Map((history.data?.records || []).map((task) => [task.id, task]));
    if (local.owner === user?.id) local.tasks.forEach((task) => map.set(task.id, task));
    return [...map.values()].sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime));
  }, [history.data, local, user?.id]);
  const addTask = useCallback((task: AiTaskVO, owner: string) => setLocal((old) => ({ owner, tasks: [task, ...(old.owner === owner ? old.tasks.filter((item) => item.id !== task.id) : [])] })), []);
  const pendingIds = tasks.filter((task) => task.status === 0).map((task) => task.id).join(",");
  useEffect(() => {
    if (!user?.id || !pendingIds) return;
    const owner = user.id; const controller = new AbortController(); const timers: ReturnType<typeof setTimeout>[] = [];
    const poll = async (id: string) => {
      const response = await aiApi.task(id, controller.signal);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        addTask(response.data, owner);
        if (response.data.status !== 0) { await commitAcceptedAiGeneration(scope, id, owner); void refreshUser(); return; }
      }
      if (response.code === 403 || response.code === 404) return;
      timers.push(setTimeout(() => void poll(id), 2500));
    };
    pendingIds.split(",").forEach((id) => void poll(id));
    return () => { controller.abort(); timers.forEach(clearTimeout); };
  }, [pendingIds, user?.id, addTask, refreshUser]);
  useEffect(() => {
    if (!user?.id) return;
    const owner = user.id; let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const recover = async () => {
      const rows = recoverableAiGenerations(scope, owner);
      let ambiguous = false;
      for (const row of rows) {
        if (!alive) return;
        if (row.taskId) {
          const result = await aiApi.task(row.taskId);
          if (alive && result.success && result.data) addTask(result.data, owner);
          continue;
        }
        if (!row.payload) continue;
        const response = await aiApi.generate({ ...row.payload, clientRequestId: row.clientRequestId }, scope, { requireDurableJournal: true, retainAccepted: true, ownerUserId: owner, recovery: row.recovery });
        if (!alive) return;
        if (response.success && response.data) addTask(response.data, owner);
        else if (isAmbiguousAiCreateCode(response.code)) ambiguous = true;
      }
      if (alive && ambiguous) timer = setTimeout(() => void recover(), 3000);
    };
    void recover(); return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [user?.id, addTask]);
  const sourceVideo = refs.find((ref) => ref.kind === "video")?.url || "";
  const quoteKey = media === "upscale" && user && model && sourceVideo ? `${user.id}|${model.id}|${sourceVideo}|${selectedResolution}|${model.modelKey === "rh-upscale" ? upscaleModel : ""}` : "";
  const [quote, setQuote] = useState<{ key: string; data: UpscaleQuoteVO | null; error: string }>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!quoteKey || !model || !sourceVideo) return;
    let alive = true;
    aiApi.quote(model.modelKey || model.id, sourceVideo, selectedResolution, model.modelKey === "rh-upscale" ? upscaleModel : undefined).then((result) => { if (alive) setQuote({ key: quoteKey, data: result.success ? result.data : null, error: result.success ? "" : result.message }); });
    return () => { alive = false; };
  }, [quoteKey, model, sourceVideo, selectedResolution, upscaleModel]);
  const quoteReady = quoteKey && quote.key === quoteKey && quote.data;
  const referenceVideoUrls = useMemo(() => refs.filter((ref) => ref.kind === "video").map((ref) => ref.url), [refs]);
  const referenceQuoteKey = media === "video" && activeMode === "reference_to_video" && config?.referenceVideoBillingEnabled && referenceVideoUrls.length && user && model ? `${user.id}|${model.id}|${selectedResolution}|${referenceVideoUrls.join("|")}` : "";
  const [referenceQuote, setReferenceQuote] = useState<{ key: string; data: ReferenceVideoQuoteVO | null; error: string }>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!referenceQuoteKey || !model) return;
    let alive = true;
    aiApi.referenceQuote(model.modelKey || model.id, selectedResolution, referenceVideoUrls).then((result) => { if (alive) setReferenceQuote({ key: referenceQuoteKey, data: result.success ? result.data : null, error: result.success ? "" : result.message }); });
    return () => { alive = false; };
  }, [referenceQuoteKey, model, selectedResolution, referenceVideoUrls]);
  const referenceQuoteReady = !referenceQuoteKey || referenceQuote.key === referenceQuoteKey && !!referenceQuote.data;
  const estimate = media === "upscale" ? quoteReady ? quote.data!.pointCost : null : !referenceQuoteReady ? null : estimatedCost(model, settings) + (referenceQuoteKey && referenceQuote.data ? referenceQuote.data.pointCost : 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!user) { router.push("/login?redirect=/studio"); return; }
    setUploading(true); setError("");
    const next: Reference[] = [];
    for (const file of Array.from(files).slice(0, 16)) {
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
      if (!kind || (media === "upscale" && kind !== "video") || ((media === "image" || media === "3d") && kind !== "image")) { setError("Choose a file type supported by this creation mode."); continue; }
      const maxMB = media === "image" ? config?.maxRefImageSizeMB : media === "3d" ? config?.max3DImageSizeMB : 0;
      if (maxMB && file.size > maxMB * 1024 * 1024) { setError(`This model accepts reference files up to ${maxMB} MB.`); continue; }
      const response = await uploadFile(file);
      if (response.success) next.push({ url: response.data.fileUrl, name: file.name, kind }); else setError(response.message);
    }
    if (next.length) {
      setRefs((current) => media === "upscale" || media === "3d" ? next.slice(0, 1) : [...current, ...next]);
      if (media === "image" && activeMode === "text_to_image") setMode("image_to_image");
      if (media === "video" && activeMode === "text_to_video") setMode(next.some((ref) => ref.kind !== "image") ? "reference_to_video" : "image_to_video");
    }
    setUploading(false); if (fileRef.current) fileRef.current.value = "";
  };
  const generate = async () => {
    setError(""); setNotice("");
    if (!user) { router.push("/login?redirect=/studio"); return; }
    if (!model) { setError("Select an available model first."); return; }
    if (media !== "upscale" && !prompt.trim() && !(media === "3d" && refs.length)) { setError("Describe what you would like to create."); return; }
    const referenceError = validateReferences(settings, model); if (referenceError) { setError(referenceError); return; }
    if (!referenceQuoteReady) { setError("Wait for reference-video costs to be verified before generating."); return; }
    if (media === "upscale" && !quoteReady) { setError("Wait for the source video and credit estimate to be verified."); return; }
    const owner = user.id; setSubmitting(true);
    try {
      const response = await aiApi.generate({ handler: activeMode, modelId: model.modelKey || model.id, input: buildGenerationInput(settings, model), entryPoint: "studio" }, scope, { requireDurableJournal: true, retainAccepted: true, dedupeActivePayload: true, ownerUserId: owner, recovery: { media, modelId: model.id, prompt } });
      if (response.success && response.data) { addTask(response.data, owner); setNotice(response.reusedExisting ? "This request is already in progress. Following the original task." : "Your creation is on its way. You can keep working while it processes."); void refreshUser(); }
      else if (isAmbiguousAiCreateCode(response.code)) { setNotice("Your request is being confirmed. Do not submit it again; check Activity or reload to recover this exact request."); }
      else setError(response.message);
    } catch (cause) { setError(englishError(cause instanceof Error ? cause.message : "")); }
    finally { setSubmitting(false); }
  };
  const optimize = async () => {
    if (!user) { router.push("/login?redirect=/studio"); return; }
    if (!prompt.trim() || optimizationPending.current) return;
    if (optimizeCost.loading || !optimizeCost.data) { setError(optimizeCost.error || "Prompt enhancement pricing is still being checked. Try again shortly."); return; }
    const revision = promptRevision.current;
    optimizationPending.current = true;
    setOptimizing(true); setError(""); setOptimizedDraft(null);
    try {
      const response = await aiApi.optimize(prompt);
      if (!mounted.current) return;
      if (response.success && response.data?.prompt?.trim()) {
        if (promptRevision.current === revision) setPrompt(response.data.prompt);
        else setOptimizedDraft(response.data.prompt);
        void refreshUser();
      } else setError(response.message || "No enhanced prompt was returned. Your draft has been kept.");
    } catch (cause) {
      if (mounted.current) setError(englishError(cause instanceof Error ? cause.message : ""));
    } finally {
      optimizationPending.current = false;
      if (mounted.current) setOptimizing(false);
    }
  };
  const visibleTasks = tasks.filter((task) => mediaForHandler(task.handler) === media);
  const maintenance = config?.availabilityStatus === "maintenance";
  return <WorkspaceShell><PageHeading title="Make something yours." description="One idea, a whole world of possibilities." action={<Link href="/explore" className="button small">Find inspiration <ArrowUpRight size={14} /></Link>} /><div className="studio-tabs" role="tablist" aria-label="Creation type" onKeyDown={navigateMediaTabs}>{mediaTabs.map(({ value, label, icon: Icon }) => <button role="tab" id={`studio-tab-${value}`} aria-controls="studio-panel" tabIndex={media === value ? 0 : -1} disabled={uploading} aria-selected={media === value} key={value} className={media === value ? "on" : ""} onClick={() => { if (media === value) return; promptRevision.current += 1; setMedia(value); setMode(""); setRefs([]); setError(""); }}><Icon size={16} />{label}</button>)}</div><div className="studio-layout" id="studio-panel" role="tabpanel" aria-labelledby={`studio-tab-${media}`} tabIndex={0}><section className="composer"><div className="composer-title"><h2>Your starting point</h2><Settings2 size={15} /></div><div className="field"><label htmlFor="studio-model">Model</label>{models.loading ? <Loading label="Finding your models…" /> : <Select id="studio-model" value={model?.id || ""} onValueChange={setModelId} disabled={!availableModels.length} placeholder="Choose a model" options={availableModels.map((item) => ({ value: item.id, label: `${modelName(item)}${item.config?.availabilityStatus === "maintenance" ? " · Maintenance" : ""}`, icon: <ModelIcon model={item} /> }))} />}{models.error && <Alert>{models.error}<button onClick={models.refresh}> Retry</button></Alert>}{!models.loading && !models.error && !model && <p className="small muted">No models are currently published for this format.</p>}</div>{availableModes.length > 1 && <div className="field"><label htmlFor="studio-mode">Creation mode</label><Select id="studio-mode" value={activeMode} onValueChange={setMode} options={availableModes} /></div>}{media !== "upscale" && <div className="field"><div className="prompt-label"><label htmlFor="studio-prompt">Your prompt</label><button onClick={() => void optimize()} disabled={optimizing || !prompt.trim()} title="Prompt enhancement uses your account credits" aria-label="Enhance prompt">{optimizing ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}{optimizeCost.data ? `Enhance · ${number(optimizeCost.data.cost)} credits` : "Enhance"}</button></div><textarea id="studio-prompt" placeholder={media === "audio" ? "A warm, cinematic piano piece with a slow build…" : media === "3d" ? "A sculptural ceramic vase with a flowing silhouette…" : "A quiet place. Unexpected light. Something only you could imagine…"} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={config?.maxPromptChars || 16000} /><div className="prompt-bottom"><span>{prompt.length.toLocaleString()} characters</span><button onClick={() => setPrompt(INSPIRATION[Math.floor(Math.random() * INSPIRATION.length)].prompt)}>Try an idea <Sparkles size={11} /></button></div>{optimizedDraft && <div className="prompt-suggestion"><p role="status">Your draft changed while we were enhancing it. Review the suggestion before replacing your text.</p><textarea aria-label="Enhanced prompt suggestion" readOnly value={optimizedDraft} /><div><button className="button small" onClick={() => { setPrompt(optimizedDraft); setOptimizedDraft(null); }}>Use suggestion</button><button className="button quiet small" onClick={() => setOptimizedDraft(null)}>Keep my draft</button></div></div>}</div>}{media !== "audio" && <div className="field"><span className="field-label">{media === "upscale" ? "Source video" : "Reference assets"}</span><input ref={fileRef} type="file" hidden multiple={media !== "upscale" && media !== "3d"} accept={media === "upscale" ? "video/*" : media === "image" || media === "3d" ? "image/*" : "image/*,video/*,audio/*"} onChange={(event) => void handleUpload(event.target.files)} /><button className="reference-upload" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 size={20} className="spin" /> : <Plus size={20} />}<span>{uploading ? "Uploading your reference…" : media === "upscale" ? "Add a video to enhance" : "Add a reference"}<small>Up to {config?.maxRefImageSizeMB || 50} MB per file</small></span></button>{refs.length > 0 && <div className="reference-list">{refs.map((ref, index) => <div key={`${ref.url}-${index}`}>{ref.kind === "image" ? <img src={ref.url} alt={ref.name} /> : ref.kind === "video" ? <Video size={17} /> : <AudioLines size={17} />}<span title={ref.name}>{ref.name}</span><button className="icon-button" aria-label={`Remove ${ref.name}`} onClick={() => setRefs((current) => current.filter((_, at) => at !== index))}><X size={13} /></button></div>)}</div>}</div>}<details className="output-options" open={media === "upscale"} hidden={!resolutions.length && !config?.ratios?.length && !(media === "video" && config?.durations?.length) && !(media === "image" && (config?.qualities?.length || batchOptions.length))}><summary>Output settings <ChevronDown size={15} aria-hidden="true" /></summary><div className="field-row">{!!resolutions.length && <div className="field"><label htmlFor="studio-resolution">{media === "upscale" ? "Target resolution" : "Resolution"}</label><Select id="studio-resolution" value={selectedResolution} onValueChange={setResolution} options={resolutions.map((value) => ({ value, label: value.toUpperCase() }))} /></div>}{media !== "upscale" && !!config?.ratios?.length && <div className="field"><label htmlFor="studio-ratio">Aspect ratio</label><Select id="studio-ratio" value={selectedRatio} onValueChange={setRatio} options={config.ratios.map((value) => ({ value, label: value }))} /></div>}{media === "video" && !!config?.durations?.length && <div className="field"><label htmlFor="studio-duration">Duration</label><Select id="studio-duration" value={selectedDuration} onValueChange={setDuration} options={config.durations.map((value) => ({ value, label: `${value.replace(/s$/, "")} seconds` }))} /></div>}{media === "image" && !!config?.qualities?.length && <div className="field"><label htmlFor="studio-quality">Quality</label><Select id="studio-quality" value={selectedQuality} onValueChange={setQuality} options={config.qualities.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} /></div>}</div>{media === "image" && !config?.hideBatchCount && !!batchOptions.length && <div className="field"><label htmlFor="studio-count">Number of images</label><Select id="studio-count" value={String(selectedCount)} onValueChange={(value) => setCount(Number(value))} options={batchOptions.map((value) => ({ value: String(value), label: `${value} ${value === 1 ? "image" : "images"}` }))} /></div>}</details>{media === "upscale" && model?.modelKey === "rh-upscale" && <><div className="field"><label htmlFor="studio-upscale-level">Enhancement level</label><Select id="studio-upscale-level" value={upscaleModel} onValueChange={setUpscaleModel} options={["max", "high", "medium", "low"].map((value) => ({ value, label: value === "max" ? "Maximum" : value.charAt(0).toUpperCase() + value.slice(1) }))} /></div><div className="field"><label htmlFor="studio-fps">Output frame rate</label><Select id="studio-fps" value={outputFps} onValueChange={setOutputFps} options={[{ value: "", label: "Model default" }, ...fpsValues.map((value) => ({ value, label: value === "1x" ? "Keep original frame rate" : value.endsWith("x") ? `${value} interpolation` : `${value} fps` }))]} /></div></>}{media === "audio" && <details className="advanced-options"><summary>Audio options</summary><div className="field"><label htmlFor="studio-voice">Voice ID (speech models)</label><input id="studio-voice" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="Use the model default" /></div><div className="field"><label htmlFor="studio-lyrics">Lyrics (music models)</label><textarea id="studio-lyrics" value={lyrics} onChange={(event) => setLyrics(event.target.value)} placeholder="Optional lyrics for compatible music models" /></div><label className="check-row"><input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} />Instrumental music</label></details>}{media === "3d" && <label className="check-row"><input type="checkbox" checked={enablePbr} onChange={(event) => setEnablePbr(event.target.checked)} />PBR materials</label>}{maintenance && <Alert>This model is under maintenance. Choose another available model.</Alert>}{quoteKey && quote.key === quoteKey && quote.error && <Alert>{quote.error}</Alert>}{referenceQuoteKey && referenceQuote.key === referenceQuoteKey && referenceQuote.error && <Alert>{referenceQuote.error}</Alert>}{error && <Alert>{error}</Alert>}{notice && <Alert success>{notice}</Alert>}<div className="generation-cost"><span>{media === "upscale" ? "Verified estimate" : "Estimated credits"}</span><strong>{model ? estimate === null ? "Verifying…" : `${number(estimate)} credits` : "—"}</strong></div><button className="button primary generate-button" onClick={() => void generate()} disabled={authLoading || submitting || uploading || models.loading || !model || maintenance || !referenceQuoteReady || (!!user && media === "upscale" && !quoteReady)}>{submitting ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}{submitting ? "Confirming request…" : !user ? "Sign in to create" : media === "upscale" ? "Enhance video" : "Generate"}{!submitting && <ArrowRight size={16} />}</button><p className="generation-footnote">Credits are confirmed by the service when you submit.</p></section><section className="studio-results"><div className="results-header"><div><h2>{pendingIds ? "Ideas in motion." : "Your creative space."}</h2><span>{visibleTasks.length ? `${visibleTasks.length} recent creations` : "Start a new story."}</span></div><button className="icon-button" onClick={history.refresh} aria-label="Refresh recent creations"><RefreshCw size={16} /></button></div>{history.loading && <Loading label="Opening your recent creations…" />}{history.error && <Alert>{history.error}<button onClick={history.refresh}> Retry</button></Alert>}{visibleTasks.length ? <div className="result-grid">{visibleTasks.map((task) => <TaskCard key={task.id} task={task} onPreview={() => setPreview(task)} onReuse={() => { const input = typeof task.input === "string" ? (() => { try { return JSON.parse(task.input); } catch { return {}; } })() : task.input; setPrompt(typeof input?.prompt === "string" ? input.prompt : ""); if (task.modelId) setModelId(task.modelId); }} onCancel={async () => { const response = await aiApi.cancel(task.id); if (response.success) { history.refresh(); const result = await aiApi.task(task.id); if (result.success && user) addTask(result.data, user.id); void refreshUser(); } else setError(response.message); }} />)}</div> : !history.loading && <><EmptyState title="What if you tried something new?" description="Add your idea on the left. Your finished creations and tasks will appear here." /><div className="studio-inspiration"><div><h3>A little inspiration</h3><Link href="/explore">Explore more <ArrowUpRight size={13} /></Link></div><div>{INSPIRATION.slice(0, 3).map((item) => <button key={item.id} onClick={() => { setPrompt(item.prompt); setMedia("image"); setMode("text_to_image"); }}><img src={item.src} alt={item.title} /><span>{item.category}<ArrowUpRight size={13} /></span></button>)}</div><p>Photographic references to spark your next prompt.</p></div></> }</section></div>{preview && <Modal title={preview.modelName || "Your creation"} onClose={() => setPreview(null)}><TaskMedia task={preview} /></Modal>}</WorkspaceShell>;
}
function TaskCard({ task, onPreview, onReuse, onCancel }: { task: AiTaskVO; onPreview: () => void; onReuse: () => void; onCancel: () => Promise<void> }) {
  const kind = mediaForHandler(task.handler); const media = taskMedia(task); const url = media.urls[0]; const Icon = mediaTabs.find((tab) => tab.value === kind)?.icon || ImageIcon;
  return <article className="task-card"><div className="task-visual">{task.status === 0 ? <div className="task-processing"><Loader2 size={24} className="spin" /><strong>Creating your {kind === "upscale" ? "video" : kind}…</strong><span>You can keep working.</span>{task.progress > 0 && <progress max={100} value={task.progress} aria-label="Task progress" />}<button className="button small" onClick={() => void onCancel()}>Cancel task</button></div> : task.status === 2 || task.status === 3 ? <div className="task-failed"><Icon size={27} /><strong>{task.status === 3 ? "Cancelled" : "Not quite this time."}</strong><p>{englishError(task.errorMsg, "This creation could not be completed.")}</p><button className="button small" onClick={onReuse}>Use this prompt <RefreshCw size={12} /></button></div> : <button className="task-image" onClick={onPreview} aria-label="Preview creation"><AssetThumbnail media={media} /></button>}{task.status === 1 && <div className="task-overlay"><button className="icon-button" aria-label="Preview creation" onClick={onPreview}><Maximize2 size={15} /></button>{url && <a className="icon-button" aria-label="Open original media" href={url} target="_blank" rel="noreferrer"><Download size={15} /></a>}</div>}</div><div className="task-caption"><strong>{task.modelName && !/[\p{Script=Han}]/u.test(task.modelName) ? task.modelName : "AI creation"}</strong><span>{date(task.createTime)}</span><small>{number(task.pointCost)} credits</small></div></article>;
}
