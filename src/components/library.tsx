"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Upload, Trash2, ArrowUpRight, Loader2 } from "lucide-react";
import { WorkspaceShell } from "./shell";
import { useAuth } from "./auth-provider";
import { Alert, EmptyState, Loading, Modal, PageHeading, RequireAccount } from "./ui";
import { useMediaHistory } from "@/lib/use-media-history";
import { useResource } from "@/lib/use-resource";
import { uploadFile } from "@/lib/api";
import { http } from "@/lib/http";
import { date, number } from "@/lib/brand";
import { taskMedia, fileMedia } from "@/lib/media";
import { TaskMedia, MediaPreview } from "./media-preview";
import { AssetThumbnail } from "./asset-thumbnail";
import type { FileVO } from "@/types/file";
import type { AiTaskVO } from "@/types/ai";
import type { PageData } from "@/types/api";
import styles from "./library.module.css";

export default function Library() {
  const { user } = useAuth(); const [collection, setCollection] = useState("creations"); const [filter, setFilter] = useState("all"); const [page, setPage] = useState(1);
  const [previewTask, setPreviewTask] = useState<AiTaskVO | null>(null); const [previewFile, setPreviewFile] = useState<FileVO | null>(null); const [remove, setRemove] = useState<FileVO | null>(null);
  const [deletionError, setDeletionError] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const files = useResource<PageData<FileVO>>(`/api/files?pageNum=${page}&pageSize=24${filter !== "all" ? `&mediaKind=${filter}` : ""}`, !!user && collection === "uploads", user?.id);
  const creations = useMediaHistory<AiTaskVO>(`/api/ai/tasks?pageNum=${page}&pageSize=24&status=1${filter !== "all" ? `&mediaType=${filter}` : ""}`, !!user && collection === "creations", user?.id);
  const resource = collection === "uploads" ? files : creations;
  const onUpload = async (selected: FileList | null) => {
    if (!selected?.length) return; setBusy(true); setError("");
    for (const file of Array.from(selected)) {
      if (/\.(exe|com|dll|msi|bat|cmd|ps1|vbs|sh|php|js)$/i.test(file.name)) { setError("Executable files and scripts are not supported."); continue; }
      const response = await uploadFile(file); if (!response.success) setError(response.message);
    }
    setCollection("uploads"); setFilter("all"); setPage(1); files.refresh(); setBusy(false); if (fileRef.current) fileRef.current.value = "";
  };
  const deleteFile = async () => {
    if (!remove || busy) return;
    const selected = remove;
    setBusy(true); setDeletionError(null);
    try {
      const response = await http.delete<void>(`/api/files/detail/${selected.id}`);
      if (response.success) {
        setRemove((current) => current?.id === selected.id ? null : current);
        if (page > 1 && files.data?.records.length === 1) setPage(page - 1);
        files.refresh();
      } else setDeletionError({ id: selected.id, message: response.message });
    } finally { setBusy(false); }
  };

  return <WorkspaceShell><PageHeading title="A place for the things you make." description="Your creations and uploaded references, together." action={user && <button className="button small" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}Upload files</button>} /><input ref={fileRef} hidden type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.glb,.obj" onChange={(event) => void onUpload(event.target.files)} /><RequireAccount><div className="tabs" role="group" aria-label="Library collection"><button aria-pressed={collection === "creations"} className={collection === "creations" ? "on" : ""} onClick={() => { setCollection("creations"); setFilter("all"); setPage(1); }}>Creations</button><button aria-pressed={collection === "uploads"} className={collection === "uploads" ? "on" : ""} onClick={() => { setCollection("uploads"); setFilter("all"); setPage(1); }}>Uploaded files</button></div><div className="toolbar"><div className="filters" role="group" aria-label="Filter assets by format">{["all", "image", "video", "audio", "3d"].map((value) => <button key={value} aria-pressed={filter === value} className={filter === value ? "on" : ""} onClick={() => { setFilter(value); setPage(1); }}>{value === "all" ? "All assets" : value === "3d" ? "3D" : value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div><span className="small muted">{resource.data ? `${number(resource.data.total)} assets` : ""}</span></div>{filter !== "all" && <div className={styles.summary}><span>Showing {filter === "3d" ? "3D" : filter} assets</span><button className="button small" onClick={() => { setFilter("all"); setPage(1); }}>Clear filter</button></div>}{error && <Alert>{error}</Alert>}{resource.error && <Alert>{resource.error}<button onClick={resource.refresh}> Try again</button></Alert>}{resource.loading && <Loading label="Opening your library…" />}{!resource.loading && resource.data?.records?.length === 0 && <EmptyState title={filter !== "all" ? "No assets in this format." : "Give your ideas a home."} description={filter !== "all" ? "Choose another format or clear the filter to see your collection." : collection === "uploads" ? "Upload a reference or source file to keep it in your library." : "Your completed generations will appear here. Try creating something in the studio."} action={filter !== "all" ? undefined : collection === "uploads" ? <button className="button primary" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={15} />Upload your first file</button> : <Link className="button primary" href="/studio">Start creating <ArrowUpRight size={15} /></Link>} />}<div className="library-grid">{collection === "creations" ? creations.data?.records.map((task) => { const media = taskMedia(task); const url = media.urls[0]; return <article className={`library-card ${styles.card}`} key={task.id}><button onClick={() => setPreviewTask(task)} aria-label="Preview creation"><AssetThumbnail media={media} /></button><footer><div><h3>{task.modelName && !/[\p{Script=Han}]/u.test(task.modelName) ? task.modelName : "AI creation"}</h3><span>{date(task.createTime)}</span></div>{url && <a className="icon-button" aria-label="Open original creation" href={url} target="_blank" rel="noreferrer"><ArrowUpRight size={15} /></a>}</footer></article>; }) : files.data?.records.map((file) => <article className={`library-card ${styles.card}`} key={file.id}><button onClick={() => setPreviewFile(file)} aria-label={`Preview ${file.originalName}`}><AssetThumbnail media={fileMedia(file)} /></button><footer><div><h3 title={file.originalName}>{file.originalName}</h3><span>{date(file.createTime)}</span><span>{number(file.fileSize / 1024 / 1024)} MB</span></div>{fileMedia(file).urls[0] && <a className="icon-button" href={fileMedia(file).urls[0]} target="_blank" rel="noreferrer" aria-label={`Open ${file.originalName}`}><ArrowUpRight size={14} /></a>}<button className="icon-button" disabled={busy} onClick={() => { setDeletionError(null); setRemove(file); }} aria-label={`Delete ${file.originalName}`}><Trash2 size={14} /></button></footer></article>)}</div>{resource.data && resource.data.total > 24 && <div className="pagination"><span>Page {page} of {Math.max(1, resource.data.pages || Math.ceil(resource.data.total / 24))}</span><div><button className="button small" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="button small" disabled={page * 24 >= resource.data.total} onClick={() => setPage(page + 1)}>Next</button></div></div>}</RequireAccount>{previewTask && <Modal title="Your creation" onClose={() => setPreviewTask(null)}><TaskMedia task={previewTask} /></Modal>}{previewFile && <Modal title={previewFile.originalName} onClose={() => setPreviewFile(null)}><MediaPreview media={fileMedia(previewFile)} /></Modal>}{remove && <Modal title="Delete this file?" onClose={() => setRemove(null)}>{deletionError?.id === remove.id && <Alert>{deletionError.message}</Alert>}<p className="muted">This removes {remove.originalName} from your library. Existing tasks may still depend on the source file.</p><div className="modal-actions"><button className="button" onClick={() => setRemove(null)}>Keep file</button><button className="button danger" disabled={busy} onClick={() => void deleteFile()}>{busy ? "Deleting…" : "Delete file"}</button></div></Modal>}</WorkspaceShell>;
}
