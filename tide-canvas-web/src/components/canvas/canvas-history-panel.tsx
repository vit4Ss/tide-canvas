"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "@douyinfe/semi-ui";
import { Image as AntImage } from "antd";
import { aiApi, fileApi } from "@/lib/api";
import { pointsApi, type BalanceVO, type PointRecordVO } from "@/lib/points-api";
import { formatDate } from "@/lib/utils";
import { useCanvasStore } from "@/stores/use-canvas-store";
import { AiTaskStatus, type AiGenerationLogVO, type AiTaskVO } from "@/types/ai";
import { toast } from "@/components/shared/toast";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Video,
  X,
} from "lucide-react";

const PAGE_SIZE = 60;
const POINTS_PAGE_SIZE = 16;

const HANDLER_LABEL: Record<string, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  start_end_to_video: "首尾帧视频",
  creative_desc: "创意描述",
};

const OPERATION_LABEL: Record<string, string> = {
  generation: "生成",
  edits: "编辑",
  video: "视频",
};

// 积分流水类型名(对应现后端 PointRecordVO.changeType)
const CHANGE_TYPE_NAMES: Record<string, string> = {
  recharge: "充值",
  consume: "AI 消耗",
  checkin: "签到",
  reward: "奖励",
  refund: "生成失败返还",
};

interface Props {
  open: boolean;
  onClose: () => void;
  onAddResource: (resource: { url: string; kind: "image" | "video"; title: string }) => void;
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

function compactTime(value: string) {
  const formatted = formatDate(value);
  return formatted ? formatted.slice(5, 16) : "-";
}

function resourceTitle(item: AiGenerationLogVO) {
  return HANDLER_LABEL[item.handlerName] || OPERATION_LABEL[item.operation] || item.operation || "生成资源";
}

export function CanvasHistoryPanel({ open, onClose, onAddResource }: Props) {
  const projectId = useCanvasStore((s) => s.currentProjectId);
  const [tasks, setTasks] = useState<AiTaskVO[]>([]);
  const [logs, setLogs] = useState<AiGenerationLogVO[]>([]);
  const [resourcesLoaded, setResourcesLoaded] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsLoaded, setPointsLoaded] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsPage, setPointsPage] = useState(1);
  const [pointsTotal, setPointsTotal] = useState(0);
  const [balance, setBalance] = useState<BalanceVO | null>(null);
  const [transactions, setTransactions] = useState<PointRecordVO[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [previewResource, setPreviewResource] = useState<{ url: string; title: string } | null>(null);

  const resources = useMemo(
    () => logs.filter((item) => item.success === 1 && item.resultUrl?.trim()),
    [logs],
  );

  const loadResources = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setLogs([]);
      setResourcesLoaded(true);
      return;
    }

    setResourcesLoading(true);
    try {
      const [taskRes, logRes] = await Promise.all([
        aiApi.listTasks({ pageNum: 1, pageSize: 50, status: AiTaskStatus.PROCESSING, projectId }),
        aiApi.canvasLogs({ pageNum: 1, pageSize: PAGE_SIZE, projectId }),
      ]);
      if (taskRes.success) setTasks(taskRes.data.records);
      if (logRes.success) setLogs(logRes.data.records);
    } finally {
      setResourcesLoaded(true);
      setResourcesLoading(false);
    }
  }, [projectId]);

  const loadPoints = useCallback(async () => {
    setPointsLoading(true);
    try {
      const [balanceRes, txRes] = await Promise.all([
        pointsApi.balance(),
        pointsApi.records({ pageNum: pointsPage, pageSize: POINTS_PAGE_SIZE }),
      ]);
      if (balanceRes.success) setBalance(balanceRes.data);
      if (txRes.success) {
        setTransactions(txRes.data.records);
        setPointsTotal(txRes.data.total);
      }
    } finally {
      setPointsLoaded(true);
      setPointsLoading(false);
    }
  }, [pointsPage]);

  useEffect(() => {
    if (!open) return;
    setResourcesLoaded(false);
    void loadResources();
    const timer = window.setInterval(() => void loadResources(), 5000);
    return () => window.clearInterval(timer);
  }, [open, loadResources]);

  useEffect(() => {
    if (!open || !pointsOpen) return;
    void loadPoints();
  }, [open, pointsOpen, loadPoints]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const markSaving = (id: string, saving: boolean) => {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleAddToCanvas = (item: AiGenerationLogVO) => {
    const url = item.resultUrl.trim();
    const kind = isVideoUrl(url) ? "video" : "image";
    onAddResource({ url, kind, title: resourceTitle(item) });
    toast.success("已添加到当前画布");
  };

  const openImagePreview = (item: AiGenerationLogVO) => {
    setPreviewResource({ url: item.resultUrl.trim(), title: resourceTitle(item) });
  };

  const closeImagePreview = () => {
    setPreviewResource(null);
  };

  const handleSaveToAssets = async (item: AiGenerationLogVO) => {
    const url = item.resultUrl.trim();
    if (!url || savingIds.has(item.id)) return;
    markSaving(item.id, true);
    try {
      const res = await fileApi.saveFromUrl({
        url: new URL(url, window.location.origin).href,
        fileType: isVideoUrl(url) ? "video" : "image",
        originalName: resourceTitle(item),
      });
      if (res.success) toast.success("已保存到资源");
      else toast.error(res.message || "保存失败");
    } catch {
      toast.error("保存失败");
    } finally {
      markSaving(item.id, false);
    }
  };

  const totalPointsPages = Math.max(1, Math.ceil(pointsTotal / POINTS_PAGE_SIZE));

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-6 py-5 backdrop-blur-[2px] dark:bg-black/35">
      <section className="flex h-[min(760px,calc(100vh-48px))] w-[min(1180px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl shadow-neutral-950/20 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-neutral-100 px-5 dark:border-neutral-800">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-neutral-950 dark:text-white">当前画布资源</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                {projectId ? `共 ${resources.length} 个生成资源` : "当前画布暂无项目 ID，暂不能查询资源历史"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPointsOpen((value) => !value)}
                className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors ${
                  pointsOpen
                    ? "border-neutral-950 bg-neutral-950 text-white dark:border-white dark:bg-white dark:text-neutral-950"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
                }`}
              >
                <Coins className="h-4 w-4" />
                积分明细
              </button>
              <button
                type="button"
                onClick={() => void loadResources()}
                title="刷新资源"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${resourcesLoading ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                title="关闭"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {!resourcesLoaded ? (
              <div className="flex h-full items-center justify-center text-neutral-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <>
                {tasks.length > 0 && (
                  <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-blue-950 dark:text-blue-100">正在生成</h3>
                      <span className="text-xs text-blue-600 dark:text-blue-300">{tasks.length} 个任务</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {tasks.map((task) => (
                        <div key={task.id} className="rounded-xl border border-blue-100 bg-white p-3 dark:border-blue-900/40 dark:bg-neutral-950">
                          <div className="flex items-center gap-2 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                            <span className="font-medium text-neutral-900 dark:text-neutral-100">{HANDLER_LABEL[task.handler] ?? task.handler}</span>
                            <span className="ml-auto text-xs text-neutral-400">{compactTime(task.createTime)}</span>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.max(4, task.progress || 0)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resources.length === 0 ? (
                  <div className="flex h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 text-neutral-400 dark:border-neutral-800">
                    <Inbox className="h-8 w-8" />
                    <p className="mt-3 text-sm font-medium text-neutral-500 dark:text-neutral-300">当前画布还没有生成资源</p>
                    <p className="mt-1 text-xs">生成图片或视频后，会自动出现在这里。</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {resources.map((item) => {
                      const url = item.resultUrl.trim();
                      const video = isVideoUrl(url);
                      const Icon = video ? Video : ImageIcon;
                      const title = resourceTitle(item);
                      const saving = savingIds.has(item.id);
                      return (
                        <article key={item.id} className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
                          <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-neutral-100 dark:bg-neutral-900">
                            {video ? (
                              <video src={url} className="h-full w-full object-cover" controls playsInline preload="metadata" />
                            ) : (
                              <Image
                                src={url}
                                alt={title}
                                width="100%"
                                height="100%"
                                preview={false}
                                onClick={() => openImagePreview(item)}
                                className="h-full w-full"
                                imgCls="h-full w-full cursor-zoom-in object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                imgStyle={{ height: "100%", width: "100%", objectFit: "cover" }}
                              />
                            )}
                            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                              <Icon className="h-3 w-3" />
                              {video ? "视频" : "图片"}
                            </span>
                          </div>

                          <div className="p-3">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate text-sm font-semibold text-neutral-950 dark:text-white">{title}</h3>
                                <p className="mt-1 truncate text-xs text-neutral-500">{item.model || "未知模型"}</p>
                              </div>
                              <span className="shrink-0 text-xs text-neutral-400">{compactTime(item.createTime)}</span>
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleAddToCanvas(item)}
                                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-neutral-950 px-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                添加到画布
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleSaveToAssets(item)}
                                disabled={saving}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-900"
                              >
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                保存
                              </button>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className="text-xs text-neutral-400">
                                {item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : "已完成"}
                              </span>
                              <span className="truncate text-xs text-neutral-400">{video ? "视频资源" : "点击图片预览"}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {pointsOpen && (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-neutral-100 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/60">
            <div className="border-b border-neutral-100 p-4 dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-950 dark:text-white">积分流水</h3>
                  <p className="mt-0.5 text-xs text-neutral-500">最近积分变动明细</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadPoints()}
                  title="刷新积分"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-white hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${pointsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 dark:bg-neutral-950 dark:ring-neutral-800">
                <p className="text-xs text-neutral-500">当前积分</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-950 dark:text-white">{balance?.points ?? 0}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!pointsLoaded && pointsLoading ? (
                <div className="flex h-48 items-center justify-center text-neutral-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : transactions.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-neutral-400">
                  <Inbox className="h-6 w-6" />
                  <p className="mt-2 text-xs">暂无积分流水</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx) => {
                    const positive = tx.amount >= 0;
                    return (
                      <div key={tx.id} className="rounded-xl bg-white p-3 ring-1 ring-neutral-200/70 dark:bg-neutral-950 dark:ring-neutral-800">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                            positive ? "bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400" : "bg-red-50 text-red-500 dark:bg-red-950/30 dark:text-red-300"
                          }`}>
                            {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{CHANGE_TYPE_NAMES[tx.changeType] || "积分变动"}</p>
                              <span className={`shrink-0 text-sm font-semibold tabular-nums ${positive ? "text-green-600" : "text-red-500"}`}>
                                {positive ? `+${tx.amount}` : tx.amount}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{tx.remark || "无备注"}</p>
                            <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400">
                              <span>余额 {tx.balance}</span>
                              <span>{formatDate(tx.createTime)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-neutral-100 p-4 text-xs text-neutral-500 dark:border-neutral-800">
              <span>第 {pointsPage} / {totalPointsPages} 页</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pointsPage <= 1}
                  onClick={() => setPointsPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={pointsPage >= totalPointsPages}
                  onClick={() => setPointsPage((page) => Math.min(totalPointsPages, page + 1))}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  下一页
                </button>
              </div>
            </div>
          </aside>
        )}
      </section>

      <AntImage
        src={previewResource?.url}
        alt={previewResource?.title || "图片预览"}
        style={{ display: "none" }}
        preview={{
          open: Boolean(previewResource),
          src: previewResource?.url,
          movable: true,
          minScale: 0.5,
          maxScale: 12,
          scaleStep: 0.5,
          zIndex: 1600,
          onOpenChange: (open) => {
            if (!open) closeImagePreview();
          },
        }}
      />
    </div>
  );
}
