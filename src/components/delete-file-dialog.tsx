"use client";
import { useEffect, useRef, useState } from "react";
import { http } from "@/lib/http";
import type { FileVO } from "@/types/file";
import { useAuth } from "./auth-provider";
import { Alert, Modal } from "./ui";

export function DeleteFileDialog({ file, onClose, onRemoved }: { file: FileVO; onClose: () => void; onRemoved: () => void }) {
  const { sessionVersion } = useAuth();
  const [action, setAction] = useState<"delete" | "check" | null>(null), [review, setReview] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), pending = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const run = async (next: "delete" | "check") => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000), version = sessionVersion();
    const path = `/api/files/detail/${encodeURIComponent(file.id)}`;
    setAction(next); setError("");
    const result = next === "check" ? await http.get<FileVO>(path, undefined, { signal: controller.signal }) : await http.delete<void>(path, { signal: controller.signal });
    clearTimeout(timer);
    if (!alive.current || pending.current !== controller) return;
    pending.current = null; setAction(null);
    if (sessionVersion() !== version || controller.signal.aborted || result.code === 0 || result.code >= 500) {
      setReview(true); setError("The result was not confirmed. Check whether the file is still in your library before retrying deletion."); return;
    }
    if (result.code === 404 || (next === "delete" && result.success)) { onRemoved(); return; }
    if (next === "check" && result.success) {
      if (!result.data || typeof result.data !== "object" || !("id" in result.data) || result.data.id !== file.id) { setReview(true); setError("The file status response was incomplete. Try checking again."); return; }
      setReview(false); setError("The file is still in your library. You can retry deletion."); return;
    }
    setError(result.message || "This file could not be removed.");
  };
  return <Modal title="Delete this file?" size="confirm" busy={!!action} busyLabel={action === "check" ? "Checking whether the file is still available. Please wait." : "Deleting the file. Please wait for confirmation before closing."} onClose={onClose} description="This removes the uploaded file from your library. Existing tasks may still depend on its source URL." footer={<>
    <button type="button" className="button" data-modal-autofocus disabled={!!action} onClick={onClose}>{review ? "Close" : "Keep file"}</button>
    <button type="button" className={`button ${review ? "primary" : "danger"}`} disabled={!!action} onClick={() => void run(review ? "check" : "delete")}>{action === "check" ? "Checking…" : action ? "Deleting…" : review ? "Check file status" : "Delete file"}</button>
  </>}><strong className="file-name">{file.originalName}</strong>{error && <Alert>{error}</Alert>}</Modal>;
}
