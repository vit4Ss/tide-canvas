"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, notFound, useRouter } from "next/navigation";
import { projectApi } from "@/lib/api";
import { useCanvasStore, type CanvasGroup, type CanvasNode, type Connection } from "@/stores/use-canvas-store";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { CanvasView } from "@/components/canvas/canvas-view";
import { RechargeDialog } from "@/components/canvas/recharge-dialog";
import { ArrowLeft, Share2, Loader2, Check, Pencil, Coins, User, LogOut, Settings, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { toast } from "@/components/shared/toast";

const AUTOSAVE_DELAY = 3000; // 3 秒无变化触发自动保存
const CANVAS_SCHEMA_VERSION = 2;

type CanvasViewport = { x: number; y: number; k: number };
type CanvasDocument = {
  schemaVersion?: number;
  viewport?: Partial<CanvasViewport>;
  transform?: Partial<CanvasViewport>;
  nodes?: CanvasNode[];
  connections?: Connection[];
  groups?: CanvasGroup[];
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseViewport(value: unknown): CanvasViewport | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<Record<keyof CanvasViewport, unknown>>;
  const x = toFiniteNumber(source.x);
  const y = toFiniteNumber(source.y);
  const k = toFiniteNumber(source.k);
  if (x === null || y === null || k === null || k <= 0) return null;
  return { x, y, k };
}

function parseCanvasDocument(raw: string): { nodes: CanvasNode[]; connections: Connection[]; groups: CanvasGroup[]; viewport: CanvasViewport | null } {
  const data = JSON.parse(raw || "{}") as CanvasDocument;
  return {
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    connections: Array.isArray(data.connections) ? data.connections : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
    viewport: parseViewport(data.viewport) ?? parseViewport(data.transform),
  };
}

function serializeCanvasNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes
    .filter((node) => {
      const hasLocalPreview = node.imageSrc?.startsWith("blob:") || node.videoSrc?.startsWith("blob:");
      return !(node.uploading && hasLocalPreview);
    })
    .map((node) => {
      const persisted: CanvasNode = { ...node };
      if (persisted.imageSrc?.startsWith("blob:")) delete persisted.imageSrc;
      if (persisted.videoSrc?.startsWith("blob:")) delete persisted.videoSrc;
      delete persisted.uploading;
      delete persisted.uploadProgress;
      return persisted;
    });
}
export default function CanvasEditorPage() {
  const params = useParams();
  // URL 里的 [id] 实为不透明 url token，真实数值 ID 不在地址栏暴露
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

  const { user, isAdmin } = useAuth();
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const groups = useCanvasStore((s) => s.groups);
  const transform = useCanvasStore((s) => s.transform);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const setTransform = useCanvasStore((s) => s.setTransform);
  const setCurrentProjectId = useCanvasStore((s) => s.setCurrentProjectId);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const canvasUpdateTimeRef = useRef<string | null>(null);

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
        canvasUpdateTimeRef.current = res.data.updateTime || null;
        try {
          const data = parseCanvasDocument(res.data.canvasData || "{}");
          loadCanvas(data.nodes, data.connections, data.groups);
          if (data.viewport) setTransform(data.viewport);
        } catch {
          loadCanvas([], []);
        }
        setLoaded(true);
      } else {
        setMissing(true);
      }
    }).catch(() => {
      if (!cancelled) setMissing(true);
    });
    return () => { cancelled = true; setCurrentProjectId(null); };
  }, [token, loadCanvas, setCurrentProjectId, setTransform]);

  const save = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (savingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const latest = useCanvasStore.getState();
      const canvasData = JSON.stringify({
        schemaVersion: CANVAS_SCHEMA_VERSION,
        viewport: latest.transform,
        nodes: serializeCanvasNodes(latest.nodes),
        connections: latest.connections,
        groups: latest.groups,
      });
      const persistable = (u?: string): u is string => !!u && new RegExp("^https?://").test(u);
      const cover = (persistable(thumbnail ?? undefined) ? thumbnail : null)
        ?? latest.nodes.find((n) => n.type === "image" && persistable(n.imageSrc))?.imageSrc
        ?? null;
      const expectedUpdateTime = canvasUpdateTimeRef.current || undefined;
      const res = await projectApi.saveCanvas(projectId, { canvasData, expectedUpdateTime, ...(cover ? { thumbnail: cover } : {}) });
      if (res.success) {
        canvasUpdateTimeRef.current = res.data?.updateTime || canvasUpdateTimeRef.current;
        setLastSaved(new Date().toLocaleTimeString("zh-CN"));
        if (!silent) toast.success("已保存");
      } else if (res.code === 409) {
        pendingSaveRef.current = false;
        toast.error(res.message || "画布已被其他窗口更新，请刷新后再保存");
      } else if (!silent) {
        toast.error("保存失败");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        window.setTimeout(() => { void save(true); }, 0);
      }
    }
  }, [projectId, thumbnail]);

  // 自动保存：监听 nodes/connections/groups 变化
  useEffect(() => {
    if (!loaded) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => save(true), AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, connections, groups, transform, loaded, save]);

  useEffect(() => {
    if (!loaded) return;
    const handleSaveNow = () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      void save(true);
    };
    window.addEventListener("tide-canvas-save-now", handleSaveNow);
    return () => window.removeEventListener("tide-canvas-save-now", handleSaveNow);
  }, [loaded, save]);

  const handleShare = async () => {
    if (!projectId) return;
    const res = await projectApi.share(projectId);
    if (res.success) {
      const url = window.location.origin + res.data.shareUrl;
      await navigator.clipboard.writeText(url);
      toast.success("分享链接已复制");
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push("/");
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

  // token 无效 / 项目不存在 / 无权限访问 → 404
  if (missing) notFound();

  // 项目数据加载中：居中品牌色加载动画
  if (!loaded) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-indigo-100 border-t-indigo-600 dark:border-indigo-500/20 dark:border-t-indigo-400" />
          <p className="animate-pulse text-sm text-neutral-500 dark:text-neutral-400">项目加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <CanvasView />

      {/* 左上浮层：返回 + 项目名（点击重命名） + 保存状态 */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <Link
          href="/user/projects"
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

      {/* 右上浮层：积分余额 + 充值积分 + 头像菜单 + 分享 */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        {/* 积分余额 + 充值积分 */}
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <Coins className="h-4 w-4 text-amber-500" />
          <span className="font-medium tabular-nums">{user?.points ?? 0}</span>
          <span className="h-3.5 w-px bg-neutral-200 dark:bg-neutral-700" />
          <button onClick={() => setRechargeOpen(true)} className="text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
            充值积分
          </button>
        </div>

        {/* 头像 + 账户菜单 */}
        <div className="relative" onMouseEnter={() => setUserMenuOpen(true)} onMouseLeave={() => setUserMenuOpen(false)}>
          <button className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <User className="h-4 w-4 text-neutral-500" />
            )}
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 w-44 pt-1">
              <div className="rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                <div className="truncate px-4 py-2 text-xs text-neutral-400">{user?.nickname || user?.username || "未登录"}</div>
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                <Link href="/user" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"><User className="h-4 w-4" />个人中心</Link>
                <button onClick={() => { setUserMenuOpen(false); setRechargeOpen(true); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"><Coins className="h-4 w-4" />充值积分</button>
                <Link href="/user/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"><Settings className="h-4 w-4" />账户设置</Link>
                {isAdmin && (
                  <Link href="/admin" target="_blank" rel="noopener noreferrer" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"><LayoutDashboard className="h-4 w-4" />管理后台</Link>
                )}
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                <button onClick={handleLogout} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"><LogOut className="h-4 w-4" />退出登录</button>
              </div>
            </div>
          )}
        </div>

        {/* 分享 */}
        <button onClick={handleShare} title="分享" className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </div>
  );
}
