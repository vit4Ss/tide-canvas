"use client";
/* eslint-disable @next/next/no-img-element -- Generated cover URLs use the existing storage service. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { aiApi } from "@/lib/api";
import { commitAcceptedAiGeneration, isAmbiguousAiCreateCode, recoverableAiGenerations } from "@/lib/ai-generation-idempotency";
import { buildTemplateCoverPrompt, canFillTemplateCover, coverModelConfig, templateCoverInput, templateCoverModels, templateCoverResult } from "@/lib/template-cover";
import { resolveImageToolPointCost } from "@/lib/price-matrix";
import { useAuthStore } from "@/stores/use-auth-store";
import { AiTaskStatus, type AiGenerateInput, type AiModelVO, type AiTaskVO } from "@/types/ai";
import type { StudioTemplateSave } from "@/lib/studio-template-api";
import { PopoverSelect } from "@/components/shared/popover-select";
import css from "./template-cover-ai.module.css";

type Props = {
  scope: string; template: StudioTemplateSave; savedCoverUrl: string; disabled: boolean; open: boolean;
  onApply: (url: string, taskId: string, owner: string) => void;
  onClose: () => void; onBusyChange: (busy: boolean) => void;
  onStatusChange: (message: string) => void;
};

export function TemplateCoverAI(props: Props) {
  const owner = useAuthStore(s => s.user?.id || "");
  return <CoverSession key={`${owner}:${props.scope}`} {...props} owner={String(owner)} />;
}

function CoverSession({ scope, template, savedCoverUrl, disabled, open, owner, onApply, onClose, onBusyChange, onStatusChange }: Props & {owner: string}) {
  const [models,setModels] = useState<AiModelVO[]>([]);
  const [modelId,setModelId] = useState("");
  const [loading,setLoading] = useState(true);
  const [modelError,setModelError] = useState("");
  const [retry,setRetry] = useState(0);
  const [customPrompt,setPrompt] = useState<string | null>(null);
  const prompt = customPrompt ?? buildTemplateCoverPrompt(template);
  const [task,setTask] = useState<AiTaskVO | null>(null);
  const [busy,setBusy] = useState(false);
  const [recovering,setRecovering] = useState(true);
  const [unresolved,setUnresolved] = useState(false);
  const [error,setError] = useState("");
  const [sourceTitle,setSourceTitle] = useState(template.title);
  const [broken,setBroken] = useState(false);
  const [pollRetry,setPollRetry] = useState(0);
  const alive = useRef(true), lock = useRef(false), ownBusy = useRef(false);
  const originalCover = useRef<unknown>(undefined), filledTask = useRef("");
  const restoredSavedCover = useRef<unknown>(undefined), sessionIntent = useRef(false);
  const root = useRef<HTMLElement>(null);
  const current = useCallback(() => alive.current && !!owner && String(useAuthStore.getState().user?.id || "") === owner,[owner]);
  const updateBusy = useCallback((value: boolean) => { ownBusy.current = value; setBusy(value); onBusyChange(value); },[onBusyChange]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if(ownBusy.current) onBusyChange(false); };
  },[onBusyChange]);
  useEffect(() => { if(open)root.current?.scrollIntoView({block:"start"}); },[open]);
  useEffect(() => {
    if(!open)return;
    let stopped = false;
    void Promise.resolve().then(async () => {
      if(stopped)return;
      setLoading(true);setModelError("");
      const response=await aiApi.listModels();
      if(stopped)return;
      if(response.success && Array.isArray(response.data))setModels(templateCoverModels(response.data));
      else setModelError(response.message || "图片模型读取失败，请重试");
      setLoading(false);
    });
    return () => {stopped=true;};
  },[retry,open]);
  const selected = modelId ? models.find(m=>m.modelId===modelId) : models[0];
  const missingModel = !!modelId && !selected;
  const input = selected ? templateCoverInput(selected,prompt) : null;
  const cost = selected && input ? resolveImageToolPointCost(coverModelConfig(selected),input,selected.pointCost) : null;
  const resultURL = task?.status===AiTaskStatus.SUCCESS ? templateCoverResult(task) : "";
  const terminal = !!task && task.status!==AiTaskStatus.PROCESSING;
  const taskId = task?.id;
  const taskStatus = task?.status;
  const applied = !!resultURL && template.coverUrl === resultURL;

  useEffect(() => {
    if(!resultURL || !taskId || disabled || unresolved || !current() || filledTask.current===taskId)return;
    filledTask.current=taskId;
    if(applied || canFillTemplateCover(template.coverUrl,originalCover.current,template.title,sourceTitle,restoredSavedCover.current))onApply(resultURL,taskId,owner);
  },[resultURL,taskId,disabled,unresolved,current,applied,template.coverUrl,template.title,sourceTitle,onApply,owner]);
  useEffect(() => {
    onStatusChange(recovering ? "正在检查上次封面任务…" : error ? "封面任务需检查，请展开 AI 封面面板。" : resultURL ? (applied ? "" : "封面已生成；当前封面或名称有修改，请展开面板选择是否采用。") : taskStatus===AiTaskStatus.PROCESSING ? "封面正在生成，完成后自动填入。收起面板也会继续查询。" : "");
  },[recovering,error,resultURL,applied,taskStatus,onStatusChange]);

  const receive = useCallback((value: AiTaskVO) => {
    if(!current())return;
    setTask(value);setUnresolved(false);setBroken(false);
    if(value.status===AiTaskStatus.PROCESSING){updateBusy(true);setPollRetry(v=>v+1);return;}
    updateBusy(false);
    void useAuthStore.getState().fetchUser(true);
    if(value.status===AiTaskStatus.SUCCESS){
      if(!templateCoverResult(value))setError("任务已完成但没有可用图片，请从生成记录核查。");
    } else setError(value.errorMsg || "封面生成未完成，可以查看生成记录后重试。");
  },[current,updateBusy]);

  const recover = useCallback(async () => {
    if(lock.current || !current()){setRecovering(false);return;}
    lock.current=true;updateBusy(true);setRecovering(true);setError("");
    try {
      const previous=recoverableAiGenerations(scope,owner).at(-1);
      if(!previous){updateBusy(false);setUnresolved(false);return;}
      const title=(previous.recovery as {title?: string}|undefined)?.title;
      if(!sessionIntent.current){
        originalCover.current=(previous.recovery as {coverUrl?: unknown}|undefined)?.coverUrl;
        restoredSavedCover.current=(previous.recovery as {savedCoverUrl?: unknown}|undefined)?.savedCoverUrl;
        sessionIntent.current=true;
      }
      if(typeof title==="string")setSourceTitle(title);
      if(previous.payload?.input && typeof previous.payload.input.prompt==="string")setPrompt(previous.payload.input.prompt);
      if(previous.payload?.modelId)setModelId(previous.payload.modelId);
      const response = previous.taskId ? await aiApi.getTask(previous.taskId,AbortSignal.timeout(15000)) : previous.payload ? await aiApi.generateIdempotent({...previous.payload,clientRequestId:previous.clientRequestId},scope,{requireDurableJournal:true,retainAccepted:true,ownerUserId:owner,dedupeActivePayload:true,recovery:previous.recovery}) : null;
      if(!current())return;
      if(response?.success && response.data?.id)receive(response.data);
      else {
        const remains=recoverableAiGenerations(scope,owner).length>0;
        setUnresolved(remains);updateBusy(false);
        setError(response?.message || "暂时无法确认上次封面任务，请检查任务状态，避免重复扣费。");
        if(previous.taskId && response?.code===404) {await commitAcceptedAiGeneration(scope,previous.taskId,owner);setUnresolved(false);setTask(null);setError("上次封面任务已被移除，可以重新生成。");}
      }
    } catch {if(current()){setUnresolved(true);updateBusy(false);setError("任务状态暂时无法确认，请稍后重试。");}}
    finally {lock.current=false;if(current())setRecovering(false);}
  },[current,owner,scope,receive,updateBusy]);
  useEffect(()=>{void Promise.resolve().then(recover);},[recover]);

  useEffect(()=>{
    if(!taskId || taskStatus!==AiTaskStatus.PROCESSING)return;
    let stopped=false;const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;const started=Date.now();
    const poll=async()=>{
      const response=await aiApi.getTask(taskId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
      if(stopped || !current())return;
      if(response.success && response.data){
        setTask(response.data);
        if(response.data.status!==AiTaskStatus.PROCESSING){setError("");receive(response.data);return;}
      } else if(response.code===403 || response.code===404){
        updateBusy(false);setError(response.message || "暂时无法读取封面任务，请检查任务状态。");setUnresolved(true);return;
      }
      if(Date.now()-started>=5*60_000){updateBusy(false);setError("任务仍在处理，稍后可继续查询；不会自动重新生成。");return;}
      timer=setTimeout(poll,1500);
    };
    timer=setTimeout(poll,500);
    return()=>{stopped=true;clearTimeout(timer);controller.abort();};
  },[taskId,taskStatus,current,receive,updateBusy,pollRetry]); // polling does not submit or cancel a paid task

  const generate=async()=>{
    if(disabled || busy || recovering || unresolved || lock.current || !selected || !input || !prompt.trim() || !current())return;
    // A recoverable request always takes precedence over a fresh paid click.
    if(!task && recoverableAiGenerations(scope,owner).length){void recover();return;}
    lock.current=true;updateBusy(true);setError("");setBroken(false);
    try{
      if(task){if(!terminal)return;await commitAcceptedAiGeneration(scope,task.id,owner);}
      setTask(null);setSourceTitle(template.title);originalCover.current=template.coverUrl;restoredSavedCover.current=undefined;sessionIntent.current=true;filledTask.current="";
      const payload:AiGenerateInput={handler:"text_to_image",modelId:selected.modelId,entryPoint:"studio",targetType:"image",input};
      const response=await aiApi.generateIdempotent(payload,scope,{requireDurableJournal:true,retainAccepted:true,ownerUserId:owner,dedupeActivePayload:true,recovery:{title:template.title,coverUrl:template.coverUrl,savedCoverUrl}});
      if(!current())return;
      if(response.success && response.data?.id)receive(response.data);
      else{setUnresolved(isAmbiguousAiCreateCode(response.code));updateBusy(false);setError(response.message || "封面未能提交，请重试。");}
    }catch{if(current()){setUnresolved(true);updateBusy(false);setError("提交结果暂时无法确认，请检查任务状态。");}}
    finally{lock.current=false;}
  };
  const frozen=busy || recovering || unresolved || (!!task && !terminal);
  return <section ref={root} hidden={!open} className={css.panel} aria-label="AI 生成模板封面">
    <header><div><h3><Sparkles size={16}/>AI 生成封面</h3><p>生成成功后自动填入封面，保存模板后生效。</p></div><button type="button" className="adm-btn ghost small" aria-label={busy ? "稍后查看封面任务" : "收起 AI 生成封面"} onClick={onClose}><X size={16}/></button></header>
    <div className={css.grid}><div>
      {modelError ? <p role="alert">{modelError} <button type="button" className="adm-btn ghost small" disabled={busy} onClick={()=>setRetry(v=>v+1)}>重新读取图片模型</button></p> : <>
        <label className={css.label}>封面图片模型</label>
        <PopoverSelect label="封面图片模型" className={css.select} menuClassName="admin-body" disabled={disabled || frozen || loading || !models.length} value={selected?.modelId || modelId} options={[...models.map(m=>({value:m.modelId,label:m.name})),...(missingModel ? [{value:modelId,label:loading ? "正在读取原模型…" : `${task?.modelName || modelId}（当前不可用）`,disabled:true}] : [])]} onChange={setModelId}/>
        {missingModel && !loading && <p className={css.error} role="alert">原图片模型已不可用，请重新选择后再生成；已有封面仍可采用。</p>}
        {loading ? <p role="status">正在读取图片模型…</p> : !models.length ? <p role="alert">暂无可用文生图模型，请先在模型管理上架图片模型。</p> : <p className={css.note}>{[input?.aspectRatio ? `${input.aspectRatio} 比例` : "模型默认比例",input?.resolution,input?.quality,"1 张图片"].filter(Boolean).join(" · ")}</p>}
      </>}
      <label className={css.label}>封面画面描述<textarea aria-label="封面画面描述" rows={6} maxLength={4000} value={prompt} disabled={disabled || frozen} onChange={e=>setPrompt(e.target.value)}/></label>
      <button type="button" className="adm-btn ghost small" disabled={disabled || frozen} onClick={()=>setPrompt(null)}>根据当前模板重新填写</button>
      <p className={css.note}>仅生成图片，不生成视频。会扣除当前账号积分；封面不作为用户生成时的参考素材。</p>
    </div><div className={css.result}>
      {sourceTitle && sourceTitle!==template.title && <p className={css.note}>恢复的封面来自「{sourceTitle}」，请核对后再采用。</p>}
      {resultURL ? <><img src={resultURL} alt="AI 生成的模板封面" onError={()=>setBroken(true)} onLoad={()=>setBroken(false)}/>{broken && <p role="alert">图片暂时无法加载，请打开原图核查后再保存模板。</p>}<a href={resultURL} target="_blank" rel="noopener noreferrer">查看封面原图</a><p>本次任务 {task?.pointCost} 积分</p>{applied ? <p role="status">已填入封面，请保存模板。</p> : <><p className={css.note}>已保留你修改的封面。需要使用生成结果时，再点击采用。</p><button type="button" className="adm-btn" disabled={disabled || busy || broken} onClick={()=>{if(current() && task)onApply(resultURL,task.id,owner);}}>采用这张封面</button></>}</> : <div className={css.placeholder}>{busy ? <Loader2 size={22} className={css.spin}/> : <Sparkles size={22}/>}<span>{recovering ? "正在恢复封面任务…" : task?.status===AiTaskStatus.PROCESSING ? "封面正在生成" : "生成后在这里预览"}</span></div>}
      {task?.status===AiTaskStatus.PROCESSING && <progress aria-label="封面生成进度" max={100} value={Math.max(0,Math.min(100,task.progress||0))}/>}
    </div></div>
    {error && <p className={css.error} role="alert">{error}</p>}
    <footer><span>{terminal ? "重新生成会产生新的积分消耗" : cost===null ? "选择图片模型后显示预计积分" : `预计 ${cost} 积分，实际以后端计费为准`}</span>
      {unresolved ? <button type="button" className="adm-btn" disabled={recovering || disabled} onClick={()=>void recover()}>检查封面任务状态</button> : task?.status===AiTaskStatus.PROCESSING ? <button type="button" className="adm-btn ghost" disabled={busy || disabled} onClick={()=>{updateBusy(true);setError("");setPollRetry(v=>v+1);}}>继续查询封面</button> : <button type="button" className="adm-btn" disabled={disabled || frozen || loading || !!modelError || !selected || !prompt.trim()} onClick={()=>void generate()}><Sparkles size={15}/>{task ? "重新生成封面" : "生成封面"}{cost!==null ? ` · 约 ${cost} 积分` : ""}</button>}
    </footer>
    {busy && <p className={css.note}>可以收起面板继续编辑，任务完成后会自动填入。关闭整个编辑窗口后，再次编辑此模板也会恢复查询。</p>}
  </section>;
}
