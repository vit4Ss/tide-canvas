"use client";
import { useEffect, useRef, useState } from "react";
import { userApiKeyApi } from "@/lib/user-api-key";
import { useAuth } from "./auth-provider";
import { Alert, Modal } from "./ui";

export function ReplaceKeyDialog({ owner, revision, onClose, onChanged }: { owner: string; revision: number; onClose: (message?: string) => void; onChanged: (message: string) => void }) {
  const { sessionVersion } = useAuth();
  const [action, setAction] = useState<"replace" | "check" | null>(null);
  const [review, setReview] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const baseline = useRef(revision), pending = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  const run = async (next: "replace" | "check") => {
    if (pending.current || (next === "replace" && review)) return;
    const controller = new AbortController(); pending.current = controller;
    const version = sessionVersion(), timer = setTimeout(() => controller.abort(), 20_000);
    setAction(next); setError(""); setNotice("");
    const result = next === "check" ? await userApiKeyApi.get(owner, controller.signal) : await userApiKeyApi.rotate(owner, baseline.current, controller.signal);
    clearTimeout(timer);
    if (!alive.current || pending.current !== controller) return;
    pending.current = null; setAction(null);
    if (sessionVersion() !== version || !result.success || controller.signal.aborted || !Number.isSafeInteger(result.data?.revision) || typeof result.data?.enabled !== "boolean") {
      setReview(true);
      setError(next === "check" ? "The current key status could not be checked. Try checking again before replacing the key." : "Replacement was not confirmed. The current key may have changed. Check its status before trying again.");
      return;
    }
    if (next === "check") {
      if (result.data.revision !== baseline.current) { onChanged("Your API key settings have changed. Reveal the current key and review your integrations before making another change."); return; }
      setReview(false);
      setNotice(`The current key is ${result.data.enabled ? "enabled" : "disabled"} and unchanged. You can retry replacement.`);
    } else if (result.data.revision > baseline.current) {
      onChanged("Your API key has been replaced. Reveal the new key and update your integrations before making another request.");
    } else {
      setReview(true); setError("The replacement response was incomplete. Check the current key status before trying again.");
    }
  };
  return <Modal title="Replace your API key?" size="confirm" busy={!!action} busyLabel={action === "check" ? "Checking the current key. Please wait for confirmation." : "Replacing the key. Please wait for confirmation before closing."} description="Your existing key will stop working. Update every integration that uses it after revealing the new key." onClose={() => onClose(review ? "API key replacement was not confirmed. Review the current key before making another change." : undefined)} footer={<>
    <button type="button" className="button" data-modal-autofocus disabled={!!action} onClick={() => onClose(review ? "API key replacement was not confirmed. Review the current key before making another change." : undefined)}>{review ? "Close and review account" : "Keep current key"}</button>
    <button type="button" className={`button ${review ? "primary" : "danger"}`} disabled={!!action} onClick={() => void run(review ? "check" : "replace")}>{action === "check" ? "Checking…" : action ? "Replacing…" : review ? "Check key status" : "Replace key"}</button>
  </>}>
    <p className="small muted">This affects API access. Your account, credits and saved creations stay available.</p>
    {error && <Alert>{error}</Alert>}{notice && <Alert success>{notice}</Alert>}
  </Modal>;
}
