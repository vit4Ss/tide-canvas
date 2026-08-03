"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Loader2, Sparkles, X } from "lucide-react";
import { SkillPicker } from "@/components/skill/skill-picker";
import { SkillRunPanel } from "@/components/skill/skill-run-panel";
import { SkillInputFields } from "@/components/skill/skill-input-fields";
import { toast } from "@/components/shared/toast";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { defaultSkillInputValues, validateSkillRunInputValues } from "@/lib/skill-api";
import { skillRunApi } from "@/lib/skill-run-api";
import { requestCanvasSave } from "@/lib/canvas-save";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { useCanvasNodeFeatures } from "@/stores/use-canvas-node-config-store";
import { NodeChrome } from "../nodes/base/node-chrome";
import { isSkillRunActive, type SkillRunArtifactVO, type SkillRunVO } from "@/types/skill-run";
import type { SkillVO } from "@/types/skill";
import { buildCanvasSkillRunInput, resolveCanvasSkillSources } from "./canvas-skill-input";
import { buildSkillArtifactNodes } from "./materialize-artifacts";
import { useSkillRuns } from "./use-skill-runs";

export interface CanvasSkillLaunchRequest {
  triggerNodeId?: string;
  sourceNodeIds?: string[];
}

interface CanvasSkillRunUIState {
  pickerOpen: boolean;
  request: CanvasSkillLaunchRequest;
  open: (request?: CanvasSkillLaunchRequest) => void;
  closePicker: () => void;
}

const useCanvasSkillRunUI = create<CanvasSkillRunUIState>((set) => ({
  pickerOpen: false,
  request: {},
  open: (request = {}) => set({ pickerOpen: true, request }),
  closePicker: () => set({ pickerOpen: false }),
}));

export function openCanvasSkillRunLauncher(request: CanvasSkillLaunchRequest = {}) {
  useCanvasSkillRunUI.getState().open(request);
}

function parseRunInput(run: SkillRunVO) {
  if (!run.input) return undefined;
  if (typeof run.input === "string") {
    try {
      const parsed: unknown = JSON.parse(run.input);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
  return run.input as Record<string, unknown>;
}

function runSourceNodeIds(run: SkillRunVO): string[] {
  const value = parseRunInput(run)?.sourceNodeIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function runArtifacts(run: SkillRunVO): SkillRunArtifactVO[] {
  const byId = new Map<string, SkillRunArtifactVO>();
  for (const artifact of run.artifacts ?? []) byId.set(artifact.id, artifact);
  for (const step of run.steps ?? []) {
    for (const artifact of step.artifacts ?? []) byId.set(artifact.id, artifact);
  }
  return [...byId.values()];
}

function clientRequestId() {
  return `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const pendingCreateCommits = new Set<string>();

async function persistCanvasRunAndCommit(projectId: string, runId: string): Promise<boolean> {
  const key = `${projectId}:${runId}`;
  if (pendingCreateCommits.has(key)) return false;
  pendingCreateCommits.add(key);
  try {
    if (!await requestCanvasSave(projectId)) return false;
    await skillRunApi.commitCreate(`create:canvas:${projectId}`, runId);
    return true;
  } finally {
    pendingCreateCommits.delete(key);
  }
}

export function CanvasSkillRunToolbarButton({ nodeId }: { nodeId: string }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openCanvasSkillRunLauncher({ triggerNodeId: nodeId });
      }}
      className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      title="使用当前节点和入边素材运行 Skill"
    >
      <Sparkles className="h-4 w-4" />
      运行 Skill
    </button>
  );
}

/** 没有完整 ConfigurableNodeToolbar 的节点复用同一个 Skill action。 */
export function CanvasSkillRunNodeShortcut({
  nodeId,
  nodeType,
  visible,
}: {
  nodeId: string;
  nodeType: string;
  visible: boolean;
}) {
  const features = useCanvasNodeFeatures(nodeType);
  if (!visible || !features.includes("skill.launcher")) return null;
  return (
    <NodeChrome placement="top-center" gap={10} zIndex={20}>
      <div className="whitespace-nowrap rounded-[18px] border border-neutral-200/80 bg-white px-2 py-1.5 text-sm text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
        <CanvasSkillRunToolbarButton nodeId={nodeId} />
      </div>
    </NodeChrome>
  );
}

/** 画布中只挂载一份：统一承接底部入口、节点顶部入口、运行恢复和产物落点。 */
export function CanvasSkillRunWorkspace() {
  const projectId = useCanvasStore((state) => state.currentProjectId);
  const pickerOpen = useCanvasSkillRunUI((state) => state.pickerOpen);
  const request = useCanvasSkillRunUI((state) => state.request);
  const closePicker = useCanvasSkillRunUI((state) => state.closePicker);
  const [selectedSkill, setSelectedSkill] = useState<SkillVO | null>(null);
  const [prompt, setPrompt] = useState("");
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [parameterErrors, setParameterErrors] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const launchDialogRef = useFocusTrap<HTMLElement>(!!selectedSkill);
  const launchSeqRef = useRef(0);
  const previousProjectRef = useRef(projectId);
  const trackedSkillRunIds = useCanvasStore((state) => state.trackedSkillRunIds);
  const { runs, loading, actionBusy, createRun, performAction } = useSkillRuns(projectId, trackedSkillRunIds);

  const sourceNodes = useMemo(() => {
    if (!projectId) return [];
    const state = useCanvasStore.getState();
    return resolveCanvasSkillSources(state, request);
  }, [projectId, request]);
  const selectedNodeTypes = [...new Set(sourceNodes.map((node) => node.type))];
  const targetNodeType = request.triggerNodeId
    ? sourceNodes.find((node) => node.id === request.triggerNodeId)?.type
    : selectedNodeTypes.length === 1
      ? selectedNodeTypes[0]
      : undefined;
  const selectedRun = runs.find((run) => run.id === selectedRunId)
    ?? runs.find((run) => isSkillRunActive(run.status))
    ?? runs[0]
    ?? null;
  const activeCount = runs.filter((run) => isSkillRunActive(run.status)).length;

  useEffect(() => {
    if (previousProjectRef.current === projectId) return;
    previousProjectRef.current = projectId;
    launchSeqRef.current += 1;
    closePicker();
    setSelectedSkill(null);
    setPrompt("");
    setParameters({});
    setParameterErrors({});
    setLaunching(false);
    setSelectedRunId(null);
    setPanelOpen(false);
  }, [closePicker, projectId]);

  useEffect(() => {
    if (!selectedSkill) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setSelectedSkill(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedSkill]);

  useEffect(() => {
    if (!projectId || useCanvasStore.getState().currentProjectId !== projectId) return;
    for (const run of runs) {
      if (run.entryPoint !== "canvas" || String(run.projectId ?? "") !== projectId) continue;
      const state = useCanvasStore.getState();
      if (state.currentProjectId !== projectId) return;
      // listActive 也可能发现其它会话启动的运行；一旦见到就写入画布恢复清单，
      // 避免它在本页关闭期间结束后从 active 列表消失。
      state.trackSkillRun(run.id);
      // 先清掉运行锚点，再创建产物节点。settleSkillRun 不进入 undo，且保留顶层
      // trackedRunId，所以刷新后仍可恢复终态详情，又不会在撤销时复活运行锚点。
      if (!isSkillRunActive(run.status)) {
        state.settleSkillRun(run.id);
      }
      if (run.status === "succeeded") {
        const consumed = new Set(useCanvasStore.getState().materializedArtifactIds);
        const finalArtifacts = runArtifacts(run).filter((artifact) =>
          artifact.isFinal !== false && !consumed.has(artifact.id),
        );
        if (finalArtifacts.length > 0) {
          const latest = useCanvasStore.getState();
          const materialized = buildSkillArtifactNodes({
            run,
            artifacts: finalArtifacts,
            nodes: latest.nodes,
            sourceNodeIds: runSourceNodeIds(run),
          });
          if (materialized.nodes.length > 0) {
            latest.addNodesAndConnections(
              materialized.nodes,
              materialized.connections,
              materialized.nodes[materialized.nodes.length - 1].id,
            );
            latest.markSkillArtifactsMaterialized(
              materialized.nodes.flatMap((node) => node.provenance?.artifactId ? [node.provenance.artifactId] : []),
            );
          }
        }
      }
      // Keep the accepted-create journal until the recovery pointer, terminal
      // state, and any materialized artifacts are acknowledged by the server.
      void persistCanvasRunAndCommit(projectId, run.id);
    }
  }, [projectId, runs]);

  const pickSkill = (skill: SkillVO) => {
    closePicker();
    setSelectedSkill(skill);
    const snapshot = useCanvasStore.getState();
    setPrompt(buildCanvasSkillRunInput(snapshot, request).prompt);
    setParameters(defaultSkillInputValues(skill.inputSchema, skill.defaultParams));
    setParameterErrors({});
  };

  const launch = async () => {
    if (!selectedSkill || !projectId || launching) return;
    const launchSeq = ++launchSeqRef.current;
    const launchProjectId = projectId;
    const launchState = useCanvasStore.getState();
    const launchSources = resolveCanvasSkillSources(launchState, request);
    const launchNodeTypes = [...new Set(launchSources.map((node) => node.type))];
    const launchTargetNodeType = request.triggerNodeId
      ? launchSources.find((node) => node.id === request.triggerNodeId)?.type
      : launchNodeTypes.length === 1
        ? launchNodeTypes[0]
        : undefined;
    const input = buildCanvasSkillRunInput(launchState, { ...request, prompt, parameters });
    const errors = validateSkillRunInputValues(selectedSkill.inputSchema, input);
    if (Object.keys(errors).length > 0) {
      setParameterErrors(errors);
      toast.info(errors.prompt || errors.assets || errors.sourceNodeIds || errors.parameters || "请检查技能输入");
      return;
    }
    setLaunching(true);
    try {
      const run = await createRun({
        skillId: selectedSkill.id,
        entryPoint: "canvas",
        targetType: launchTargetNodeType,
        projectId: launchProjectId,
        clientRequestId: clientRequestId(),
        input,
      });
      const current = useCanvasStore.getState();
      if (current.currentProjectId !== launchProjectId) {
        throw new Error("画布已切换；运行已安全保留，请返回原画布查看");
      }
      current.trackSkillRun(run.id);
      for (const sourceNodeId of input.sourceNodeIds) {
        current.updateNode(sourceNodeId, { skillRunId: run.id });
      }
      await persistCanvasRunAndCommit(launchProjectId, run.id);
      if (useCanvasStore.getState().currentProjectId !== launchProjectId) return;
      setSelectedRunId(run.id);
      setPanelOpen(true);
      setSelectedSkill(null);
      toast.success("Skill 已启动");
    } catch (error) {
      toast.error((error as Error)?.message || "Skill 启动失败");
    } finally {
      if (launchSeq === launchSeqRef.current) setLaunching(false);
    }
  };

  const materializeOne = (artifact: SkillRunArtifactVO) => {
    if (
      !selectedRun ||
      !projectId ||
      String(selectedRun.projectId ?? "") !== projectId ||
      useCanvasStore.getState().currentProjectId !== projectId
    ) return;
    const state = useCanvasStore.getState();
    if (state.materializedArtifactIds.includes(artifact.id)) {
      toast.info("该产物已经添加过；删除或撤销后不会被自动重复创建");
      return;
    }
    const result = buildSkillArtifactNodes({
      run: selectedRun,
      artifacts: [artifact],
      nodes: state.nodes,
      sourceNodeIds: runSourceNodeIds(selectedRun),
    });
    if (result.nodes.length === 0) {
      toast.info("该产物已在画布中，或暂不支持转换为节点");
      return;
    }
    state.addNodesAndConnections(result.nodes, result.connections, result.nodes[0].id);
    state.markSkillArtifactsMaterialized(
      result.nodes.flatMap((node) => node.provenance?.artifactId ? [node.provenance.artifactId] : []),
    );
    toast.success("已添加到画布");
  };

  return (
    <>
      <SkillPicker
        open={pickerOpen}
        onClose={closePicker}
        onPick={pickSkill}
        kinds={["agent", "workflow"]}
        entryPoint="canvas"
        targetType={targetNodeType}
      />

      {selectedSkill && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[245] flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-sm" onMouseDown={() => setSelectedSkill(null)}>
          <section
            ref={launchDialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`运行 Skill：${selectedSkill.title}`}
            className="max-h-[calc(100vh-24px)] w-[min(620px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-2xl sm:max-h-[calc(100vh-40px)] sm:w-[min(620px,calc(100vw-32px))] sm:p-5 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Sparkles className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold">{selectedSkill.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{selectedSkill.description}</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setSelectedSkill(null)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-white"><X className="h-4 w-4" aria-hidden /></button>
            </header>

            <div className="mt-5 rounded-xl bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600 dark:bg-neutral-800/70 dark:text-neutral-300">
              <span className="font-medium">输入素材：</span>
              {sourceNodes.length ? sourceNodes.map((node) => node.title || node.type).join("、") : "未选择素材，将仅使用文字要求"}
            </div>
            <label className="mt-4 block text-xs font-medium text-neutral-700 dark:text-neutral-300">补充创作要求</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={6}
              placeholder="描述剧情、风格、时长或希望 Skill 重点处理的内容"
              aria-invalid={!!parameterErrors.prompt}
              className={`mt-2 w-full resize-y rounded-xl border bg-white px-3 py-2.5 text-sm leading-6 outline-none dark:bg-neutral-950 ${parameterErrors.prompt ? "border-red-400 focus:border-red-500 dark:border-red-500" : "border-neutral-200 focus:border-violet-400 dark:border-neutral-700 dark:focus:border-violet-500"}`}
            />
            {parameterErrors.prompt && <small className="mt-1.5 block text-xs text-red-500">{parameterErrors.prompt}</small>}
            <div className="mt-4">
              <SkillInputFields
                schema={selectedSkill.inputSchema}
                values={parameters}
                errors={parameterErrors}
                onChange={(key, value) => {
                  setParameters((current) => ({ ...current, [key]: value }));
                  setParameterErrors((current) => {
                    if (!current[key]) return current;
                    const next = { ...current };
                    delete next[key];
                    return next;
                  });
                }}
                disabled={launching}
                compact
              />
            </div>
            <footer className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedSkill(null)} className="rounded-xl px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">取消</button>
              <button type="button" onClick={() => void launch()} disabled={launching || !projectId} className="flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200">
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始运行
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}

      {panelOpen && selectedRun && (
        <aside className="fixed bottom-5 right-5 z-[85] w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <select value={selectedRun.id} onChange={(event) => setSelectedRunId(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none">
              {runs.map((run) => <option key={run.id} value={run.id}>{run.skillTitle || "Skill 运行"} · {run.status}</option>)}
            </select>
            <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X className="h-4 w-4" /></button>
          </div>
          <SkillRunPanel
            run={selectedRun}
            compact
            actionBusy={actionBusy.has(selectedRun.id)}
            onAction={async (action, payload) => {
              try {
                await performAction(selectedRun.id, {
                  action,
                  input: payload?.input,
                  feedback: payload?.feedback,
                });
              } catch (error) {
                toast.error((error as Error)?.message || "操作失败，请重试");
              }
            }}
            onArtifact={materializeOne}
          />
        </aside>
      )}

      {!panelOpen && (runs.length > 0 || loading) && (
        <button type="button" onClick={() => setPanelOpen(true)} className="fixed right-5 top-20 z-[70] flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-violet-500" />}
          {loading
            ? "恢复 Skill…"
            : activeCount > 0
              ? `${activeCount} 个 Skill 运行中`
              : "Skill 运行记录"}
        </button>
      )}
    </>
  );
}
