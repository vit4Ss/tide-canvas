"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChevronRight, FileQuestion, Folder, FolderOpen, Frame, Image as ImageIcon, Inbox, LayoutGrid, List, ListFilter, Loader2, LocateFixed, MoreHorizontal, Mountain, Music2, PanelLeftClose, Plus, RefreshCw, Search, Trash2, Upload, UserRound, Video, X } from "lucide-react";
import { fileApi } from "@/lib/api";
import { canvasStoredFileInfo } from "@/lib/canvas-drop-files";
import { formatFileSize } from "@/lib/utils";
import { FileCategory, FileType, type FileQuery, type FileVO } from "@/types/file";
import { toast } from "@/components/shared/toast";
import { useCanvasStore, type CanvasNode } from "@/stores/use-canvas-store";
import { canvasNodeIcon } from "@/lib/canvas-node-config";
import { getNodeTitle } from "@/lib/canvas-helpers";
import styles from "./styles/my-assets-panel.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (file: FileVO) => void;
  onUpload: () => void;
  onAddNode: () => void;
  onFitView: () => void;
  onRevealNode: (node: CanvasNode) => void;
  refreshKey?: number;
}

const TABS: { key: string; label: string; query: Pick<FileQuery, "fileType" | "category" | "mediaKind"> }[] = [
  { key: "all", label: "全部", query: {} },
  { key: FileCategory.CHARACTER, label: "角色", query: { fileType: FileType.IMAGE, category: FileCategory.CHARACTER } },
  { key: FileCategory.SCENE, label: "场景", query: { fileType: FileType.IMAGE, category: FileCategory.SCENE } },
  { key: FileType.IMAGE, label: "图片", query: { fileType: FileType.IMAGE, category: FileCategory.GENERAL } },
  { key: FileType.VIDEO, label: "视频", query: { fileType: FileType.VIDEO, category: FileCategory.GENERAL } },
  { key: "audio", label: "音频", query: { mediaKind: "audio", category: FileCategory.GENERAL } },
];

/** 画布内的素材侧栏；搜索和分类在服务端分页，避免只筛选首屏素材。 */
export function MyAssetsPanel({ open, onClose, onPick, onUpload, onAddNode, onFitView, onRevealNode, refreshKey }: Props) {
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const [section, setSection] = useState<"canvas" | "assets">("assets");
  const [view, setView] = useState<"list" | "grid">("list");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [nodeSearch, setNodeSearch] = useState("");
  const [nodeFilter, setNodeFilter] = useState("all");
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<FileVO[]>([]);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [deleting, setDeleting] = useState<FileVO["id"] | null>(null);
  const requestRef = useRef(0);
  const invalidateRequests = useCallback(() => { ++requestRef.current; }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (pageNum = 1) => {
    const request = ++requestRef.current;
    const append = pageNum > 1;
    setError("");
    if (append) setLoadingMore(true);
    else {
      setLoadingMore(false);
      setStatus("loading");
      setFiles([]);
      setTotal(0);
      scrollRef.current?.scrollTo({ top: 0 });
    }
    try {
      const query = TABS.find((item) => item.key === tab)?.query ?? {};
      const res = await fileApi.list({ pageNum, pageSize: 40, ...query, keyword: keyword || undefined });
      if (request !== requestRef.current) return;
      if (!res.success || !res.data) throw new Error(res.message || "素材加载失败，请稍后重试");
      const records = res.data.records;
      setFiles((previous) => append ? [...previous, ...records.filter((file) => !previous.some((item) => item.id === file.id))] : records);
      setTotal(res.data.total);
      setPage(pageNum);
      setStatus("ready");
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : "素材加载失败，请稍后重试");
      if (!append) setStatus("error");
    } finally {
      if (request === requestRef.current) setLoadingMore(false);
    }
  }, [tab, keyword]);

  useEffect(() => {
    if (!open || section !== "assets") return;
    const frame = window.requestAnimationFrame(() => void load());
    return () => {
      window.cancelAnimationFrame(frame);
      invalidateRequests();
    };
  }, [open, section, load, refreshKey, reloadKey, invalidateRequests]);

  useEffect(() => {
    if (!open || (!filterOpen && !folderMenu)) return;
    const outside = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
      if (!folderMenuRef.current?.contains(event.target as Node)) setFolderMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, filterOpen, folderMenu]);

  const closePanel = () => {
    onClose();
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="资产管理"]')?.focus({ preventScroll: true }));
  };

  const changeTab = (key: string) => {
    if (tab === key) return;
    ++requestRef.current;
    setTab(key);
    setStatus("loading");
    setFiles([]);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
  };

  const clearSearch = () => {
    updateSearch("");
    setKeyword("");
  };

  const handleDelete = async (file: FileVO) => {
    if (deleting) return;
    if (!window.confirm(`确定删除素材「${file.originalName}」？该操作不可恢复。`)) return;
    setDeleting(file.id);
    try {
      const res = await fileApi.delete(file.id);
      if (!res.success) throw new Error(res.message || "删除失败");
      // 重新取当前分类，避免删除末项后页码偏移或计数不一致。
      setReloadKey((key) => key + 1);
      toast.success("已删除");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(null);
    }
  };

  if (!open) return null;

  const toggleFolder = (key: string) => { const stateKey = keyword ? `search:${keyword}:${key}` : key; setExpanded((previous) => previous.includes(stateKey) ? previous.filter((item) => item !== stateKey) : [...previous, stateKey]); };
  const categoryOf = (file: FileVO) => file.category === FileCategory.CHARACTER || file.category === FileCategory.SCENE ? file.category : FileCategory.GENERAL;
  const folders = [
    { key: FileCategory.GENERAL, name: "待分类资产" },
    { key: FileCategory.CHARACTER, name: "角色资产" },
    { key: FileCategory.SCENE, name: "场景资产" },
  ].filter((folder) => (folder.key === FileCategory.GENERAL && !activeTab.query.category) || folder.key === activeTab.query.category || files.some((file) => categoryOf(file) === folder.key));
  const visibleNodes = nodes.filter((node) => (node.title || getNodeTitle(node.type)).toLowerCase().includes(nodeSearch.trim().toLowerCase()) && (nodeFilter === "all" || node.type === nodeFilter));
  const filters = section === "assets" ? TABS.map((item) => ({ key: item.key, label: item.label })) : [{ key: "all", label: "全部节点" }, ...Array.from(new Set(nodes.map((node) => node.type))).map((key) => ({ key, label: getNodeTitle(key) }))];
  const currentFilter = section === "assets" ? tab : nodeFilter;
  const changeSection = (next: "canvas" | "assets") => { setSection(next); setFilterOpen(false); setFolderMenu(null); };
  const revealNode = (node: CanvasNode) => { onRevealNode(node); if (window.matchMedia("(max-width: 600px)").matches) onClose(); };

  return (
    <aside className={styles.panel} data-canvas-sidebar aria-label="工作区侧栏" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (filterOpen) { setFilterOpen(false); filterRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
      else if (folderMenu) { folderMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); setFolderMenu(null); }
      else if (searchOpen) { setSearchOpen(false); clearSearch(); setNodeSearch(""); searchButtonRef.current?.focus(); }
      else closePanel();
    }}>
      <div className={styles.projectHeaderSpace} aria-hidden />
      <div className={styles.sections} role="tablist" aria-label="工作区内容">
        {([{ key: "canvas", label: "画布" }, { key: "assets", label: "资产" }] as const).map((item) => <button key={item.key} type="button" role="tab" id={`workspace-tab-${item.key}`} aria-selected={section === item.key} aria-controls="workspace-sidebar-content" tabIndex={section === item.key ? 0 : -1} onClick={() => changeSection(item.key)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "canvas" : event.key === "End" ? "assets" : section === "canvas" ? "assets" : "canvas";
          changeSection(next);
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#workspace-tab-${next}`)?.focus();
        }}>{item.label}</button>)}
      </div>
      <div className={styles.toolbar}>
        <button ref={searchButtonRef} type="button" className={styles.iconButton} aria-label={section === "assets" ? "搜索素材" : "搜索节点"} title="搜索" aria-pressed={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) { clearSearch(); setNodeSearch(""); } }}><Search size={15} aria-hidden /></button>
        <button type="button" className={styles.iconButton} aria-label={view === "list" ? "切换为缩略图视图" : "切换为列表视图"} title={view === "list" ? "缩略图视图" : "列表视图"} onClick={() => setView(view === "list" ? "grid" : "list")}>{view === "list" ? <List size={16} aria-hidden /> : <LayoutGrid size={15} aria-hidden />}</button>
        <div ref={filterRef} className={styles.filterRoot}>
          <button type="button" className={styles.iconButton} data-active={currentFilter !== "all" || undefined} aria-label={section === "assets" ? "筛选素材" : "筛选节点"} title="筛选" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => { setFilterOpen(!filterOpen); setFolderMenu(null); }}><ListFilter size={15} aria-hidden /></button>
          {filterOpen && <div className={styles.menu} role="menu" onKeyDown={navigateMenu} aria-label={section === "assets" ? "素材类型" : "节点类型"}>{filters.map((item) => <button key={item.key} type="button" role="menuitemradio" aria-checked={currentFilter === item.key} onClick={() => { if (section === "assets") changeTab(item.key); else setNodeFilter(item.key); setFilterOpen(false); }}><span>{item.label}</span>{currentFilter === item.key && <span className={styles.selectedMark} aria-hidden />}</button>)}</div>}
        </div>
        <span className={styles.toolbarSpace} />
        <button type="button" className={styles.iconButton} aria-label={section === "assets" ? "上传素材" : "新增图片节点"} title={section === "assets" ? "上传素材" : "新增图片节点"} onClick={section === "assets" ? onUpload : onAddNode}><Plus size={17} aria-hidden /></button>
        {section === "assets" ? <a className={styles.manageButton} href="/assets" target="_blank" rel="noreferrer"><FolderOpen size={14} aria-hidden />管理</a> : <button type="button" className={styles.manageButton} onClick={onFitView}><Frame size={14} aria-hidden />定位全部</button>}
      </div>
      {searchOpen && <div className={styles.searchWrap}><div className={styles.search}>
        <Search size={14} aria-hidden />
        <input autoFocus aria-label={section === "assets" ? "搜索素材名称" : "搜索节点名称"} placeholder={section === "assets" ? "搜索素材名称…" : "搜索画布节点…"} value={section === "assets" ? search : nodeSearch} onChange={(event) => section === "assets" ? updateSearch(event.target.value) : setNodeSearch(event.target.value)} />
        {(section === "assets" ? search : nodeSearch) && <button type="button" aria-label="清空搜索" onClick={() => { if (section === "assets") clearSearch(); else setNodeSearch(""); }}><X size={14} aria-hidden /></button>}
      </div></div>}
      <div ref={scrollRef} id="workspace-sidebar-content" className={styles.content} role="tabpanel" aria-labelledby={`workspace-tab-${section}`} aria-busy={section === "assets" && (status === "loading" || loadingMore)}>
        {section === "canvas" ? visibleNodes.length === 0 ? <div className={styles.state}><Inbox size={26} aria-hidden /><p>{nodeSearch || nodeFilter !== "all" ? "没有匹配的画布节点" : "画布还没有节点"}</p>{!nodeSearch && nodeFilter === "all" && <button type="button" className={styles.secondaryButton} onClick={onAddNode}><Plus size={14} aria-hidden />添加图片节点</button>}</div> : <div className={view === "grid" ? styles.nodeGrid : styles.nodeList}>{visibleNodes.map((node) => {
          const Icon = canvasNodeIcon(node.type);
          const title = node.title || getNodeTitle(node.type);
          return <button key={node.id} type="button" className={styles.nodeButton} data-selected={selectedNodeIds.has(node.id) || undefined} aria-label={`定位到节点：${title}`} title={title} onClick={() => revealNode(node)}>
            <span className={styles.nodePreview}>{node.imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={node.imageSrc} alt="" loading="lazy" />
            ) : <Icon size={18} aria-hidden />}</span><span className={styles.nodeTitle}>{title}</span><LocateFixed className={styles.locateIcon} size={14} aria-hidden />
          </button>;
        })}</div> : status === "loading" ? <div className={styles.loading} role="status"><Loader2 className={styles.spinner} size={17} aria-hidden /><span>正在加载资产…</span></div> : status === "error" ? <div className={styles.state} role="alert"><Inbox size={26} aria-hidden /><h3>资产加载失败</h3><p>{error}</p><button type="button" className={styles.secondaryButton} onClick={() => void load()}><RefreshCw size={14} aria-hidden />重新加载</button></div> : keyword && files.length === 0 ? <div className={styles.state} role="status"><Search size={26} aria-hidden /><p>没有找到匹配的素材</p><button type="button" className={styles.secondaryButton} onClick={clearSearch}>清空搜索</button></div> : <>
          {folders.map((folder) => {
            const folderFiles = files.filter((file) => categoryOf(file) === folder.key);
            const isExpanded = keyword ? !expanded.includes(`search:${keyword}:${folder.key}`) : expanded.includes(folder.key);
            return <div className={styles.folder} key={folder.key}>
              <div className={styles.folderRow}>
                <button type="button" className={styles.folderButton} aria-expanded={isExpanded} aria-controls={`workspace-folder-${folder.key}`} onClick={() => toggleFolder(folder.key)}>
                  <ChevronRight size={12} className={isExpanded ? styles.chevronOpen : undefined} aria-hidden /><Folder className={styles.folderIcon} size={30} aria-hidden /><span>{folder.name}</span>
                </button>
                <div ref={folderMenu === folder.key ? folderMenuRef : undefined} className={styles.folderActions}>
                  <button type="button" className={styles.iconButton} aria-label={`${folder.name}更多操作`} title="更多操作" aria-haspopup="menu" aria-expanded={folderMenu === folder.key} onClick={() => { setFolderMenu(folderMenu === folder.key ? null : folder.key); setFilterOpen(false); }}><MoreHorizontal size={16} aria-hidden /></button>
                  {folderMenu === folder.key && <div className={styles.menu} role="menu" onKeyDown={navigateMenu} aria-label={`${folder.name}操作`}>
                    <button type="button" role="menuitem" onClick={() => { toggleFolder(folder.key); setFolderMenu(null); }}>{isExpanded ? "收起文件夹" : "展开文件夹"}</button>
                    <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); onUpload(); }}>上传素材</button>
                    <button type="button" role="menuitem" onClick={() => { setFolderMenu(null); void load(); }}>刷新素材</button>
                  </div>}
                </div>
              </div>
              {isExpanded && <div id={`workspace-folder-${folder.key}`} className={styles.folderContent}>{folderFiles.length === 0 ? <div className={styles.folderEmpty}><p>还没有素材</p><button type="button" className={styles.secondaryButton} onClick={onUpload}><Upload size={13} aria-hidden />上传素材</button></div> : <div className={view === "grid" ? styles.grid : styles.assetList}>{folderFiles.map((file) => <AssetItem key={file.id} file={file} deleting={deleting} onDelete={() => void handleDelete(file)} onPick={() => { onPick(file); if (window.matchMedia("(max-width: 600px)").matches) onClose(); }} />)}</div>}</div>}
            </div>;
          })}
          {error && <p className={styles.inlineError} role="alert">{error}</p>}
          {files.length < total && <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={() => void load(page + 1)}>{loadingMore && <Loader2 className={styles.spinner} size={14} aria-hidden />}{loadingMore ? "正在加载…" : error ? "重新加载更多" : "加载更多"}</button>}
        </>}
      </div>
      <footer className={styles.footer}><button type="button" className={styles.iconButton} onClick={closePanel} title="收起工作区侧栏" aria-label="收起工作区侧栏"><PanelLeftClose size={15} aria-hidden /></button><span>共 {nodes.length} 节点</span></footer>
    </aside>
  );
}

function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}

function AssetItem({ file, deleting, onPick, onDelete }: { file: FileVO; deleting: string | null; onPick: () => void; onDelete: () => void }) {
  const kind = canvasStoredFileInfo({ name: file.originalName, type: file.mimeType, fileType: file.fileType })?.kind;
  const Icon = kind === "video" ? Video : kind === "audio" ? Music2 : kind === "3d" ? Box : kind === "image" ? file.category === FileCategory.CHARACTER ? UserRound : file.category === FileCategory.SCENE ? Mountain : ImageIcon : FileQuestion;
  const label = kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "3d" ? "GLB 模型" : "不支持的格式";
  return <article className={styles.asset}>
    <button type="button" className={styles.assetPick} disabled={!kind} aria-label={kind ? `添加素材到画布：${file.originalName}` : `不支持的素材：${file.originalName}`} title={file.originalName} onClick={onPick}>
      <span className={styles.preview}>{kind === "video" ? <video src={file.fileUrl} muted preload="metadata" /> : kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.fileUrl} alt="" loading="lazy" />
      ) : <Icon size={24} aria-hidden />}</span>
      <span className={styles.fileInfo}><span className={styles.fileName}>{file.originalName}</span><span className={styles.fileMeta}>{label}{Number.isFinite(file.fileSize) && file.fileSize >= 0 ? ` · ${formatFileSize(file.fileSize)}` : ""}</span></span>
    </button>
    <button type="button" className={styles.deleteButton} onClick={onDelete} disabled={deleting !== null} aria-label={`删除素材：${file.originalName}`} title="删除素材">{deleting === file.id ? <Loader2 className={styles.spinner} size={13} aria-hidden /> : <Trash2 size={13} aria-hidden />}</button>
  </article>;
}
