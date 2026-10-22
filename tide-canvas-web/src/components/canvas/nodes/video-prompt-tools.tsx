"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover } from "@mantine/core";
import { ClipboardPlus, Copy, Languages, Loader2, SlidersHorizontal, Zap } from "lucide-react";
import { aiApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { toast } from "@/components/shared/toast";
import { copyText } from "@/lib/clipboard";
import { canApplyVideoPromptResult, videoPromptJobs } from "./video-prompt-job";
import styles from "./styles/parameter-dropdown.module.css";

interface Props {
  nodeId: string;
  prompt: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  excludeText: string;
  onExcludeTextChange: (value: string) => void;
  includeContext: boolean;
  onIncludeContextChange: (value: boolean) => void;
  onCopy: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

type Tool = "optimize" | "translate" | "advanced";

export function VideoPromptTools({ nodeId, prompt, disabled, onChange, excludeText, onExcludeTextChange, includeContext, onIncludeContextChange, onCopy, onBusyChange }: Props) {
  const [open, setOpen] = useState<Tool | null>(null);
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [cost, setCost] = useState<number | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costRetry, setCostRetry] = useState(0);
  const projectId = useCanvasStore((state) => state.currentProjectId) || "";
  const job = useSyncExternalStore(videoPromptJobs.subscribe, () => videoPromptJobs.get(projectId, nodeId), () => null);
  const busy = job?.state === "running";
  const mounted = useRef(false);
  const latest = useRef({ nodeId, prompt, onChange, onBusyChange });
  useLayoutEffect(() => { latest.current = { nodeId, prompt, onChange, onBusyChange }; }, [nodeId, prompt, onChange, onBusyChange]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const changeOpen = (next: Tool | null) => {
    if (next && next !== "advanced" && next !== open) { setCost(null); setCostLoading(true); }
    setOpen(next);
  };

  useEffect(() => {
    if (!open || open === "advanced") return;
    let active = true;
    void aiApi.optimizeCost().then((result) => {
      if (!active) return;
      const next = result.data?.cost;
      setCost(result.success && typeof next === "number" && Number.isFinite(next) && next >= 0 ? next : null);
    }).catch(() => {
      if (active) setCost(null);
    }).finally(() => {
      if (active) setCostLoading(false);
    });
    return () => { active = false; };
  }, [open, costRetry]);

  const applyTool = async (action: "optimize" | "translate") => {
    if (disabled || busy || !prompt.trim() || cost == null || costLoading) return;
    const projectId = useCanvasStore.getState().currentProjectId || "";
    const original = prompt;
    const requestNodeId = nodeId;
    const currentNode = useCanvasStore.getState().nodes.find((node) => node.id === requestNodeId);
    if (!projectId || !currentNode || (currentNode.prompt || "") !== original || currentNode.status === "generating") return;
    const request = videoPromptJobs.begin(projectId, requestNodeId, original);
    if (!request) return;
    const currentTarget = () => {
      const state = useCanvasStore.getState();
      const node = state.nodes.find((item) => item.id === requestNodeId);
      return canApplyVideoPromptResult(request, state.currentProjectId || "", node) ? node : undefined;
    };
    latest.current.onBusyChange?.(true);
    try {
      const result = await aiApi.optimizePrompt(original, action === "translate"
        ? { action: "translate", targetLanguage: language }
        : { action: "optimize" });
      if (!result.success || !result.data?.prompt?.trim()) {
        if (useCanvasStore.getState().currentProjectId === projectId) toast.error(result.message || (action === "translate" ? "翻译失败，请重试" : "优化失败，请重试"));
        return;
      }
      const target = currentTarget();
      if (!target) {
        videoPromptJobs.save(request, result.data.prompt);
        if (useCanvasStore.getState().currentProjectId === projectId) toast.info("提示词已变化，AI 结果已保留，可在高级设置中复制");
        return;
      }
      if (mounted.current && latest.current.nodeId === requestNodeId) latest.current.onChange(result.data.prompt);
      else useCanvasStore.getState().updateNode(requestNodeId, {
        prompt: result.data.prompt,
        ...(target.status === "error" ? { status: target.videoSrc ? "success" : "idle" } : {}),
      });
      if (mounted.current && latest.current.nodeId === requestNodeId) setOpen(null);
      toast.success(action === "translate" ? "提示词已翻译" : "提示词已优化");
    } catch {
      if (useCanvasStore.getState().currentProjectId === projectId) toast.error(action === "translate" ? "翻译失败，请重试" : "优化失败，请重试");
    } finally {
      videoPromptJobs.finish(request);
    }
  };

  const tools = [
    { key: "optimize" as const, label: "提示词优化", Icon: ClipboardPlus },
    { key: "translate" as const, label: "翻译提示词", Icon: Languages },
    { key: "advanced" as const, label: "高级设置", Icon: SlidersHorizontal },
  ];

  return <>
    {tools.map(({ key, label, Icon }) => <Popover key={key} opened={open === key} onChange={(value) => changeOpen(value ? key : null)}
      position="top-end" offset={8} width={344} withinPortal floatingStrategy="fixed" zIndex={130}
      radius={12} shadow="none" trapFocus returnFocus middlewares={{ flip: true, shift: { padding: 12, crossAxis: true } }}
      clickOutsideEvents={["pointerdown"]} transitionProps={{ duration: 100, transition: "fade" }}>
      <Popover.Target>
        <button type="button" className="image-composer-icon" title={label} aria-label={label}
          aria-expanded={open === key} aria-haspopup="dialog" disabled={disabled || busy}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(null); } }}
          onMouseDown={(event) => event.stopPropagation()} onClick={() => changeOpen(open === key ? null : key)}>
          {busy && key === "optimize" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Icon size={14} aria-hidden />}
        </button>
      </Popover.Target>
      <Popover.Dropdown className={styles.panel} role="dialog" aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setOpen(null); }}>
        <h3 className="text-[13px] font-medium text-popover-foreground">{label}</h3>
        {key === "advanced" ? <div className="mt-4 space-y-4">
          <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-popover-foreground">
            <input type="checkbox" className="mt-1 accent-current" checked={includeContext} disabled={disabled || busy}
              onChange={(event) => onIncludeContextChange(event.target.checked)} />
            <span>附加角色与场景设定<span className="block text-[11px] text-muted-foreground">将已连接角色、场景的文字设定加入生成描述。</span></span>
          </label>
          <label className="block text-xs text-popover-foreground">避免出现的内容
            <textarea value={excludeText} disabled={disabled || busy} onChange={(event) => onExcludeTextChange(event.target.value)}
              rows={3} placeholder="例如：画面抖动、模糊、字幕"
              className="mt-2 block w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 text-xs leading-5 outline-none focus-visible:border-[var(--canvas-input-focus-border)]" />
          </label>
          <p className="text-[11px] leading-4 text-muted-foreground">这些内容会作为补充要求加入提示词。</p>
          <button type="button" className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            disabled={!prompt.trim()} onClick={() => { void onCopy(); }}><Copy size={14} />复制提示词</button>
          {job?.state === "saved" && job.result && <button type="button"
            className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-popover-foreground hover:bg-muted"
            onClick={async () => { if (await copyText(job.result!)) toast.success("已复制上次 AI 结果"); else toast.error("复制失败，请重试"); }}>
            <Copy size={14} />复制上次 AI 结果</button>}
        </div> : <div className="mt-3 space-y-4">
          <p className="text-xs leading-5 text-muted-foreground">{key === "optimize"
            ? "保留原意，补充主体、镜头和画面细节。优化结果将替换当前提示词。"
            : "翻译提示词并保留素材引用与参数。翻译结果将替换当前提示词。"}</p>
          {key === "translate" && <div className="grid grid-cols-2 gap-2" aria-label="目标语言">
            {([{ value: "en", label: "英语" }, { value: "zh", label: "简体中文" }] as const).map((item) =>
              <button key={item.value} type="button" aria-pressed={language === item.value} disabled={busy}
                className={`${styles.segmentButton} ${language === item.value ? styles.segmentButtonActive : ""}`}
                onClick={() => setLanguage(item.value)}>{item.label}</button>)}
          </div>}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
              {costLoading ? <><Loader2 size={13} className="animate-spin" />获取费用中</>
                : cost != null ? <><Zap size={13} />本次 {cost} 积分</>
                  : <button type="button" className="underline underline-offset-4" onClick={() => { setCostLoading(true); setCostRetry((value) => value + 1); }}>费用获取失败，重试</button>}
            </span>
            <button type="button" disabled={disabled || busy || !prompt.trim() || cost == null || costLoading}
              className="flex h-8 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-xs text-background disabled:cursor-default disabled:opacity-40"
              onClick={() => { void applyTool(key); }}>
              {busy && <Loader2 size={13} className="animate-spin" />}{key === "translate" ? "翻译并应用" : "优化并应用"}
            </button>
          </div>
          {!prompt.trim() && <p className="text-xs text-muted-foreground">请先输入视频描述。</p>}
        </div>}
      </Popover.Dropdown>
    </Popover>)}
  </>;
}
