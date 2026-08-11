"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp,
  Check,
  Download,
  Images,
  ListChecks,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { mediaAssetApi } from "@/lib/api";
import { fetchWithAuth } from "@/lib/http";
import { useCanvasStore } from "@/stores/use-canvas-store";
import type {
  MediaAssetOrder,
  MediaAssetScope,
  MediaAssetType,
  MediaAssetVO,
} from "@/types/media-asset";
import { HistoryAssetCard } from "./history/history-asset-card";
import { HistoryAssetPreview } from "./history/history-asset-preview";
import styles from "./history/canvas-history.module.css";

const SCOPE_SESSION_KEY = "tide.canvas.history.scope";
const DENSITY_SESSION_KEY = "tide.canvas.history.density";
const ORDER_SESSION_KEY = "tide.canvas.history.order";
const PAGE_SIZE = 48;
const DENSITY_STEPS = [80, 100, 120] as const;
const DENSITY_PIXELS: Record<(typeof DENSITY_STEPS)[number], number> = {
  80: 120,
  100: 144,
  120: 168,
};
const MEDIA_TABS: Array<{ type: MediaAssetType; label: string }> = [
  { type: "image", label: "图片历史" },
  { type: "video", label: "视频历史" },
  { type: "audio", label: "音频历史" },
];

function sessionValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionValue(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened/private browser sessions; the
    // current in-memory preference remains fully functional.
  }
}

function initialScope(): MediaAssetScope {
  return sessionValue(SCOPE_SESSION_KEY) === "all" ? "all" : "project";
}

function initialOrder(): MediaAssetOrder {
  return sessionValue(ORDER_SESSION_KEY) === "asc" ? "asc" : "desc";
}

function initialDensity(): (typeof DENSITY_STEPS)[number] {
  const value = Number(sessionValue(DENSITY_SESSION_KEY));
  return DENSITY_STEPS.includes(value as (typeof DENSITY_STEPS)[number])
    ? value as (typeof DENSITY_STEPS)[number]
    : 100;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUse: (assets: MediaAssetVO[]) => Promise<void> | void;
}

interface DateGroup {
  date: string;
  items: MediaAssetVO[];
}

function dateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "未知日期";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupByDate(records: readonly MediaAssetVO[]): DateGroup[] {
  const groups = new Map<string, MediaAssetVO[]>();
  for (const record of records) {
    const key = dateKey(record.createTime);
    const items = groups.get(key) ?? [];
    items.push(record);
    groups.set(key, items);
  }
  return Array.from(groups, ([date, items]) => ({ date, items }));
}

function sortRecords(records: MediaAssetVO[], order: MediaAssetOrder): MediaAssetVO[] {
  return records.sort((left, right) => {
    const time = new Date(left.createTime).getTime() - new Date(right.createTime).getTime();
    const tieBreak = left.id.localeCompare(right.id);
    return order === "asc" ? time || tieBreak : -(time || tieBreak);
  });
}

function mergeRecords(
  current: readonly MediaAssetVO[],
  incoming: readonly MediaAssetVO[],
  order: MediaAssetOrder,
): MediaAssetVO[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, item);
  return sortRecords(Array.from(merged.values()), order);
}

async function downloadAsset(asset: MediaAssetVO, quiet = false): Promise<boolean> {
  try {
    const name = asset.name || `${asset.mediaType}-${asset.id}`;
    const href = `/api/files/download?url=${encodeURIComponent(asset.url)}&name=${encodeURIComponent(name)}`;
    const response = await fetchWithAuth(href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectURL = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectURL;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 5_000);
    return true;
  } catch {
    if (!quiet) toast.error("下载失败，请稍后重试");
    return false;
  }
}

/** Full-screen canvas asset history with project/all scopes and per-output actions. */
export function CanvasHistoryPanel({ open, onClose, onUse }: Props) {
  const projectId = useCanvasStore((state) => state.currentProjectId);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterVersionRef = useRef(0);

  const [scope, setScope] = useState<MediaAssetScope>(initialScope);
  const [mediaType, setMediaType] = useState<MediaAssetType>("image");
  const [order, setOrder] = useState<MediaAssetOrder>(initialOrder);
  const [density, setDensity] = useState<(typeof DENSITY_STEPS)[number]>(initialDensity);
  const [records, setRecords] = useState<MediaAssetVO[]>([]);
  const [counts, setCounts] = useState<Record<MediaAssetType, number>>({ image: 0, video: 0, audio: 0 });
  const [nextCursor, setNextCursor] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MediaAssetVO | null>(null);
  const [touchActiveId, setTouchActiveId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    setSessionValue(SCOPE_SESSION_KEY, scope);
    setSessionValue(DENSITY_SESSION_KEY, String(density));
    setSessionValue(ORDER_SESSION_KEY, order);
  }, [density, order, scope]);

  useEffect(() => {
    if (!open) filterVersionRef.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const resetSelection = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
    setTouchActiveId(null);
  }, []);

  const fetchPage = useCallback(async (
    cursor: string,
    append: boolean,
    version: number,
  ): Promise<void> => {
    if (scope === "project" && !projectId) return;
    if (append) {
      setLoadingMore(true);
      setLoadMoreFailed(false);
    } else {
      setLoadState("loading");
    }
    const response = await mediaAssetApi.list({
      scope,
      ...(scope === "project" && projectId ? { projectId } : {}),
      mediaType,
      orderDirection: order,
      ...(cursor ? { cursor } : {}),
      pageSize: PAGE_SIZE,
    });
    if (filterVersionRef.current !== version) return;
    if (!response.success || !response.data) {
      if (append) setLoadMoreFailed(true);
      else setLoadState("error");
      setLoadingMore(false);
      return;
    }
    setRecords((current) => append
      ? mergeRecords(current, response.data.records, order)
      : response.data.records);
    setCounts(response.data.counts);
    setNextCursor(response.data.nextCursor || "");
    setLoadState("ready");
    setLoadingMore(false);
    setLoadMoreFailed(false);
  }, [mediaType, order, projectId, scope]);

  useEffect(() => {
    if (!open || (scope === "project" && !projectId)) return;
    const version = filterVersionRef.current + 1;
    filterVersionRef.current = version;
    const timer = window.setTimeout(() => {
      setRecords([]);
      setCounts({ image: 0, video: 0, audio: 0 });
      setNextCursor("");
      setPreview(null);
      resetSelection();
      scrollRef.current?.scrollTo({ top: 0 });
      void fetchPage("", false, version);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPage, open, projectId, refreshNonce, resetSelection, scope]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || loadState !== "ready") return;
    void fetchPage(nextCursor, true, filterVersionRef.current);
  }, [fetchPage, loadState, loadingMore, nextCursor]);

  useEffect(() => {
    if (!open || !nextCursor || !sentinelRef.current || !scrollRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); },
      { root: scrollRef.current, rootMargin: "320px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, open]);

  // Poll only sources currently visible as processing. Source-scoped refreshes
  // return every terminal output (including #2/#3) and an empty result removes
  // a failed/cancelled placeholder without resetting lazily loaded pages.
  useEffect(() => {
    if (!open || !records.some((item) => item.status === 0)) return;
    const timer = window.setInterval(async () => {
      const processingSources = new Set(
        records.filter((item) => item.status === 0).map((item) => item.sourceId),
      );
      const version = filterVersionRef.current;
      const sourceList = Array.from(processingSources);
      const chunks = Array.from({ length: Math.ceil(sourceList.length / 20) }, (_, index) =>
        sourceList.slice(index * 20, index * 20 + 20),
      );
      const refreshed = await Promise.all(chunks.map(async (sources) => ({
        sources,
        response: await mediaAssetApi.list({
          scope,
          ...(scope === "project" && projectId ? { projectId } : {}),
          mediaType,
          orderDirection: order,
          sourceIds: sources.join(","),
          pageSize: 60,
        }),
      })));
      if (filterVersionRef.current !== version) return;
      const successful = refreshed.filter((item) => item.response.success && Boolean(item.response.data));
      if (successful.length === 0) return;
      const resolvedSources = new Set(successful.flatMap((item) => item.sources));
      const incoming = successful.flatMap((item) => item.response.data?.records ?? []);
      const returnedSources = new Set(incoming.map((item) => item.sourceId));
      setRecords((current) => mergeRecords(
        current.filter((item) => !(
          item.status === 0 &&
          resolvedSources.has(item.sourceId) &&
          !returnedSources.has(item.sourceId)
        )),
        incoming,
        order,
      ));
      const refreshedCounts = successful[0].response.data?.counts;
      if (refreshedCounts) setCounts(refreshedCounts);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [mediaType, open, order, projectId, records, scope]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      if (preview) {
        setPreview(null);
        return;
      }
      if (batchMode) {
        resetSelection();
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [batchMode, onClose, open, preview, resetSelection]);

  const groups = useMemo(() => groupByDate(records), [records]);
  const selectedAssets = useMemo(
    () => records.filter((item) => selected.has(item.id) && item.status === 1 && item.url),
    [records, selected],
  );

  const toggleSelection = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((items: readonly MediaAssetVO[]) => {
    const ids = items.filter((item) => item.status === 1 && item.url).map((item) => item.id);
    setSelected((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const applyAssets = useCallback(async (assets: MediaAssetVO[]) => {
    if (assets.length === 0 || mutating) return;
    setMutating(true);
    try {
      await onUse(assets);
      onClose();
    } catch {
      toast.error("添加到画布失败，请稍后重试");
    } finally {
      setMutating(false);
    }
  }, [mutating, onClose, onUse]);

  const removeAsset = useCallback(async (asset: MediaAssetVO) => {
    if (deletingIds.has(asset.id)) return;
    const confirmed = await confirmDialog({
      title: "永久删除资源",
      message: "删除后无法恢复，画布中已使用该资源的节点也可能无法继续加载。",
      confirmText: "永久删除",
      danger: true,
    });
    if (!confirmed) return;
    setDeletingIds((current) => new Set(current).add(asset.id));
    const response = await mediaAssetApi.delete(asset.id);
    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(asset.id);
      return next;
    });
    if (!response.success) {
      toast.error(response.message || "删除失败，请稍后重试");
      return;
    }
    setPreview((current) => current?.id === asset.id ? null : current);
    setRecords((current) => current.filter((item) => item.id !== asset.id));
    setCounts((current) => ({ ...current, [asset.mediaType]: Math.max(0, current[asset.mediaType] - 1) }));
    toast.success("资源已永久删除");
  }, [deletingIds]);

  const batchDelete = useCallback(async () => {
    if (selectedAssets.length === 0 || mutating) return;
    const confirmed = await confirmDialog({
      title: "批量永久删除",
      message: `确认永久删除所选 ${selectedAssets.length} 项？已发布的资源会被阻止，请先取消发布。`,
      confirmText: "永久删除",
      danger: true,
    });
    if (!confirmed) return;
    setMutating(true);
    const response = await mediaAssetApi.batchDelete(selectedAssets.map((item) => item.id));
    setMutating(false);
    if (!response.success || !response.data) {
      toast.error(response.message || "批量删除失败，请稍后重试");
      return;
    }
    const deleted = new Set(response.data.deletedIds);
    setRecords((current) => current.filter((item) => !deleted.has(item.id)));
    setSelected((current) => new Set(Array.from(current).filter((id) => !deleted.has(id))));
    if (response.data.blockedIds.length > 0) {
      toast.info(`已删除 ${deleted.size} 项；${response.data.blockedIds.length} 项已发布，请先取消发布`);
    } else if (response.data.failedIds.length > 0) {
      toast.info(`已删除 ${deleted.size} 项；${response.data.failedIds.length} 项删除失败`);
    } else {
      toast.success(`已永久删除 ${deleted.size} 项`);
      resetSelection();
    }
    setRefreshNonce((value) => value + 1);
  }, [mutating, resetSelection, selectedAssets]);

  const batchDownload = useCallback(async () => {
    if (selectedAssets.length === 0 || mutating) return;
    setMutating(true);
    let completed = 0;
    for (const asset of selectedAssets) {
      if (await downloadAsset(asset, true)) completed += 1;
    }
    setMutating(false);
    toast[completed > 0 ? "success" : "error"](
      completed === selectedAssets.length
        ? `已下载 ${completed} 项`
        : completed > 0 ? `已下载 ${completed} 项，${selectedAssets.length - completed} 项失败` : "下载失败，请稍后重试",
    );
  }, [mutating, selectedAssets]);

  const changeDensity = (direction: -1 | 1) => {
    const current = DENSITY_STEPS.indexOf(density);
    const next = Math.min(DENSITY_STEPS.length - 1, Math.max(0, current + direction));
    setDensity(DENSITY_STEPS[next]);
  };

  if (!open || typeof document === "undefined") return null;
  const modalStyle = {
    "--history-card-size": `${DENSITY_PIXELS[density]}px`,
  } as CSSProperties;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className={styles.modal}
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>历史资产</h2>
          <div className={styles.scopeSwitch} aria-label="历史范围">
            <button
              type="button"
              className={scope === "project" ? styles.scopeActive : undefined}
              aria-pressed={scope === "project"}
              onClick={() => setScope("project")}
            >
              本画布
            </button>
            <button
              type="button"
              className={scope === "all" ? styles.scopeActive : undefined}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              全部历史
            </button>
          </div>
          <div className={styles.headerControls}>
            <div className={styles.densityControl} aria-label="缩略图密度">
              <button type="button" aria-label="缩小缩略图" disabled={density === DENSITY_STEPS[0]} onClick={() => changeDensity(-1)}>
                <Minus aria-hidden="true" />
              </button>
              <span>{density}%</span>
              <button type="button" aria-label="放大缩略图" disabled={density === DENSITY_STEPS[DENSITY_STEPS.length - 1]} onClick={() => changeDensity(1)}>
                <Plus aria-hidden="true" />
              </button>
            </div>
            <button type="button" className={styles.iconButton} aria-label="关闭历史资产" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className={styles.toolbar}>
          <nav className={styles.tabs} aria-label="资源类型">
            {MEDIA_TABS.map((tab) => (
              <button
                key={tab.type}
                type="button"
                className={`${styles.tab}${mediaType === tab.type ? ` ${styles.tabActive}` : ""}`}
                aria-current={mediaType === tab.type ? "page" : undefined}
                onClick={() => setMediaType(tab.type)}
              >
                {tab.label}({counts[tab.type] ?? 0})
              </button>
            ))}
          </nav>
          <div className={styles.toolbarActions}>
            <button type="button" className={styles.textButton} onClick={() => setOrder((value) => value === "desc" ? "asc" : "desc")}>
              <ArrowDownUp aria-hidden="true" />
              <span>{order === "desc" ? "时间降序" : "时间升序"}</span>
            </button>
            <button
              type="button"
              className={`${styles.textButton}${batchMode ? ` ${styles.textButtonActive}` : ""}`}
              aria-pressed={batchMode}
              onClick={() => batchMode ? resetSelection() : setBatchMode(true)}
            >
              <ListChecks aria-hidden="true" />
              <span>批量操作</span>
            </button>
          </div>
        </div>

        {batchMode && (
          <div className={styles.batchBar}>
            <span className={styles.batchSummary}>已选择 {selectedAssets.length} 项</span>
            <button type="button" className={`${styles.actionButton} ${styles.dangerButton}`} disabled={selectedAssets.length === 0 || mutating} onClick={() => void batchDelete()}>
              <Trash2 aria-hidden="true" />删除
            </button>
            <button type="button" className={styles.actionButton} disabled={selectedAssets.length === 0 || mutating} onClick={() => void batchDownload()}>
              <Download aria-hidden="true" />下载
            </button>
            <button type="button" className={styles.actionButton} disabled={selectedAssets.length === 0 || mutating} onClick={() => void applyAssets(selectedAssets)}>
              <Plus aria-hidden="true" />使用
            </button>
            <button type="button" className={styles.actionButton} onClick={resetSelection}>取消选择</button>
          </div>
        )}

        <div
          ref={scrollRef}
          className={styles.body}
          onScroll={() => setTouchActiveId(null)}
        >
          {loadState === "loading" || loadState === "idle" ? (
            <div className={styles.skeletonGrid} role="status" aria-label="正在加载历史资产">
              {Array.from({ length: 18 }, (_, index) => <div key={index} className={styles.skeleton} />)}
            </div>
          ) : loadState === "error" ? (
            <div className={styles.state}>
              <RefreshCw aria-hidden="true" />
              <span>历史资产加载失败</span>
              <button type="button" className={styles.actionButton} onClick={() => setRefreshNonce((value) => value + 1)}>重新加载</button>
            </div>
          ) : groups.length === 0 ? (
            <div className={styles.state}>
              <Images aria-hidden="true" />
              <span>{scope === "project" ? "本画布还没有这类历史资产" : "还没有这类历史资产"}</span>
            </div>
          ) : (
            <>
              {groups.map((group) => {
                const readyIds = group.items.filter((item) => item.status === 1 && item.url).map((item) => item.id);
                const groupSelected = readyIds.length > 0 && readyIds.every((id) => selected.has(id));
                return (
                  <section key={group.date} className={styles.group}>
                    <header className={styles.groupHeader}>
                      {batchMode && (
                        <button
                          type="button"
                          className={`${styles.groupSelect}${groupSelected ? ` ${styles.groupSelectOn}` : ""}`}
                          aria-label={groupSelected ? `取消选择 ${group.date}` : `选择 ${group.date}`}
                          aria-pressed={groupSelected}
                          onClick={() => toggleGroup(group.items)}
                        >
                          {groupSelected && <Check aria-hidden="true" />}
                        </button>
                      )}
                      <span>{group.date}</span>
                    </header>
                    <div className={styles.grid}>
                      {group.items.map((asset) => (
                        <HistoryAssetCard
                          key={asset.id}
                          asset={asset}
                          batchMode={batchMode}
                          selected={selected.has(asset.id)}
                          touchActive={touchActiveId === asset.id}
                          deleting={deletingIds.has(asset.id)}
                          onTouchActivate={setTouchActiveId}
                          onSelect={toggleSelection}
                          onPreview={setPreview}
                          onUse={(item) => void applyAssets([item])}
                          onDownload={(item) => void downloadAsset(item)}
                          onDelete={(item) => void removeAsset(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              {nextCursor ? (
                <div ref={sentinelRef} className={styles.sentinel}>
                  {loadMoreFailed ? (
                    <button type="button" className={styles.actionButton} onClick={loadMore}>加载失败，点击重试</button>
                  ) : loadingMore ? "正在加载…" : "继续滚动加载"}
                </div>
              ) : (
                <div className={styles.end}>没有更多了</div>
              )}
            </>
          )}
        </div>

        {preview && (
          <HistoryAssetPreview
            asset={preview}
            busy={mutating}
            onClose={() => setPreview(null)}
            onDownload={(item) => void downloadAsset(item)}
            onUse={(item) => void applyAssets([item])}
          />
        )}
      </section>
    </div>,
    document.body,
  );
}
