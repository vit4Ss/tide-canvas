"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  Image as ImageIcon,
  Inbox,
  Layers3,
  Loader2,
  PanelLeftClose,
  RefreshCw,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { fileApi } from "@/lib/api";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { FileType, type FileVO } from "@/types/file";
import { BrandMark } from "@/components/shared/brand-mark";
import { toast } from "@/components/shared/toast";
import { getNodeIcon } from "./nodes/utils/node-icons";
import styles from "./styles/my-assets-panel.module.css";

type PanelView = "canvas" | "assets";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 当前画布名称，用于侧栏顶部项目路径。 */
  projectName?: string;
  /** 选中画布节点后定位到该节点。 */
  onSelectNode: (nodeId: string) => void;
  /** 选中素材 → 添加到画布。 */
  onPick: (file: FileVO) => void;
  /** 变化时重新拉取（如「保存到我的素材」后）。 */
  refreshKey?: number;
}

const ASSET_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: FileType.IMAGE, label: "图片" },
  { value: FileType.VIDEO, label: "视频" },
];

const NODE_FILTERS = [
  { value: "", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文本" },
  { value: "audio", label: "音频" },
  { value: "other", label: "其他" },
];

const PRIMARY_NODE_TYPES = new Set(["image", "video", "text", "audio"]);

function nodeMatchesFilter(node: CanvasNode, filter: string): boolean {
  if (!filter) return true;
  if (filter === "other") return !PRIMARY_NODE_TYPES.has(node.type);
  return node.type === filter;
}

function fileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function NodeThumbnail({ node }: { node: CanvasNode }) {
  if (node.imageSrc) {
    return <img src={node.imageSrc} alt="" className={styles.thumbnailMedia} />;
  }

  return (
    <span className={styles.iconThumbnail} aria-hidden="true">
      {createElement(getNodeIcon(node.type))}
    </span>
  );
}

function AssetThumbnail({ file }: { file: FileVO }) {
  if (file.fileType === FileType.VIDEO) {
    return (
      <span className={styles.iconThumbnail} aria-hidden="true">
        <Video />
      </span>
    );
  }

  if (file.fileType === FileType.IMAGE) {
    return <img src={file.fileUrl} alt="" className={styles.thumbnailMedia} />;
  }

  return (
    <span className={styles.iconThumbnail} aria-hidden="true">
      <ImageIcon />
    </span>
  );
}

/** LibTV 信息架构下的画布侧栏：节点导航与素材库共用一套紧凑列表。 */
export function MyAssetsPanel({ open, onClose, projectName = "未命名项目", onSelectNode, onPick, refreshKey }: Props) {
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const [view, setView] = useState<PanelView>("canvas");
  const [files, setFiles] = useState<FileVO[]>([]);
  const [assetFilter, setAssetFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [reverseNodes, setReverseNodes] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleting, setDeleting] = useState<FileVO["id"] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleDelete = useCallback(async (file: FileVO) => {
    if (deleting) return;
    if (!window.confirm(`确定删除素材「${file.originalName}」？该操作不可恢复。`)) return;
    setDeleting(file.id);
    try {
      const response = await fileApi.delete(file.id);
      if (response.success) {
        setFiles((current) => current.filter((item) => item.id !== file.id));
        toast.success("已删除");
      } else {
        toast.error(response.message || "删除失败");
      }
    } catch {
      toast.error("删除失败，请稍后重试");
    } finally {
      setDeleting(null);
    }
  }, [deleting]);

  // setState 放在 await 之后，避免 effect 同步触发级联渲染。
  const load = useCallback(async () => {
    try {
      const response = await fileApi.list({
        pageNum: 1,
        pageSize: 60,
        ...(assetFilter ? { fileType: assetFilter as FileType } : {}),
      });
      if (response.success) setFiles(response.data.records);
    } finally {
      setLoaded(true);
    }
  }, [assetFilter]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNodes = useMemo(() => {
    const result = nodes.filter((node) => {
      if (!nodeMatchesFilter(node, nodeFilter)) return false;
      if (!normalizedQuery) return true;
      return `${node.title} ${node.type}`.toLocaleLowerCase().includes(normalizedQuery);
    });
    return reverseNodes ? [...result].reverse() : result;
  }, [nodeFilter, nodes, normalizedQuery, reverseNodes]);

  const visibleFiles = useMemo(() => files.filter((file) => (
    !normalizedQuery || file.originalName.toLocaleLowerCase().includes(normalizedQuery)
  )), [files, normalizedQuery]);

  const switchView = (nextView: PanelView) => {
    setView(nextView);
    setQuery("");
    setSearchOpen(false);
  };

  if (!open) return null;

  const activeFilter = view === "canvas" ? nodeFilter : assetFilter;
  const filters = view === "canvas" ? NODE_FILTERS : ASSET_FILTERS;

  return (
    <aside className={styles.panel} aria-label="画布与资产侧栏">
      <div className={styles.identityBlock}>
        <div className={styles.brandRow}>
          <BrandMark className={styles.brandMark} />
          <span className={styles.brandName}>TideCanvas</span>
        </div>
        <div className={styles.projectTrail} title={projectName}>
          <span className={styles.projectName}>{projectName}</span>
          <span className={styles.projectSection}>创作画布</span>
        </div>
      </div>

      <div className={styles.viewTabs} role="tablist" aria-label="侧栏视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === "canvas"}
          className={view === "canvas" ? styles.activeTab : styles.tab}
          onClick={() => switchView("canvas")}
        >
          画布
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "assets"}
          className={view === "assets" ? styles.activeTab : styles.tab}
          onClick={() => switchView("assets")}
        >
          资产
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.sectionToolbar}>
          <div className={styles.sectionTitle}>
            {view === "canvas" ? "画布元素" : "我的资产"}
            {view === "canvas" ? (
              <button
                type="button"
                className={styles.inlineIconButton}
                onClick={() => setReverseNodes((current) => !current)}
                title={reverseNodes ? "恢复节点顺序" : "反转节点顺序"}
              >
                <ArrowUpDown />
              </button>
            ) : (
              <button type="button" className={styles.inlineIconButton} onClick={() => void load()} title="刷新资产">
                <RefreshCw />
              </button>
            )}
          </div>
          <div className={styles.toolbarActions}>
            <label className={styles.filterControl}>
              <span className="sr-only">筛选类型</span>
              <select
                value={activeFilter}
                onChange={(event) => {
                  if (view === "canvas") setNodeFilter(event.target.value);
                  else setAssetFilter(event.target.value);
                }}
              >
                {filters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
              </select>
              <ChevronDown aria-hidden="true" />
            </label>
            <button
              type="button"
              className={searchOpen ? styles.activeIconButton : styles.iconButton}
              onClick={() => {
                if (searchOpen) setQuery("");
                setSearchOpen((current) => !current);
              }}
              title={searchOpen ? "关闭搜索" : "搜索"}
              aria-expanded={searchOpen}
            >
              {searchOpen ? <X /> : <Search />}
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className={styles.searchBox}>
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={view === "canvas" ? "搜索画布元素" : "搜索资产名称"}
              aria-label={view === "canvas" ? "搜索画布元素" : "搜索资产名称"}
            />
          </div>
        )}

        <div className={styles.list}>
          {view === "canvas" ? (
            visibleNodes.length === 0 ? (
              <div className={styles.emptyState}>
                <Layers3 />
                <span>{nodes.length === 0 ? "当前画布暂无节点" : "没有匹配的画布元素"}</span>
                {nodes.length === 0 && <small>从底部工具栏新建节点</small>}
              </div>
            ) : (
              visibleNodes.map((node) => {
                const selected = selectedNodeIds.has(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={styles.listRow}
                    data-selected={selected || undefined}
                    onClick={() => onSelectNode(node.id)}
                    title={`定位到 ${node.title || "未命名节点"}`}
                  >
                    <NodeThumbnail node={node} />
                    <span className={styles.rowTitle}>{node.title || "未命名节点"}</span>
                    <span className={styles.locateHint}>定位</span>
                  </button>
                );
              })
            )
          ) : !loaded ? (
            <div className={styles.loadingState}><Loader2 /></div>
          ) : visibleFiles.length === 0 ? (
            <div className={styles.emptyState}>
              <Inbox />
              <span>{files.length === 0 ? "暂无资产" : "没有匹配的资产"}</span>
              {files.length === 0 && <small>上传或生成的素材会显示在这里</small>}
            </div>
          ) : (
            visibleFiles.map((file) => (
              <div key={file.id} className={styles.assetRow}>
                <button
                  type="button"
                  className={styles.assetOpenButton}
                  onClick={() => onPick(file)}
                  title={`添加「${file.originalName}」到画布`}
                >
                  <AssetThumbnail file={file} />
                  <span className={styles.assetText}>
                    <span className={styles.rowTitle}>{file.originalName}</span>
                    <span className={styles.rowMeta}>
                      {file.fileType === FileType.VIDEO ? "视频" : file.fileType === FileType.IMAGE ? "图片" : "文件"}
                      {fileSizeLabel(file.fileSize) && ` · ${fileSizeLabel(file.fileSize)}`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => void handleDelete(file)}
                  disabled={deleting === file.id}
                  title="删除资产"
                >
                  {deleting === file.id ? <Loader2 className={styles.spinning} /> : <Trash2 />}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerCloseButton} onClick={onClose} title="收起侧栏">
          <PanelLeftClose />
        </button>
        <span>{view === "canvas" ? `共 ${nodes.length} 节点` : `共 ${files.length} 项资产`}</span>
      </footer>
    </aside>
  );
}
