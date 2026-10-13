"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AiTaskVO } from "@/types/ai";
import type { FileVO } from "@/types/file";
import { date, number } from "@/lib/brand";
import { fileMedia, taskMedia, type AssetMedia } from "@/lib/media";
import { Modal } from "./ui";
import { MediaPreview } from "./media-preview";
import { SupportLink } from "./consumer-info";

interface Props { id: string; title: string; media: AssetMedia; details?: React.ReactNode; index: number; count: number; onPrevious: () => void; onNext: () => void; onClose: () => void }
function AssetViewer({ id, title, media, details, index, count, onPrevious, onNext, onClose }: Props) {
  const previous = index > 0, next = index >= 0 && index < count - 1;
  const previousButton = useRef<HTMLButtonElement>(null), nextButton = useRef<HTMLButtonElement>(null);
  const moved = useRef<"previous" | "next" | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.closest(".modal-body")?.scrollTo({ top: 0, left: 0 }); }, [id]);
  const goPrevious = () => { moved.current = "previous"; onPrevious(); };
  const goNext = () => { moved.current = "next"; onNext(); };
  useEffect(() => {
    if (moved.current === "previous") (previous ? previousButton.current : nextButton.current)?.focus({ preventScroll: true });
    if (moved.current === "next") (next ? nextButton.current : previousButton.current)?.focus({ preventScroll: true });
    moved.current = null;
  }, [index, previous, next]);
  return <Modal title={title} size="media" onClose={onClose} onKeyDown={event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest("input,textarea,select,video,audio,model-viewer,[data-pan]")) return;
    if (event.key === "ArrowLeft" && previous) { event.preventDefault(); goPrevious(); }
    if (event.key === "ArrowRight" && next) { event.preventDefault(); goNext(); }
  }} footer={<div className="viewer-navigation"><button ref={previousButton} className="button small" disabled={!previous} onClick={goPrevious}><ChevronLeft size={16} />Previous</button><span aria-live="polite">{index >= 0 ? `${index + 1} of ${count} on this page` : "Selected creation"}</span><button ref={nextButton} className="button small" disabled={!next} onClick={goNext}>Next<ChevronRight size={16} /></button></div>}>
    <div ref={content}><MediaPreview key={media.urls.join("|")} media={media} name={title} /></div>
    {details && <details key={id} className="viewer-details"><summary>Creation details</summary>{details}</details>}
  </Modal>;
}
export function TaskViewer({ task, tasks, onSelect, onClose }: { task: AiTaskVO; tasks: AiTaskVO[]; onSelect: (task: AiTaskVO) => void; onClose: () => void }) {
  const index = tasks.findIndex(item => item.id === task.id);
  const title = task.displayName || (task.modelName && !/[\p{Script=Han}]/u.test(task.modelName) ? task.modelName : "Your creation");
  let input: Record<string, unknown> = {};
  try { input = typeof task.input === "string" ? JSON.parse(task.input) : task.input || {}; } catch { /* Legacy input may not be JSON. */ }
  return <AssetViewer id={task.id} title={title} media={taskMedia(task)} index={index} count={tasks.length} onPrevious={() => { if (index > 0) onSelect(tasks[index - 1]); }} onNext={() => { if (index >= 0 && index + 1 < tasks.length) onSelect(tasks[index + 1]); }} onClose={onClose} details={<><dl><div><dt>Created</dt><dd>{date(task.createTime)}</dd></div>{task.pointCost !== undefined && <div><dt>Charged credits</dt><dd>{number(task.pointCost)}</dd></div>}<div><dt>Task reference</dt><dd>{task.id}</dd></div></dl>{typeof input?.prompt === "string" && <p>{input.prompt}</p>}<p><SupportLink reference={`Task ${task.id}`} /></p></>} />;
}
export function FileViewer({ file, files, onSelect, onClose }: { file: FileVO; files: FileVO[]; onSelect: (file: FileVO) => void; onClose: () => void }) {
  const index = files.findIndex(item => item.id === file.id);
  return <AssetViewer id={file.id} title={file.originalName} media={fileMedia(file)} index={index} count={files.length} onPrevious={() => { if (index > 0) onSelect(files[index - 1]); }} onNext={() => { if (index >= 0 && index + 1 < files.length) onSelect(files[index + 1]); }} onClose={onClose} details={<dl><div><dt>Uploaded</dt><dd>{date(file.createTime)}</dd></div><div><dt>File size</dt><dd>{number(file.fileSize / 1024 / 1024)} MB</dd></div><div><dt>Format</dt><dd>{file.mimeType || file.fileType}</dd></div></dl>} />;
}
