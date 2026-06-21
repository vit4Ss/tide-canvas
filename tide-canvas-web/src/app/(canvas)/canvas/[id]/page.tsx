"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, notFound } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { CanvasView } from "@/components/canvas/canvas-view";
import { ArrowLeft, Loader2, Check, Pencil } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/shared/toast";

const AUTOSAVE_DELAY = 3000; // 3 秒无变化触发自动保存

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
          } catch {
            loadCanvas([], []);
          }
        }
        setLoaded(true);
      } else {
        setMissing(true);
      }
    }).catch(() => {
      if (!cancelled) setMissing(true);
    });
    return () => { cancelled = true; setCurrentProjectId(null); };
  }, [token, loadCanvas, setCurrentProjectId]);

  const save = useCallback(async (silent = false) => {
    if (saving || !projectId) return;
    setSaving(true);
    try {
      const canvasData = JSON.stringify({ nodes, connections, groups });
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
      setSaving(false);
    }
  }, [saving, nodes, connections, groups, projectId, thumbnail]);

  // 自动保存：监听 nodes/connections/groups 变化
  useEffect(() => {
    if (!loaded) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => save(true), AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, connections, groups, loaded, save]);

  const handleStartEditName = () => {
    setEditingNameValue(projectName);
    setEditingName(true);
  };

  const handleConfirmName = async () => {
    const newName = editingNameValue.trim();
    if (!newName || newName === projectName) {
      setEditingName(false);
      return;
    }
    setProjectName(newName);
    setEditingName(false);
    if (!projectId) return;
    const res = await projectApi.update(projectId, { name: newName });
    if (res.success) toast.success("项目名已更新");
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
