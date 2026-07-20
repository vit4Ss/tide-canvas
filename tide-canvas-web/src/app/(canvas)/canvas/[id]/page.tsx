"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, notFound } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { resumeGeneration, stopAllGeneration } from "@/hooks/canvas/use-ai-generation";
import { CanvasView } from "@/components/canvas/canvas-view";
import { ArrowLeft, Loader2, Check, Pencil } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/shared/toast";

const AUTOSAVE_DELAY = 3000; // 3 秒无变化触发自动保存

/** blob: 是本地临时预览地址(上传中/切图中),刷新即失效,持久化等于把内容变成死链 */
const isBlobUrl = (u?: string): boolean => !!u && u.startsWith("blob:");

/** 序列化前剥掉节点上的 blob: 地址:上传常超过自动保存的 3s 防抖窗口,
 *  原样落盘会在"上传完成前关页"时把死链写进 canvasData,重开后内容永久丢失。
 *  剥掉后该节点显示为空,待上传/切图完成写回真实 URL 时会自然触发下一轮保存。 */
function sanitizeForSave(n: CanvasNode): CanvasNode {
  const dirty =
    isBlobUrl(n.imageSrc) || isBlobUrl(n.videoSrc) || isBlobUrl(n.audioSrc) ||
    n.images?.some(isBlobUrl) || n.audioTracks?.some((t) => isBlobUrl(t.url));
  if (!dirty) return n;
  const c = { ...n };
  if (isBlobUrl(c.imageSrc)) delete c.imageSrc;
  if (isBlobUrl(c.videoSrc)) delete c.videoSrc;
  if (isBlobUrl(c.audioSrc)) delete c.audioSrc;
  if (c.images) {
    c.images = c.images.filter((u) => !isBlobUrl(u));
    if (c.images.length === 0) delete c.images;
  }
  if (c.audioTracks) {
    c.audioTracks = c.audioTracks.filter((t) => !isBlobUrl(t.url));
    if (c.audioTracks.length === 0) delete c.audioTracks;
  }
  return c;
}

export default function CanvasEditorPage() {
  const params = useParams();
  // URL 里的 [id] 实为不透明 url token，真实数值ID不在地址栏暴露
  const token = params.id as string;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [projectName, setProjectName] = useState("加载中...");
  const [editingName, setEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const setCurrentProjectId = useCanvasStore((s) => s.setCurrentProjectId);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Latest `saving` read via a ref so `save` isn't recreated when it flips —
  // otherwise the autosave effect (which depends on `save`) re-runs on every
  // setSaving and self-perpetuates a ~3s save loop even with no edits.
  const savingRef = useRef(false);
  // 保存在途时又触发保存(慢网络下防抖计时器到点):不能直接丢弃——那可能是
  // 用户的最后一次编辑,之后再无触发源,改动会永远不落盘。记 pending,在途
  // 请求结束后补跑一次。
  const pendingSaveRef = useRef(false);

  // 加载项目（按 url token；不存在/无权限 → 404）
  useEffect(() => {
    let cancelled = false;
    projectApi.getByToken(token).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setProjectId(String(res.data.id));
        setCurrentProjectId(String(res.data.id));
        setProjectName(res.data.name);
        setThumbnail(res.data.thumbnail || null);
        if (res.data.canvasData && res.data.canvasData !== "{}") {
          try {
            const data = JSON.parse(res.data.canvasData);
            loadCanvas(data.nodes || [], data.connections || [], data.groups || []);
            // 上次会话遗留的生成中节点（带 taskId）：任务仍在后端执行，按任务号续轮回填结果
            resumeGeneration();
          } catch {
            loadCanvas([], []);
          }
        } else {
          // 空项目必须显式清空:store 是全局单例,不清则上一个项目的节点残留在此项目里
          // 显示,且随后自动保存会把上个项目的画布写进本项目(数据串档)。
          loadCanvas([], []);
        }
        setLoaded(true);
      } else {
        setMissing(true);
      }
    }).catch(() => {
      if (!cancelled) setMissing(true);
    });
    // stopAllGeneration:轮询是画布级单例,离开页面/切换项目必须显式停掉,
    // 否则残留轮询会往已切换项目的全局 store 里写结果
    return () => { cancelled = true; setCurrentProjectId(null); stopAllGeneration(); };
  }, [token, loadCanvas, setCurrentProjectId]);

  const save = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const canvasData = JSON.stringify({ nodes: nodes.map(sanitizeForSave), connections, groups });
      // 封面兜底：未手动设封面时，自动用画布中第一张图片。
      // 仅取可持久化的 http(s) 地址——data:base64 会超出后端 thumbnail(VARCHAR 512) 导致保存 500，
      // blob: 本地地址刷新即失效（如刚切分尚未上传完成的切片），都不能当封面。
      const persistable = (u?: string): u is string => !!u && /^https?:\/\//.test(u);
      const cover = (persistable(thumbnail ?? undefined) ? thumbnail : null)
        ?? nodes.find((n) => n.type === "image" && persistable(n.imageSrc))?.imageSrc
        ?? null;
      const res = await projectApi.saveCanvas(projectId, { canvasData, ...(cover ? { thumbnail: cover } : {}) });
      if (res.success) {
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        if (!silent) toast.success("已保存");
      } else if (!silent) {
        toast.error("保存失败");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        // 经 saveRef 取最新版本,带上在途期间的新编辑
        void saveRef.current(true);
      }
    }
  }, [nodes, connections, groups, projectId, thumbnail]);

  // Keep a ref to the latest `save` so the unmount flush below (which has empty
  // deps) always calls the current version without re-subscribing.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Flush a pending autosave on unmount/navigate: if the debounce timer is still
  // armed when the canvas unmounts, the last edits would otherwise be dropped.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        // fire-and-forget; the request outlives this component.
        void saveRef.current(true);
      }
    };
  }, []);

  // 自动保存：监听 nodes/connections/groups 变化
  useEffect(() => {
    if (!loaded) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null; // mark flushed so the unmount flush won't re-save
      save(true);
    }, AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, connections, groups, loaded, save]);

  const handleStartEditName = () => {
    setEditingNameValue(projectName);
    setEditingName(true);
  };

  const confirmingNameRef = useRef(false);
  const handleConfirmName = async () => {
    // Enter 会先 setEditingName(false) 使 input 失焦触发 onBlur → 二次调用;用 ref 去重,避免重复 update 请求。
    if (confirmingNameRef.current) return;
    confirmingNameRef.current = true;
    try {
      const newName = editingNameValue.trim();
      if (!newName || newName === projectName) {
        setEditingName(false);
        return;
      }
      const prevName = projectName;
      setProjectName(newName);
      setEditingName(false);
      if (!projectId) return;
      const res = await projectApi.update(projectId, { name: newName });
      if (res.success) {
        toast.success("项目名已更新");
      } else {
        // 乐观更新失败要回滚,否则标题栏与服务端不一致直到刷新
        setProjectName(prevName);
        toast.error(res.message || "重命名失败");
      }
    } finally {
      confirmingNameRef.current = false;
    }
  };

  // token 无效 / 项目不存在 → 404
  if (missing) notFound();

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CanvasView />

      {/* 左上浮层：返回 + 项目名（点按重命名） + 保存状态 */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <Link
          href="/projects"
          title="返回项目列表"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {editingName ? (
            <input
              autoFocus
              value={editingNameValue}
              onChange={(e) => setEditingNameValue(e.target.value)}
              onBlur={handleConfirmName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmName();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="w-44 rounded-md border border-neutral-300 px-2 py-0.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-800"
            />
          ) : (
            <button onClick={handleStartEditName} title="点击重命名" className="group flex items-center gap-1.5">
              <span className="max-w-[220px] truncate text-sm font-medium">{projectName}</span>
              <Pencil className="h-3 w-3 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
          ) : lastSaved ? (
            <span title={`已保存 ${lastSaved}`} className="flex h-4 w-4 shrink-0 items-center justify-center">
              <Check className="h-3.5 w-3.5 text-green-500" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
