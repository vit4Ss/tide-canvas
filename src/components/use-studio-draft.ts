"use client";
import { useEffect, useRef, useState } from "react";
import { readDraft, takeLoginDraft, writeDraft, type StudioDraft } from "@/lib/studio-draft";

export function useStudioDraft(owner: string, loading: boolean, value: StudioDraft, restore: (draft: StudioDraft) => void, query: string) {
  const hydrated = useRef("");
  const [status, setStatus] = useState("");
  const paramsForEntry = new URLSearchParams(query);
  paramsForEntry.delete("draft"); paramsForEntry.sort();
  const entryQuery = paramsForEntry.toString();
  const serialized = JSON.stringify({ ...value, entryQuery });
  useEffect(() => {
    if (loading || hydrated.current === owner) return;
    let active = true;
    const params = new URLSearchParams(query);
    // Explicit inspiration/model links take precedence over an old draft.
    const explicit = ["prompt", "model", "type", "mode"].some((key) => params.has(key));
    queueMicrotask(() => {
      if (!active) return;
      const transferred = owner !== "guest" ? takeLoginDraft(params.get("draft") || "") : null;
      const saved = transferred || readDraft(owner);
      if (saved && (transferred || !explicit || saved.entryQuery === entryQuery)) {
        restore(saved);
        setStatus("Your draft has been restored.");
      }
      hydrated.current = owner;
      if (transferred) {
        params.delete("draft");
        window.history.replaceState(null, "", `/studio${params.size ? `?${params}` : ""}`);
      }
    });
    return () => { active = false; };
  }, [owner, loading, query, entryQuery, restore]);
  useEffect(() => {
    if (loading || hydrated.current !== owner) return;
    const ok = writeDraft(owner, JSON.parse(serialized));
    queueMicrotask(() => setStatus(ok ? "Draft saved in this tab." : "This browser cannot save drafts. Copy your prompt before leaving."));
  }, [owner, loading, serialized]);
  return status;
}
