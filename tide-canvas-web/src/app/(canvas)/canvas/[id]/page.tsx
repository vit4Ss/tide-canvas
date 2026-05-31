"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, notFound } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { CanvasView } from "@/components/canvas/canvas-view";
import { ArrowLeft, Save, Share2, Loader2, Check, Pencil } from "lucide-react";
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

  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
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
        if (res.data.canvasData && res.data.canvasData !== "{}") {
          try {
            const data = JSON.parse(res.data.canvasData);
            loadCanvas(data.nodes || [], data.connections || []);
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
      const canvasData = JSON.stringify({ nodes, connections });
      const res = await projectApi.saveCanvas(projectId, { canvasData });
      if (res.success) {
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        if (!silent) toast.success("已保存");
      } else if (!silent) {
        toast.error("保存失败");
      }
    } finally {
      setSaving(false);
    }
  }, [saving, nodes, connections, projectId]);

  // 自动保存：监听 nodes/connections 变化
  useEffect(() => {
    if (!loaded) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => save(true), AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, connections, loaded, save]);

  const handleShare = async () => {
    if (!projectId) return;
    const res = await projectApi.share(projectId);
    if (res.success) {
      const url = window.location.origin + res.data.shareUrl;
      await navigator.clipboard.writeText(url);
      toast.success("分享链接已复制");
    }
  };

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

  // token 无效 / 项目不存在 / 无权访问 → 404
  if (missing) notFound();

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <Link
            href="/user/projects"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
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
              className="rounded border border-neutral-300 px-2 py-0.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
            />
          ) : (
            <button onClick={handleStartEditName} className="group flex items-center gap-1.5">
              <span className="text-sm font-medium">{projectName}</span>
              <Pencil className="h-3 w-3 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {saving && (
            <span className="flex items-center gap-1 text-xs text-neutral-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中
            </span>
          )}
          {!saving && lastSaved && (
            <span className="flex items-center gap-1 text-xs text-neutral-400">
              <Check className="h-3 w-3 text-green-500" />
              已保存 {lastSaved}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            <Save className="h-3.5 w-3.5" />
            保存
          </button>
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Share2 className="h-3.5 w-3.5" />
            分享
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <CanvasView />
      </div>
    </div>
  );
}
