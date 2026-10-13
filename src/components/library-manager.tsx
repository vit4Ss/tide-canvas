"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download, Pencil, Search, X } from "lucide-react";
import { http } from "@/lib/http";
import { downloadArchive, downloadOriginal, type DownloadAsset } from "@/lib/downloads";
import { Alert, Modal } from "./ui";
import { SupportLink } from "./consumer-info";

export interface LibraryItem { id: string; name: string; urls: string[]; file: boolean }
const Context = createContext<{ selected: string[]; busy: boolean; select: (id: string, selected: boolean) => void; rename: (item: LibraryItem) => void; download: (item: LibraryItem) => void } | null>(null);
export function LibraryAssetActions({ item }: { item: LibraryItem }) {
  const controls = useContext(Context);
  if (!controls) return null;
  return <div className="library-item-actions">
    {!!item.urls.length && <><label className="library-select"><input type="checkbox" aria-label={`Select ${item.name}`} disabled={controls.busy} checked={controls.selected.includes(item.id)} onChange={e => controls.select(item.id, e.target.checked)} /></label>
      <button className="icon-button" aria-label={`Download ${item.name}`} disabled={controls.busy} onClick={() => controls.download(item)}><Download size={15} /></button></>}
    <button className="icon-button" aria-label={`Rename ${item.name}`} disabled={controls.busy} onClick={() => controls.rename(item)}><Pencil size={14} /></button>
  </div>;
}
export function LibraryManager({ items, keyword, onSearch, onRefresh, children }: { items: LibraryItem[]; keyword: string; onSearch: (value: string) => void; onRefresh: () => void; children: React.ReactNode }) {
  const [query, setQuery] = useState(keyword), [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<LibraryItem | null>(null), [name, setName] = useState("");
  const [error, setError] = useState(""), [dialogError, setDialogError] = useState(""), [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false), [progress, setProgress] = useState<{done:number; total:number} | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(true);
  const nameDrafts = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  const available = items.filter(item => item.urls.length);
  const assets = items.filter(item => selected.includes(item.id)).flatMap(item => item.urls.map((url, index) => ({url, name:item.name + (item.urls.length > 1 ? `-${index + 1}` : "")})));
  const startDownload = async (input: DownloadAsset[], archive: boolean) => {
    if (request.current || !input.length) return;
    const controller = new AbortController(); request.current = controller;
    setError(""); setNotice(""); setProgress({done:0,total:input.length});
    try {
      if (archive) await downloadArchive(input, controller.signal, done => { if (alive.current) setProgress({done,total:input.length}); });
      else await downloadOriginal(input[0], AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
      if (alive.current) setNotice("Download prepared. Check your browser’s downloads.");
    } catch (cause) {
      if (alive.current) { if (controller.signal.aborted) setNotice("Download cancelled."); else setError(cause instanceof Error ? cause.message : "Download failed. Retry or open the original."); }
    } finally { request.current = null; if (alive.current) setProgress(null); }
  };
  const saveName = async (event: React.FormEvent) => {
    event.preventDefault(); if (!renaming || saving || !name.trim() || name.trim() === renaming.name) return;
    const controller = new AbortController(); request.current = controller;
    setSaving(true); setDialogError("");
    const path = renaming.file ? `/api/files/detail/${encodeURIComponent(renaming.id)}/name` : `/api/ai/tasks/${encodeURIComponent(renaming.id)}/name`;
    const result = await http.put(path, {name:name.trim()}, {signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])});
    request.current = null;
    if (!alive.current) return;
    setSaving(false);
    if (!result.success) { setDialogError(result.code === 0 ? "The name change was not confirmed. Refresh the asset before trying again; your draft has been kept." : result.message); return; }
    nameDrafts.current.delete(renaming.id); setRenaming(null); setNotice("Name saved to your account."); onRefresh();
  };
  const busy = saving || !!progress;
  return <Context.Provider value={{selected,busy,select:(id, checked) => setSelected(old => checked ? [...new Set([...old,id])] : old.filter(value => value !== id)),rename:item => {setRenaming(item);setName(nameDrafts.current.get(item.id) ?? item.name);setDialogError("");},download:item => void startDownload([{url:item.urls[0],name:item.name}],false)}}>
    <form className="library-search search-field" onSubmit={event => {event.preventDefault();setSelected([]);onSearch(query.trim());}}><Search size={16} /><input aria-label="Search your library" placeholder="Search names, models or prompts…" value={query} maxLength={160} onChange={e => setQuery(e.target.value)} disabled={busy} />{(query || keyword) && <button type="button" className="icon-button" aria-label="Clear library search" disabled={busy} onClick={() => {setQuery("");setSelected([]);onSearch("");}}><X size={15}/></button>}<button className="button small" disabled={busy}>Search</button></form>
    {available.length > 0 && <div className="library-bulk"><label className="check-row"><input type="checkbox" disabled={busy} checked={available.every(item => selected.includes(item.id))} onChange={e => setSelected(e.target.checked ? available.map(item => item.id) : [])}/>Select this page</label><button className="button small" disabled={!assets.length || busy} onClick={() => void startDownload(assets,true)}><Download size={14}/>Download selected{assets.length ? ` (${assets.length})` : ""}</button><small>ZIP · up to 24 files / 100 MB. Download larger files individually.</small></div>}
    {progress && <p role="status">Preparing {progress.done} of {progress.total} files… <button className="button small" onClick={() => request.current?.abort()}>Cancel download</button></p>}
    {error && <Alert>{error} <SupportLink /></Alert>}{notice && <p className="small" role="status">{notice}</p>}
    {children}
    {renaming && <Modal title="Rename this asset" size="form" initialFocus="#library-asset-name" selectInitial busy={saving} busyLabel="Saving the name. Please wait for confirmation." onClose={() => setRenaming(null)} footer={<><button className="button" type="button" disabled={saving} onClick={() => {nameDrafts.current.delete(renaming.id);setRenaming(null);}}>{name !== renaming.name ? "Discard changes" : "Cancel"}</button><button className="button primary" type="submit" form="library-rename-form" disabled={saving || !name.trim() || name.trim() === renaming.name}>{saving ? "Saving…" : "Save name"}</button></>}>
      <form id="library-rename-form" onSubmit={event => void saveName(event)}><label htmlFor="library-asset-name">Name</label><input id="library-asset-name" required maxLength={160} disabled={saving} value={name} onChange={e => {setName(e.target.value);nameDrafts.current.set(renaming.id,e.target.value);}} /><p className="small muted">Saved to your account when you choose Save name. Closing this dialog keeps your unfinished edit while you stay on this page.</p>{dialogError && <Alert>{dialogError}</Alert>}</form>
    </Modal>}
  </Context.Provider>;
}
